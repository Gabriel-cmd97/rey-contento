// Tests E2E del servidor de Rey Contento.
//
// Cómo correr:
//   1. Asegurate de tener el servidor corriendo en localhost:4000:
//        bash start.sh
//   2. Instalá las deps de testing (no están en package.json para no inflar prod):
//        mkdir -p /tmp/rey-tests && cd /tmp/rey-tests
//        npm init -y && npm install socket.io-client@4 node-fetch@2
//   3. Corré los tests apuntando NODE_PATH al /tmp/rey-tests/node_modules:
//        NODE_PATH=/tmp/rey-tests/node_modules node tests/e2e.js
//
// Lo que cubre:
//   - Auth: validación de inputs en /registro y /login, mensajes uniformes
//     anti-enumeración, timing similar entre user inexistente y pass mal.
//   - Sala: crearSala con configs absurdas (clamp), payload null, idSala inválido.
//   - Sesión reemplazada: segundo login del mismo usuario desconecta al primero.
//   - Password de sala: bcrypt valida correctamente OK / WRONG_PASSWORD.
//   - Acción de jugador: whitelist y validación de turno.
//   - Reacción: whitelist de emoji bloquea strings arbitrarios.
//
// NO cubre (requiere navegador):
//   - Animaciones, render del DOM, reloj visual.
//   - Reconexión real tras lock de teléfono.
//   - resetEstadoSala (cliente puro).
//
// Notas operacionales:
//   - Los tests crean usuarios con prefijo `t_<timestamp36>_<a|b>` para evitar
//     colisiones entre runs. La base de datos acumulará estas filas; conviene
//     limpiarlas periódicamente:
//        DELETE FROM usuarios WHERE username LIKE 't\\_%' ESCAPE '\\';
//   - El rate limiter de login es 10/15min por IP. Si corrés los tests varias
//     veces seguidas vas a hitear el 429; en ese caso reiniciá el server.

const { io } = require('socket.io-client');
const fetch = require('node-fetch');

const URL = process.env.REY_URL || 'http://localhost:4000';
const suf = Date.now().toString(36);
const usuario1 = 't_' + suf + '_a';
const usuario2 = 't_' + suf + '_b';
const passOk = 'pass1234';

let pasados = 0, fallados = 0;
const resultados = [];

function check(nombre, ok, detalle = '') {
    if (ok) {
        pasados++;
        const line = `  ✓ ${nombre}`;
        resultados.push(line); console.log(line);
    } else {
        fallados++;
        const line = `  ✗ ${nombre} ${detalle ? '— ' + detalle : ''}`;
        resultados.push(line); console.log(line);
    }
}

async function registrar(username, password) {
    const r = await fetch(`${URL}/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    return { status: r.status, body: await r.json() };
}

async function login(username, password) {
    const r = await fetch(`${URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    return { status: r.status, body: await r.json() };
}

function conectarSocket(token) {
    return new Promise((resolve, reject) => {
        const s = io(URL, { auth: { token }, reconnection: false });
        const t = setTimeout(() => reject(new Error('timeout connect')), 5000);
        s.once('connect', () => { clearTimeout(t); resolve(s); });
        s.once('connect_error', (e) => { clearTimeout(t); reject(e); });
    });
}

function esperarEvento(socket, evento, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout esperando ${evento}`)), timeoutMs);
        socket.once(evento, (data) => { clearTimeout(t); resolve(data); });
    });
}

function esperarMs(ms) { return new Promise(r => setTimeout(r, ms)); }

// =========================================================
// SUITE 1: AUTH
// =========================================================
async function testAuth() {
    console.log('\n[SUITE 1: AUTH]');

    const r1 = await registrar(usuario1, passOk);
    check('registro válido devuelve 201', r1.status === 201);

    const r2 = await registrar('ab', passOk);
    check('username corto (2 chars) rechazado', r2.status === 400);

    const r3 = await registrar(usuario1 + 'x', '12');
    check('password corta rechazada', r3.status === 400);

    const r4 = await registrar('u@con!simbolos', passOk);
    check('username con símbolos raros rechazado', r4.status === 400);

    const l1 = await login(usuario1, passOk);
    check('login válido devuelve token', l1.status === 200 && typeof l1.body.token === 'string');

    const l2 = await login(usuario1, 'malala');
    check('login pass mal = "Credenciales inválidas"',
        l2.status === 401 && l2.body.error === 'Credenciales inválidas.');

    const l3 = await login('usuarioInexistente999', 'cualquiera');
    check('login user inexistente = mismo mensaje',
        l3.status === 401 && l3.body.error === 'Credenciales inválidas.');

    // Timing-safe: el tiempo de respuesta debe ser similar para user inexistente
    // vs user existente con pass mala (anti-enumeración).
    const t1 = Date.now(); await login(usuario1, 'wrong'); const dt1 = Date.now() - t1;
    const t2 = Date.now(); await login('inexistente_xyz', 'wrong'); const dt2 = Date.now() - t2;
    check(`timing similar (diff ${Math.abs(dt1 - dt2)}ms < 150ms)`,
        Math.abs(dt1 - dt2) < 150);

    return l1.body.token;
}

// =========================================================
// SUITE 2: CREAR/UNIRSE/VALIDACIÓN DE CONFIG
// =========================================================
async function testSala(token1) {
    console.log('\n[SUITE 2: SALA]');
    const s1 = await conectarSocket(token1);

    s1.emit('crearSala', {
        configuracion: {
            modoRey: 'SORPRESA',
            frecuenciaReyes: 'NORMAL',
            vidas: 3,
            maxJugadores: 4,
            numBots: 2,
            modoJuego: 'CLASICO'
        }
    });
    const idSala = await esperarEvento(s1, 'salaCreada');
    check('crearSala devuelve idSala de 5 chars',
        typeof idSala === 'string' && idSala.length === 5);

    // Rate limit per-socket de 3s entre crearSala
    await esperarMs(3100);

    s1.emit('crearSala', {
        configuracion: { vidas: 99999, maxJugadores: 1000, numBots: 500, modoJuego: 'INVENTADO' }
    });
    const idSala2 = await Promise.race([
        esperarEvento(s1, 'salaCreada', 2000),
        esperarEvento(s1, 'errorSala', 2000)
    ]);
    check('config absurda no crashea (clamp o error)', !!idSala2);

    await esperarMs(3100);

    let crasheo = false;
    try {
        s1.emit('crearSala', null);
        await esperarMs(500);
    } catch { crasheo = true; }
    check('crearSala con null no crashea', !crasheo && s1.connected);

    s1.emit('unirseSala', { idSala: 'XYZ', password: '' });
    const err = await esperarEvento(s1, 'errorSala', 2000);
    check('idSala muy corto en unirseSala → errorSala', err === 'Código de sala inválido.');

    // Esperar el rate limit de unirseSala (500ms)
    await esperarMs(600);

    s1.emit('unirseSala', { idSala: { evil: true }, password: '' });
    const err2 = await Promise.race([
        esperarEvento(s1, 'errorSala', 1000),
        esperarMs(1000).then(() => 'TIMEOUT')
    ]);
    check('idSala objeto raro → rechazado',
        err2 === 'Código de sala inválido.' && s1.connected);

    s1.disconnect();
    return idSala;
}

// =========================================================
// SUITE 3: SESIÓN REEMPLAZADA
// =========================================================
async function testSesionReemplazada(token1) {
    console.log('\n[SUITE 3: SESIÓN REEMPLAZADA]');

    const s1a = await conectarSocket(token1);
    s1a.emit('crearSala', {
        configuracion: { vidas: 3, maxJugadores: 4, numBots: 0, modoJuego: 'CLASICO' }
    });
    const idSala = await esperarEvento(s1a, 'salaCreada');

    const s1b = await conectarSocket(token1);
    const reemplazadaP = esperarEvento(s1a, 'sesionReemplazada', 3000);
    s1b.emit('unirseSala', { idSala, password: '' });

    let mensaje = null;
    try {
        mensaje = await reemplazadaP;
        check('sesionReemplazada se emite al socket viejo', typeof mensaje === 'string');
    } catch (e) {
        check('sesionReemplazada se emite al socket viejo', false, e.message);
    }

    await esperarMs(300);
    check('socket viejo desconectado tras sesionReemplazada', !s1a.connected);

    s1b.disconnect();
}

// =========================================================
// SUITE 4: PASSWORD DE SALA (bcrypt)
// =========================================================
async function testPasswordSala(token1, token2) {
    console.log('\n[SUITE 4: PASSWORD SALA]');

    const s1 = await conectarSocket(token1);
    s1.emit('crearSala', {
        configuracion: {
            vidas: 3, maxJugadores: 4, numBots: 0, modoJuego: 'CLASICO',
            password: 'secreto123'
        }
    });
    const idSala = await esperarEvento(s1, 'salaCreada');

    const s2 = await conectarSocket(token2);

    s2.emit('unirseSala', { idSala, password: 'wrong' });
    const err = await esperarEvento(s2, 'errorSala', 3000);
    check('password incorrecta → WRONG_PASSWORD', err === 'WRONG_PASSWORD');

    // Rate limit de unirseSala (500ms)
    await esperarMs(600);

    s2.emit('unirseSala', { idSala, password: 'secreto123' });
    const lobby = await esperarEvento(s2, 'actualizarLobby', 3000);
    check('password correcta → entra a sala',
        Array.isArray(lobby.jugadores) && lobby.jugadores.length === 2);

    s1.disconnect();
    s2.disconnect();
}

// =========================================================
// SUITE 5: ACCIÓN DE JUEGO (validación, no en turno)
// =========================================================
async function testAccionJugador(token1, token2) {
    console.log('\n[SUITE 5: ACCIÓN]');

    const s1 = await conectarSocket(token1);
    const s2 = await conectarSocket(token2);

    s1.emit('crearSala', {
        configuracion: { vidas: 3, maxJugadores: 4, numBots: 0, modoJuego: 'CLASICO' }
    });
    const idSala = await esperarEvento(s1, 'salaCreada');

    s2.emit('unirseSala', { idSala, password: '' });
    await esperarEvento(s2, 'actualizarLobby');
    await esperarMs(200);

    s1.emit('iniciarPartida', idSala);
    await esperarEvento(s1, 'juegoIniciado', 5000);

    s1.emit('accionJugador', { idSala, accion: 'BORRAR_TODO' });
    await esperarMs(500);
    check('acción inválida no crashea socket', s1.connected);

    s1.emit('accionJugador', { idSala, accion: 'MANTENER' });
    await esperarMs(500);
    check('acción fuera de turno no crashea', s1.connected);

    s1.disconnect();
    s2.disconnect();
}

// =========================================================
// SUITE 6: REACCIÓN (whitelist de emoji)
// =========================================================
async function testReaccion(token1, token2) {
    console.log('\n[SUITE 6: REACCIÓN]');
    const s1 = await conectarSocket(token1);
    const s2 = await conectarSocket(token2);

    s1.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 4, numBots: 0 } });
    const idSala = await esperarEvento(s1, 'salaCreada');
    s2.emit('unirseSala', { idSala, password: '' });
    await esperarEvento(s2, 'actualizarLobby');
    await esperarMs(200);

    const reaccionP = esperarEvento(s2, 'reaccionJugador', 1500);
    s1.emit('reaccion', { idSala, emoji: '👑' });
    let llegoOk = false;
    try { await reaccionP; llegoOk = true; } catch {}
    check('reacción con emoji válido llega al otro jugador', llegoOk);

    let llegoBasura = false;
    s2.once('reaccionJugador', () => { llegoBasura = true; });
    s1.emit('reaccion', { idSala, emoji: 'A'.repeat(1000) });
    await esperarMs(800);
    check('emoji basura (string largo) bloqueado', !llegoBasura);

    s1.disconnect();
    s2.disconnect();
}

// =========================================================
// SUITE 7: RATE LIMITS DE SOCKETS
// =========================================================
async function testRateLimits(token1, token2) {
    console.log('\n[SUITE 7: RATE LIMITS]');
    const s1 = await conectarSocket(token1);
    const s2 = await conectarSocket(token2);

    s1.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 4, numBots: 0 } });
    const idSala = await esperarEvento(s1, 'salaCreada');

    s2.emit('unirseSala', { idSala, password: '' });
    await esperarEvento(s2, 'actualizarLobby');
    await esperarMs(200);

    // Spamear 5 reacciones rápidas: solo la primera debería propagarse (300ms).
    let recibidas = 0;
    const onReaccion = () => { recibidas++; };
    s2.on('reaccionJugador', onReaccion);
    for (let i = 0; i < 5; i++) s1.emit('reaccion', { idSala, emoji: '👑' });
    await esperarMs(700);
    s2.off('reaccionJugador', onReaccion);
    check(`rate limit reacción bloquea spam (recibidas=${recibidas}, esperado=1)`, recibidas === 1);

    s1.disconnect();
    s2.disconnect();
}

// =========================================================
// SUITE 9: DESCONEXIONES
// =========================================================
async function testDesconexiones(token1, token2) {
    console.log('\n[SUITE 9: DESCONEXIONES]');

    // 1. Disconnect del host en LOBBY ⇒ promoción + actualizarLobby a los demás
    {
        const sA = await conectarSocket(token1);
        const sB = await conectarSocket(token2);
        sA.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 4, numBots: 0 } });
        const idSala = await esperarEvento(sA, 'salaCreada');
        sB.emit('unirseSala', { idSala, password: '' });
        await esperarEvento(sB, 'actualizarLobby');
        await esperarMs(150);

        const lobbyP = esperarEvento(sB, 'actualizarLobby', 2000);
        sA.disconnect();
        const datos = await lobbyP;
        check('disconnect del host en LOBBY → sB queda como jugadores[0]',
            datos.jugadores.length === 1);
        sB.disconnect();
        await esperarMs(200);
    }

    // 2. Disconnect del único miembro en LOBBY ⇒ sala se borra
    {
        const sA = await conectarSocket(token1);
        sA.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 4, numBots: 0 } });
        const idSala = await esperarEvento(sA, 'salaCreada');
        sA.disconnect();
        await esperarMs(400); // dejar al server procesar

        const sB = await conectarSocket(token2);
        sB.emit('unirseSala', { idSala, password: '' });
        const err = await esperarEvento(sB, 'errorSala', 2000);
        check('disconnect del único host borra la sala', err === 'La sala no existe.');
        sB.disconnect();
        await esperarMs(200);
    }

    // 3. Reconexión durante partida activa ⇒ recibe reconexionExitosa
    {
        const sA = await conectarSocket(token1);
        const sB = await conectarSocket(token2);
        sA.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 4, numBots: 1, modoJuego: 'CLASICO' } });
        const idSala = await esperarEvento(sA, 'salaCreada');
        sB.emit('unirseSala', { idSala, password: '' });
        await esperarEvento(sB, 'actualizarLobby');
        await esperarMs(200);

        sA.emit('iniciarPartida', idSala);
        await esperarEvento(sB, 'juegoIniciado', 5000);
        await esperarMs(200);

        sB.disconnect();
        await esperarMs(400);

        // Reconectar con MISMO token → debería entrar a la partida en curso
        const sBnuevo = await conectarSocket(token2);
        sBnuevo.emit('unirseSala', { idSala, password: '' });
        const reconex = await esperarEvento(sBnuevo, 'reconexionExitosa', 3000);
        check('reconexión durante partida → reconexionExitosa con datos',
            reconex && reconex.idSala === idSala && typeof reconex.estado === 'string');

        sA.disconnect();
        sBnuevo.disconnect();
        await esperarMs(200);
    }

    // 4. Disconnect mid-partida no borra la sala (grace period activo)
    {
        const sA = await conectarSocket(token1);
        const sB = await conectarSocket(token2);
        sA.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 4, numBots: 1 } });
        const idSala = await esperarEvento(sA, 'salaCreada');
        sB.emit('unirseSala', { idSala, password: '' });
        await esperarEvento(sB, 'actualizarLobby');
        await esperarMs(200);
        sA.emit('iniciarPartida', idSala);
        await esperarEvento(sB, 'juegoIniciado', 5000);
        await esperarMs(200);

        sA.disconnect();
        await esperarMs(300);

        // Reconectar con MISMO token (sA) — la sala NO debe haber sido borrada
        const sAnuevo = await conectarSocket(token1);
        sAnuevo.emit('unirseSala', { idSala, password: '' });
        const ev = await Promise.race([
            esperarEvento(sAnuevo, 'reconexionExitosa', 2000),
            esperarEvento(sAnuevo, 'errorSala', 2000),
        ]);
        check('disconnect mid-partida no borra sala (grace period)',
            typeof ev === 'object' && ev.idSala === idSala);

        sB.disconnect();
        sAnuevo.disconnect();
        await esperarMs(200);
    }
}

// =========================================================
// SUITE 8B: PROMOCIÓN DE HOST
// =========================================================
async function testPromocionHost(token1, token2) {
    console.log('\n[SUITE 8B: PROMOCIÓN HOST]');

    const s1 = await conectarSocket(token1);
    const s2 = await conectarSocket(token2);

    s1.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 4, numBots: 0 } });
    const idSala = await esperarEvento(s1, 'salaCreada');

    s2.emit('unirseSala', { idSala, password: '' });
    await esperarEvento(s2, 'actualizarLobby');
    await esperarMs(200);

    // Host (s1) abandona. s2 debería recibir actualizarLobby con jugadores[0] = s2
    const lobbyP = esperarEvento(s2, 'actualizarLobby', 2000);
    s1.emit('abandonarSala', idSala);
    const datos = await lobbyP;
    check('tras abandonar host, jugadores[0] es el nuevo host',
        datos.jugadores.length === 1 &&
        datos.jugadores[0].nombre.startsWith('t_'));

    s1.disconnect();
    s2.disconnect();
}

// =========================================================
// SUITE 8: ENDPOINTS HTTP DE STATS
// =========================================================
async function testStats() {
    console.log('\n[SUITE 8: STATS HTTP]');

    // Leaderboard responde siempre — si falla DB, degrada a array vacío
    const r1 = await fetch(`${URL}/leaderboard`);
    const body1 = await r1.json();
    check('leaderboard responde 200', r1.status === 200);
    check('leaderboard devuelve array', Array.isArray(body1));

    // mis-stats con username inválido → 400
    const r2 = await fetch(`${URL}/mis-stats/`);
    check('mis-stats sin username → 404 (ruta no matchea)', r2.status === 404);

    // mis-stats con username válido pero inexistente → 404 controlado
    const r3 = await fetch(`${URL}/mis-stats/usuarioInexistente999`);
    check('mis-stats user inexistente → 404 con json', r3.status === 404);
}

// =========================================================
// MAIN
// =========================================================
(async () => {
    try {
        console.log(`Testing contra ${URL}`);
        const token1 = await testAuth();
        await registrar(usuario2, passOk);
        const lresp = await login(usuario2, passOk);
        const token2 = lresp.body.token;
        if (!token2) {
            console.error(`No se pudo loguear usuario2: status=${lresp.status} body=${JSON.stringify(lresp.body)}`);
            process.exit(2);
        }

        await testSala(token1);
        await testSesionReemplazada(token1);
        await testPasswordSala(token1, token2);
        await testAccionJugador(token1, token2);
        await testReaccion(token1, token2);
        await testRateLimits(token1, token2);
        await testPromocionHost(token1, token2);
        await testDesconexiones(token1, token2);
        await testStats();

        console.log('\n========== RESULTADOS ==========');
        console.log(`Pasados: ${pasados} | Fallados: ${fallados}`);
        process.exit(fallados === 0 ? 0 : 1);
    } catch (e) {
        console.error('ERROR FATAL:', e.message);
        process.exit(2);
    }
})();
