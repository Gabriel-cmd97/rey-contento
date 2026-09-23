require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const bots = require('./bots');
const { barajar, crearMazo, siguienteVivo, resolverCartas } = require('./reglas');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const log = require('./logger');

// Errores de DB que NO indican un bug del código — son cortes/locks pasajeros
// que típicamente desaparecen en milisegundos. Reintentar es seguro y mejora
// la robustez frente a hipos de red entre el server y AWS RDS.
const ERRORES_DB_TRANSIENT = new Set([
    'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'ETIMEDOUT',
    'ER_LOCK_WAIT_TIMEOUT',
    'ER_LOCK_DEADLOCK',
]);

// Ejecuta `fn` con reintentos exponenciales (100ms, 200ms, 300ms) ante errores
// transient. Errores permanentes (ER_DUP_ENTRY, ER_BAD_FIELD_ERROR, etc.)
// se propagan inmediatamente sin retry.
async function conRetry(fn, ctx = {}) {
    const maxIntentos = 3;
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            return await fn();
        } catch (err) {
            if (!ERRORES_DB_TRANSIENT.has(err.code) || intento === maxIntentos) {
                throw err;
            }
            log.warn('DB transient error, reintentando', {
                intento, codigo: err.code, ...ctx
            });
            await new Promise(r => setTimeout(r, 100 * intento));
        }
    }
}

// CORS: si ALLOWED_ORIGINS está definido en .env, restringe a esos orígenes.
// Si no, permite cualquiera (modo dev). En producción SIEMPRE setear esta var
// para evitar que sitios ajenos embeban el juego o scrapeen el leaderboard.
// Ejemplo .env: ALLOWED_ORIGINS=http://34.204.215.13:4000,http://localhost:4000
const origenesPermitidos = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : null;

function verificarOrigen(origin, callback) {
    // null = sin restricción (dev)
    if (!origenesPermitidos) return callback(null, true);
    // origin vacío = same-origin, curl, mobile native, server-to-server
    if (!origin) return callback(null, true);
    if (origenesPermitidos.includes(origin)) return callback(null, true);
    log.warn('CORS bloqueó origen', { origin });
    callback(new Error('Origen no permitido'));
}

const app = express();

// Security headers básicos — evita dep nueva (helmet).
// - X-Frame-Options: bloquea iframes (clickjacking)
// - X-Content-Type-Options: previene MIME-type sniffing (XSS via tipo)
// - Referrer-Policy: no leakea URL a sitios externos al hacer links
// - Permissions-Policy: deniega APIs del navegador que no usamos
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

app.use(cors({ origin: verificarOrigen, credentials: false }));
app.use(express.json());
app.use(express.static('public'));

const limitarAuth = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Más estricto para login: 10 intentos por IP cada 15 min mitiga brute force.
const limitarLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados intentos de login. Espera 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Lectura de stats (/leaderboard, /mis-stats): pegan a la DB sin auth y se
// consultan en cada carga de la pantalla de inicio. Límite generoso para no
// romper uso legítimo, pero acotado para frenar scraping/abuso del endpoint.
const limitarLectura = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Demasiadas solicitudes. Espera unos minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Validación de credenciales:
// - Registro restrictivo (regex): nuevos usernames con set acotado para evitar
//   colisiones visuales y caracteres problemáticos.
// - Login permisivo (solo tipo y longitud): no romper logins de cuentas pre-existentes.
function esUsernameRegistro(v) {
    return typeof v === 'string' && /^[A-Za-z0-9._-]{3,20}$/.test(v);
}
function esUsernameLogin(v) {
    return typeof v === 'string' && v.length >= 1 && v.length <= 100;
}
function esPasswordValida(v) {
    return typeof v === 'string' && v.length >= 4 && v.length <= 100;
}

// Hash dummy precomputado: cuando el username no existe en /login, igual hacemos
// un bcrypt.compare contra este hash para que la respuesta tarde lo mismo que un
// login válido — impide enumerar usuarios midiendo el tiempo de respuesta.
const HASH_DUMMY_LOGIN = bcrypt.hashSync('contrasena-dummy-nunca-matcheada', 10);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: verificarOrigen, credentials: false } });
if (!origenesPermitidos) {
    log.warn('ALLOWED_ORIGINS no configurado — permitiendo cualquier origen (modo dev)');
}

const estadoSalas = {};
const temporizadores = {};
const temporizadoresDesconexion = {};
// Fail-fast si falta JWT_SECRET. Sin esto, un deploy sin .env usaba el
// fallback 'secreto_temporal' (hardcoded en el repo) → cualquiera con acceso
// al código puede forjar tokens válidos.
if (!process.env.JWT_SECRET) {
    log.error('JWT_SECRET no definido en .env. Abortando boot.');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// ── Rate limiter para eventos de socket ──────────────────────
const _socketRates = {};
function permitir(socketId, evento, limitMs) {
    const key = `${socketId}:${evento}`;
    const ahora = Date.now();
    if (ahora - (_socketRates[key] || 0) < limitMs) return false;
    _socketRates[key] = ahora;
    return true;
}

const NOMBRES_BOT = [
    'Aldric','Bertram','Cormac','Dorian','Edwyn','Faustus','Gareth','Hadwin',
    'Ivar','Jorund','Keldric','Leoric','Maldred','Norvin','Osric','Percival',
    'Quillan','Rodrick','Sigmar','Tomas','Ulric','Vance','Wulfric','Xander',
    'Yorick','Zephyr','Alaric','Brynolf','Cedric','Draven','Emric','Fenwick',
    'Godfrey','Haldor','Ingvar','Jorah','Kendrick','Lothar','Magnus','Naldo',
    'Oberon','Piers','Ragnar','Soren','Torben','Ulfgar','Valdric','Wendell'
];

function nombreBotAleatorio(usados = []) {
    const disponibles = NOMBRES_BOT.filter(n => !usados.includes(n));
    const candidatos = disponibles.length > 0 ? disponibles : NOMBRES_BOT;
    return candidatos[Math.floor(Math.random() * candidatos.length)];
}

// Segundos por turno que se pueden elegir al crear la sala.
const TIEMPOS_TURNO = [7, 10, 15, 20];

// Valida y acota la configuración que viene del cliente.
// Devuelve un nuevo objeto sanitizado, o null si algo es inválido.
function sanitizarConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const enteroEnRango = (v, min, max, def) => {
        const n = Number.parseInt(v, 10);
        if (Number.isNaN(n)) return def;
        return Math.max(min, Math.min(max, n));
    };
    const enLista = (v, lista, def) => lista.includes(v) ? v : def;

    const vidas         = enteroEnRango(raw.vidas, 1, 10, 3);
    const maxJugadores  = enteroEnRango(raw.maxJugadores, 2, 8, 6);
    const numBots       = enteroEnRango(raw.numBots, 0, maxJugadores - 1, 0); // siempre al menos 1 humano
    const modoJuego     = enLista(raw.modoJuego, ['CLASICO', 'CAMPANA'], 'CLASICO');
    const modoRey       = enLista(raw.modoRey, ['SORPRESA', 'DECLARADO'], 'SORPRESA');
    const frecuenciaReyes = enLista(raw.frecuenciaReyes, ['NORMAL', 'ALTA', 'LOCURA'], 'NORMAL');
    const dificultadBots = enLista(raw.dificultadBots, bots.DIFICULTADES, 'NORMAL');
    const tiempoTurno   = enLista(Number.parseInt(raw.tiempoTurno, 10), TIEMPOS_TURNO, 10);

    let password = null;
    if (typeof raw.password === 'string') {
        const trimmed = raw.password.trim();
        if (trimmed.length > 0 && trimmed.length <= 50) password = trimmed;
        else if (trimmed.length > 50) return null; // rechazar passwords absurdamente largos
    }

    return { vidas, maxJugadores, numBots, modoJuego, modoRey, frecuenciaReyes, dificultadBots, tiempoTurno, password };
}

// Formato del idSala: 5 caracteres alfanuméricos. El alfabeto real es
// más restringido (sin I/O/0/1) pero permitir todo A-Z0-9 es suficiente:
// un id que no exista en estadoSalas igual cae al "sala no existe".
function esIdSalaValido(v) {
    return typeof v === 'string' && /^[A-Z0-9]{5}$/i.test(v);
}

// Whitelist de emojis de reacciones — debe coincidir con data-emoji del HTML.
// Sin esto, un cliente puede broadcastear strings arbitrarios (XSS no aplica
// porque el cliente sanitiza, pero sí puede mandar payloads gigantes).
const EMOJIS_REACCION = new Set(['😱', '🤡', '👑', '💀', '🎭', '🍀']);

// Marca actividad reciente en una sala. Se usa para que el sweeper no borre
// salas vivas. Llamar al crear, al unirse, y en cada acción de jugador.
function tocarSala(sala) {
    if (sala) sala.ultimaActividad = Date.now();
}

// Límites globales para prevenir DoS por memoria: un atacante con muchos
// tokens válidos podría crear miles de salas. El sweeper limpia las muertas
// pero estos caps son la defensa de primera línea.
const MAX_SALAS_GLOBAL = 500;
const MAX_SALAS_POR_USUARIO = 5;

// Cuenta cuántas salas activas tienen al usuario como jugador humano (incluye
// salas que creó y salas a las que se unió). Recorre todo estadoSalas, pero
// con MAX_SALAS_GLOBAL=500 y ~6 jugadores cada una son ~3000 comparaciones —
// trivial. Si esto creciera, mantener un índice {username: Set<idSala>}.
function contarSalasDelUsuario(username) {
    let count = 0;
    for (const id in estadoSalas) {
        if (estadoSalas[id].jugadores.some(j => j.nombre === username && !j.esBot)) {
            count++;
        }
    }
    return count;
}

// Centraliza el borrado de salas: cancela timers de turno y de desconexión
// asociados antes de quitar la sala del registro. Llamar a este helper en lugar
// de `delete estadoSalas[id]` evita timers fantasma sobre estado ya borrado.
function limpiarSala(idSala) {
    const sala = estadoSalas[idSala];
    if (!sala) return;
    if (temporizadores[idSala]) {
        clearTimeout(temporizadores[idSala]);
        delete temporizadores[idSala];
    }
    sala.jugadores.forEach(j => {
        if (temporizadoresDesconexion[j.nombre]) {
            clearTimeout(temporizadoresDesconexion[j.nombre]);
            delete temporizadoresDesconexion[j.nombre];
        }
    });
    delete estadoSalas[idSala];
}

// Lo que la mesa puede ver de cada jugador. Nunca mandar sala.jugadores tal
// cual: trae la carta oculta de todos (se veía abriendo las herramientas del
// navegador) y la memoria de los bots. La carta ajena solo viaja cuando ya es
// pública: al revelar la ronda o si es un Rey declarado. Cada quien recibe la
// suya aparte con 'tuCarta'.
function jugadoresPublicos(sala) {
    const rondaRevelada = sala.estadoActual === "REVELACION" || sala.estadoActual === "FINALIZADO";
    const reyDeclarado = sala.config.modoRey === "DECLARADO" && sala.config.modoJuego !== 'CAMPANA';
    return sala.jugadores.map(({ memoria, cartaActual, cartaRevelada, ...publico }) => {
        const esReyVisible = reyDeclarado && cartaActual === 9;
        if (rondaRevelada || esReyVisible) publico.cartaActual = cartaActual;
        publico.cartaRevelada = esReyVisible;
        return publico;
    });
}

// Helper para emitir actualizarLobby siempre con maxJugadores
function emitirLobby(idSala) {
    const sala = estadoSalas[idSala];
    if (!sala) return;
    io.to(idSala).emit('actualizarLobby', {
        jugadores: jugadoresPublicos(sala),
        maxJugadores: sala.config.maxJugadores
    });
}

// ==========================================
// MIDDLEWARE SOCKET.IO
// ==========================================
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error("Acceso denegado: Token no proporcionado"));
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.usuario = decoded;
        next();
    } catch (err) {
        next(new Error("Token inválido o expirado"));
    }
});

// ==========================================
// RUTAS AUTH
// ==========================================
app.post('/registro', limitarAuth, async (req, res) => {
    const { username, password } = req.body || {};
    if (!esUsernameRegistro(username)) {
        return res.status(400).json({ error: 'El usuario debe tener 3-20 caracteres (letras, números, . _ -).' });
    }
    if (!esPasswordValida(password)) {
        return res.status(400).json({ error: 'La contraseña debe tener entre 4 y 100 caracteres.' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await conRetry(
            () => pool.execute('INSERT INTO usuarios (username, password_hash) VALUES (?, ?)', [username, hashedPassword]),
            { op: 'registro', username }
        );
        res.status(201).json({ mensaje: '¡Cuenta creada! Ya puedes iniciar sesión.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'Ese nombre de usuario ya está ocupado.' });
        } else {
            log.error('Registro falló', { error: error.message, codigo: error.code, username });
            res.status(500).json({ error: 'Error en la base de datos.' });
        }
    }
});

app.post('/login', limitarLogin, async (req, res) => {
    const { username, password } = req.body || {};
    // Mensaje genérico para input inválido — no revelar si era el user o el pass.
    if (!esUsernameLogin(username) || !esPasswordValida(password)) {
        return res.status(401).json({ error: 'Credenciales inválidas.' });
    }
    try {
        const [rows] = await conRetry(
            () => pool.execute('SELECT * FROM usuarios WHERE username = ?', [username]),
            { op: 'login' }
        );
        const user = rows[0];
        // Compararar siempre contra UN hash (real o dummy) para que el tiempo
        // de respuesta no permita enumerar usernames existentes.
        const hashAComparar = user ? user.password_hash : HASH_DUMMY_LOGIN;
        const passwordValida = await bcrypt.compare(password, hashAComparar);
        if (!user || !passwordValida) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ mensaje: 'Login exitoso', token, username: user.username });
    } catch (error) {
        log.error('Login falló', { error: error.message, codigo: error.code });
        res.status(500).json({ error: 'Error en el servidor.' });
    }
});

app.get('/leaderboard', limitarLectura, async (req, res) => {
    try {
        const [rows] = await conRetry(
            () => pool.execute(
                'SELECT username, victorias, partidas_jugadas, racha_actual, racha_maxima FROM usuarios ORDER BY victorias DESC LIMIT 10'
            ),
            { op: 'leaderboard' }
        );
        res.json(rows);
    } catch (error) {
        log.error('Leaderboard falló', { error: error.message, codigo: error.code });
        // Degradación elegante: devolver lista vacía en lugar de 500.
        // El juego sigue funcionando, la UI muestra "sin datos".
        res.json([]);
    }
});

app.get('/mis-stats/:username', limitarLectura, async (req, res) => {
    const username = req.params.username;
    if (!esUsernameLogin(username)) {
        return res.status(400).json({ error: 'Username inválido.' });
    }
    try {
        const [rows] = await conRetry(
            () => pool.execute(
                'SELECT username, victorias, partidas_jugadas, racha_actual, racha_maxima FROM usuarios WHERE username = ?',
                [username]
            ),
            { op: 'mis-stats', username }
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const u = rows[0];
        const winrate = u.partidas_jugadas > 0 ? Math.round((u.victorias / u.partidas_jugadas) * 100) : 0;
        res.json({ ...u, winrate });
    } catch (error) {
        log.error('mis-stats falló', { error: error.message, codigo: error.code, username });
        res.status(500).json({ error: 'Error al cargar stats' });
    }
});

app.get('/sala/:id', (req, res) => {
    res.redirect(`/?sala=${req.params.id}`);
});

// ==========================================
// HELPERS DE STATS
// ==========================================
async function registrarFinPartida(sala, ganador) {
    const humanos = sala.jugadores.filter(j => !j.esBot);
    if (humanos.length === 0) return;

    const usernames = humanos.map(j => j.nombre);
    const placeholders = usernames.map(() => '?').join(',');

    // Sumar partida jugada a todos
    await conRetry(
        () => pool.execute(
            `UPDATE usuarios SET partidas_jugadas = partidas_jugadas + 1 WHERE username IN (${placeholders})`,
            usernames
        ),
        { op: 'update_partidas_jugadas' }
    ).catch(err => log.error('Fallo update partidas_jugadas', { error: err.message, codigo: err.code, usernames }));

    if (!ganador.id || ganador.esBot) return;

    // Ganador: victoria + racha
    await conRetry(
        () => pool.execute(
            `UPDATE usuarios SET victorias = victorias + 1,
             racha_actual = racha_actual + 1,
             racha_maxima = GREATEST(racha_maxima, racha_actual + 1)
             WHERE username = ?`,
            [ganador.nombre]
        ),
        { op: 'update_victoria', ganador: ganador.nombre }
    ).catch(err => log.error('Fallo update victoria', { error: err.message, codigo: err.code, ganador: ganador.nombre }));

    // Perdedores humanos: resetear racha
    const perdedores = humanos.filter(j => j.nombre !== ganador.nombre).map(j => j.nombre);
    if (perdedores.length > 0) {
        const placeholdersPerd = perdedores.map(() => '?').join(',');
        await conRetry(
            () => pool.execute(
                `UPDATE usuarios SET racha_actual = 0 WHERE username IN (${placeholdersPerd})`,
                perdedores
            ),
            { op: 'reset_racha' }
        ).catch(err => log.error('Fallo reset racha', { error: err.message, codigo: err.code, perdedores }));
    }
}

// ==========================================
// MOTOR DEL JUEGO
// ==========================================
function resolverRonda(sala, io) {
    // Guardia contra timers fantasma: la sala puede haberse borrado
    // entre que se programó esta llamada y que se ejecutó.
    if (!estadoSalas[sala.idSala]) return;
    if (sala.estadoActual === "REVELACION" || sala.estadoActual === "FINALIZADO") return;
    sala.estadoActual = "REVELACION";
    if (temporizadores[sala.idSala]) clearTimeout(temporizadores[sala.idSala]);

    let vivos = sala.jugadores.filter(j => j.vidas > 0);
    if (vivos.length === 0) return;

    const { valorCritico, perdedores, campanaInfo, mensajes } = resolverCartas(sala);
    mensajes.forEach(m => io.to(sala.idSala).emit('mensajeGlobal', m));

    let sobrevivientes = sala.jugadores.filter(j => j.vidas > 0);
    const humanosVivos = sobrevivientes.filter(j => !j.esBot);
    let juegoTerminado = sobrevivientes.length <= 1 || humanosVivos.length === 0;

    if (juegoTerminado) sala.estadoActual = "FINALIZADO";

    // Enviar cartas reveladas al descarte (persistente entre rondas)
    vivos.forEach(j => { if (j.cartaActual !== undefined && j.cartaActual !== null) sala.descarte.push(j.cartaActual); });

    io.to(sala.idSala).emit('rondaTerminada', {
        jugadores: jugadoresPublicos(sala),
        perdedores: perdedores,
        cartaMortal: valorCritico,
        dealerId: sala.jugadores[sala.dealerIndex].id,
        juegoTerminado: juegoTerminado,
        campana: campanaInfo
    });

    io.to(sala.idSala).emit('accionMesa', {
        tipo: 'FIN_RONDA',
        icono: '💀',
        texto: `Fin de ronda — Carta mortal: ${valorCritico}`
    });

    // Avance automático: con dealer bot a los 2.5s; con dealer humano a los 15s
    // por si no presiona "siguiente ronda" (antes la sala quedaba atorada en
    // REVELACION hasta que el sweeper la borraba). Si el dealer avanza antes,
    // el estado ya no es REVELACION y este timer no hace nada.
    const SEG_AUTO_SIGUIENTE_RONDA = 15;
    if (!juegoTerminado) {
        const dealerEsBot = sala.jugadores[sala.dealerIndex].esBot;
        const rondaResuelta = sala.rondaActual;
        setTimeout(() => {
            // rondaResuelta: si el dealer ya avanzó y otra ronda llegó a
            // REVELACION antes de los 15s, este timer viejo no debe saltarla.
            if (!estadoSalas[sala.idSala] || sala.estadoActual !== "REVELACION" || sala.rondaActual !== rondaResuelta) return;
            let vivos = sala.jugadores.filter(j => j.vidas > 0);
            if (vivos.length <= 1) return;
            sala.estadoActual = "PREPARANDO_NUEVA_RONDA";
            if (!dealerEsBot) io.to(sala.idSala).emit('mensajeGlobal', '⏩ La siguiente ronda empezó automáticamente.');
            io.to(sala.idSala).emit('nuevaRondaIniciada', { jugadoresActualizados: jugadoresPublicos(sala) });
            iniciarRonda(sala, io);
        }, dealerEsBot ? 2500 : SEG_AUTO_SIGUIENTE_RONDA * 1000);
    }

    if (juegoTerminado) {
        const ganador = sobrevivientes[0] || { nombre: "Nadie (Empate total)", vidas: 0 };
        setTimeout(() => {
            // Sala pudo borrarse o saltar a otro estado mientras esperábamos
            if (!estadoSalas[sala.idSala]) return;
            io.to(sala.idSala).emit('finDelJuego', ganador);
            registrarFinPartida(sala, ganador);
            sala.votosRevancha = new Set();
            sala.revanchaIniciada = false;
            setTimeout(() => {
                // Guard explícito de votosRevancha (puede ser undefined si el flow
                // se rompió antes) y de tamaño > 0 para no iniciar revancha vacía.
                if (estadoSalas[sala.idSala] && sala.estadoActual === "FINALIZADO"
                    && sala.votosRevancha && sala.votosRevancha.size > 0) {
                    iniciarRevancha(sala, io);
                }
            }, 60000);
        }, 2500);
    }
}

function gestionarTurnos(sala, io, esInicio = false) {
    if (!estadoSalas[sala.idSala] || sala.estadoActual !== "TURNOS_INTERCAMBIO") return;

    if (temporizadores[sala.idSala]) {
        clearTimeout(temporizadores[sala.idSala]);
        delete temporizadores[sala.idSala];
    }

    let indiceActual = sala.turnoActualIndex;

    // Campana: si la vuelta llegó al que tocó la campana → resolver
    if (sala.campanaTocada && sala.campanaTocadorIndex !== -1 && indiceActual === sala.campanaTocadorIndex) {
        resolverRonda(sala, io);
        return;
    }
    let jugadorActual = sala.jugadores[indiceActual];
    let jugadorDerecha = sala.jugadores[siguienteVivo(sala.jugadores, indiceActual)];

    if (jugadorActual.vidas <= 0) {
        if (indiceActual === sala.dealerIndex) {
            resolverRonda(sala, io);
        } else {
            let intentos = 0;
            do {
                sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
                intentos++;
            } while (intentos < sala.jugadores.length && sala.jugadores[sala.turnoActualIndex] && sala.jugadores[sala.turnoActualIndex].vidas <= 0);
            if (!sala.jugadores[sala.turnoActualIndex] || sala.jugadores[sala.turnoActualIndex].vidas <= 0) {
                resolverRonda(sala, io);
                return;
            }
            gestionarTurnos(sala, io, false);
        }
        return;
    }

    let debeSaltar = false;
    let razon = "";
    const esCampana = sala.config.modoJuego === 'CAMPANA';

    if (!esCampana && jugadorActual.cartaActual === 9) {
        debeSaltar = true;
        razon = `👑 ${jugadorActual.nombre} tiene al Rey. Turno auto-completado.`;
    } else if (!esCampana && sala.config.modoRey === "DECLARADO" && jugadorDerecha.cartaActual === 9 && indiceActual !== sala.dealerIndex) {
        debeSaltar = true;
        razon = `🛡️ ${jugadorActual.nombre} está atrapado por el Rey Declarado. Turno saltado.`;
    }

    if (debeSaltar) {
        if (esInicio) {
            io.to(sala.idSala).emit('juegoIniciado', {
                id: jugadorActual.id, nombre: jugadorActual.nombre,
                tiempo: 0, jugadores: jugadoresPublicos(sala),
                modoRey: sala.config.modoRey,
                modoJuego: sala.config.modoJuego || 'CLASICO',
                campanaTocada: sala.campanaTocada
            });
        }
        jugadorActual.yaJugo = true;
        io.to(sala.idSala).emit('turnoSaltadoVisual', jugadorActual.id);
        io.to(sala.idSala).emit('mensajeGlobal', razon);
        setTimeout(() => {
            if (!estadoSalas[sala.idSala]) return;
            if (indiceActual === sala.dealerIndex) {
                resolverRonda(sala, io);
            } else {
                sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
                // gestionarTurnos ya arranca el reloj con la duración correcta del
                // jugador (10s online / 30s offline). No volver a llamar iniciarReloj
                // sin argumento: pisaría esa duración con el default de 10s.
                gestionarTurnos(sala, io, false);
            }
        }, 1200);
    } else {
        let idJugadorEnTurno = jugadorActual.id;
        // Tiempo elegido en la sala; si el jugador está desconectado se le dan
        // al menos 30s de gracia para que alcance a volver.
        const tiempoSala = sala.config.tiempoTurno || 10;
        let tiempoTurno = jugadorActual.online ? tiempoSala : Math.max(30, tiempoSala);

        // Primer turno de la ronda: el cliente arranca el reloj visual recién tras
        // el vuelo+flip de la carta (~800ms después de juegoIniciado), mientras que
        // el cronómetro real del server arrancaría ya. Sin compensar, el server
        // cortaría el turno con ~1s todavía visible en pantalla. Sumamos ese
        // colchón SOLO al timer real (`tiempo` que ve el cliente queda igual) para
        // que el cronómetro real y el reloj visual lleguen a 0 a la vez.
        const SEG_EXTRA_PRIMER_TURNO = 1;
        const tiempoReloj = esInicio ? tiempoTurno + SEG_EXTRA_PRIMER_TURNO : tiempoTurno;

        const payloadTurno = {
            id: idJugadorEnTurno, nombre: jugadorActual.nombre,
            tiempo: tiempoTurno, jugadores: jugadoresPublicos(sala),
            modoRey: sala.config.modoRey,
            modoJuego: sala.config.modoJuego || 'CLASICO',
            campanaTocada: sala.campanaTocada
        };
        if (esInicio) {
            io.to(sala.idSala).emit('juegoIniciado', payloadTurno);
        } else {
            io.to(sala.idSala).emit('cambioDeTurno', payloadTurno);
        }

        if (jugadorActual.esBot) {
            const decision = bots.decidirBot(sala, jugadorActual, {
                esDealer: indiceActual === sala.dealerIndex,
                derecha: jugadorDerecha,
                derechaEsRinger: esCampana && sala.campanaTocada && jugadorDerecha.id === sala.campanaTocadorId,
            });
            setTimeout(() => {
                const salaActual = estadoSalas[sala.idSala];
                if (!salaActual) return;
                const botVivo = salaActual.jugadores.find(j => j.id === jugadorActual.id && j.vidas > 0);
                if (!botVivo) return;
                ejecutarAccion(sala.idSala, decision, io, jugadorActual.id);
            }, bots.retrasoBot());
            return;
        }

        iniciarReloj(sala.idSala, io, tiempoReloj);
    }
}

function iniciarReloj(idSala, io, tiempoSegundos) {
    if (temporizadores[idSala]) clearTimeout(temporizadores[idSala]);
    temporizadores[idSala] = setTimeout(() => {
        const sala = estadoSalas[idSala];
        if (!sala || sala.estadoActual !== "TURNOS_INTERCAMBIO") return;
        const jugadorActual = sala.jugadores[sala.turnoActualIndex];
        const razonTimeout = jugadorActual.online
            ? `⏰ Tiempo agotado para ${jugadorActual.nombre}. Se mantiene su carta.`
            : `📵 ${jugadorActual.nombre} está desconectado. Se mantiene su carta automáticamente.`;
        io.to(idSala).emit('mensajeGlobal', razonTimeout);
        io.to(idSala).emit('accionMesa', {
            tipo: 'TIMEOUT',
            icono: '⏰',
            jugador: jugadorActual.nombre,
            texto: `Tiempo agotado: ${jugadorActual.nombre} mantiene`
        });
        ejecutarAccion(idSala, 'MANTENER', io, jugadorActual.id, true);
    }, (tiempoSegundos || 10) * 1000);
}

function iniciarRonda(sala, io) {
    // Guardia: se llama desde varios setTimeout (revancha, fin de turno)
    if (!estadoSalas[sala.idSala]) return;
    sala.rondaActual += 1;
    sala.estadoActual = "TURNOS_INTERCAMBIO";

    io.to(sala.idSala).emit('accionMesa', {
        tipo: 'RONDA',
        icono: '⚔️',
        texto: `Comienza la Ronda ${sala.rondaActual}`
    });

    // Reset campana
    sala.campanaTocada       = false;
    sala.campanaTocadorId    = null;
    sala.campanaTocadorIndex = -1;
    sala.vueltasCampana      = 0;

    let vivos = sala.jugadores.filter(j => j.vidas > 0);

    // Reshuffle si no hay suficientes cartas para repartir
    if (sala.mazo.length < vivos.length) {
        sala.mazo = barajar([...sala.mazo, ...sala.descarte]);
        sala.descarte = [];
        io.to(sala.idSala).emit('mensajeGlobal', '🔀 ¡La baraja se agotó y fue mezclada de nuevo!');
    }

    if (sala.mazo.length < vivos.length) {
        io.to(sala.idSala).emit('mensajeGlobal', '⚠️ No hay cartas suficientes para repartir. La partida no puede continuar.');
        sala.estadoActual = "FINALIZADO";
        const sobrevivientes = vivos;
        const ganador = sobrevivientes[0] || { nombre: "Nadie", vidas: 0 };
        io.to(sala.idSala).emit('finDelJuego', ganador);
        registrarFinPartida(sala, ganador);
        return;
    }

    sala.jugadores.forEach(j => {
        j.yaJugo = false;
        if (j.vecesRey === undefined) j.vecesRey = 0;
        if (j.reyAnterior === undefined) j.reyAnterior = false;
    });

    vivos.forEach(j => { j.cartaActual = sala.mazo.pop(); });
    bots.olvidarRonda(sala.jugadores);

    let jugadoresConNueve = vivos.filter(j => j.cartaActual === 9);
    jugadoresConNueve.forEach(suertudo => {
        let debeCambiar = suertudo.reyAnterior === true || suertudo.vecesRey > 0;
        if (debeCambiar) {
            let candidatoPobre = vivos.find(j => j.cartaActual !== 9 && j.reyAnterior === false && j.vecesRey < suertudo.vecesRey);
            if (!candidatoPobre) candidatoPobre = vivos.find(j => j.cartaActual !== 9 && j.reyAnterior === false);
            if (candidatoPobre) {
                let temp = candidatoPobre.cartaActual;
                candidatoPobre.cartaActual = 9;
                suertudo.cartaActual = temp;
                candidatoPobre.vecesRey += 1;
            } else {
                suertudo.vecesRey += 1;
            }
        } else {
            suertudo.vecesRey += 1;
        }
    });

    vivos.forEach(j => { j.reyAnterior = (j.cartaActual === 9); });

    if (sala.rondaActual > 1) {
        let intentosDealer = 0;
        do {
            sala.dealerIndex = (sala.dealerIndex + 1) % sala.jugadores.length;
            intentosDealer++;
        } while (sala.jugadores[sala.dealerIndex] && sala.jugadores[sala.dealerIndex].vidas <= 0 && intentosDealer < sala.jugadores.length);
        if (!sala.jugadores[sala.dealerIndex] || sala.jugadores[sala.dealerIndex].vidas <= 0) return;
    }

    vivos = sala.jugadores.filter(j => j.vidas > 0);
    if (vivos.length === 0) return;

    sala.turnoActualIndex = sala.dealerIndex;
    let encontrado = false;
    for (let i = 0; i < sala.jugadores.length; i++) {
        sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
        if (sala.jugadores[sala.turnoActualIndex] && sala.jugadores[sala.turnoActualIndex].vidas > 0) {
            encontrado = true;
            break;
        }
    }
    if (!encontrado) {
        const primerVivo = sala.jugadores.findIndex(j => j.vidas > 0);
        if (primerVivo === -1) return;
        sala.turnoActualIndex = primerVivo;
    }

    sala.jugadores.forEach((j, i) => { j.dealer = (i === sala.dealerIndex); });

    io.to(sala.idSala).emit('datosMesa', {
        ronda: sala.rondaActual,
        dealer: sala.jugadores[sala.dealerIndex].nombre,
        modoRey: sala.config.modoRey,
        modoJuego: sala.config.modoJuego || 'CLASICO',
        cartasRestantes: sala.mazo.length,
        jugadores: jugadoresPublicos(sala)
    });

    sala.jugadores.forEach(j => {
        if (j.vidas > 0 && j.online) io.to(j.id).emit('tuCarta', j.cartaActual);
    });

    if (sala.config.modoRey === "DECLARADO") {
        sala.jugadores.forEach(j => {
            if (j.vidas > 0 && j.cartaActual === 9) {
                io.to(sala.idSala).emit('mensajeGlobal', `🔔 El Rey está a la vista en manos de ${j.nombre}.`);
            }
        });
    }

    setTimeout(() => { gestionarTurnos(sala, io, true); }, 500);
}

function ejecutarAccion(idSala, accion, io, socketId, porTimeout = false) {
    let sala = estadoSalas[idSala];
    if (!sala) return;
    tocarSala(sala); // actividad para el sweeper

    if (temporizadores[idSala]) {
        clearTimeout(temporizadores[idSala]);
        delete temporizadores[idSala];
    }

    let indiceActual = sala.turnoActualIndex;
    let jugadorActual = sala.jugadores[indiceActual];

    if (jugadorActual.id !== socketId) return;
    if (jugadorActual.vidas <= 0) return;

    if (accion === 'CAMPANA') {
        if (sala.config.modoJuego !== 'CAMPANA' || sala.campanaTocada) return;
        sala.campanaTocada       = true;
        sala.campanaTocadorId    = socketId;
        sala.campanaTocadorIndex = indiceActual;
        jugadorActual.yaJugo     = true;

        io.to(idSala).emit('campanaTocada', { jugadorId: socketId, nombre: jugadorActual.nombre });
        io.to(idSala).emit('mensajeGlobal', `🔔 ¡${jugadorActual.nombre} tocó la campana! Última vuelta para todos.`);
        io.to(idSala).emit('accionMesa', {
            tipo: 'CAMPANA',
            icono: '🔔',
            jugador: jugadorActual.nombre,
            texto: `¡${jugadorActual.nombre} tocó la campana!`
        });

        // Avanzar al siguiente jugador vivo
        sala.turnoActualIndex = siguienteVivo(sala.jugadores, sala.turnoActualIndex);

        // Si no hay más jugadores vivos después del ringer → resolver directo
        if (!sala.jugadores[sala.turnoActualIndex] || sala.jugadores[sala.turnoActualIndex].vidas <= 0 || sala.turnoActualIndex === indiceActual) {
            resolverRonda(sala, io);
            return;
        }

        setTimeout(() => {
            if (!estadoSalas[idSala]) return;
            // gestionarTurnos arranca el reloj con la duración correcta; no volver
            // a llamar iniciarReloj sin argumento (pisaría con el default de 10s).
            gestionarTurnos(sala, io, false);
        }, 500);
        return;
    }

    if (accion === 'CAMBIAR') {
        if (indiceActual !== sala.dealerIndex) {
            let jugadorDerecha = sala.jugadores[siguienteVivo(sala.jugadores, indiceActual)];
            const bloqueRey = sala.config.modoJuego !== 'CAMPANA' && jugadorDerecha.cartaActual === 9;
            const derechaEsRinger = sala.config.modoJuego === 'CAMPANA' && sala.campanaTocada && jugadorDerecha.id === sala.campanaTocadorId;

            if (bloqueRey) {
                const msgBloqueo = sala.config.modoRey === "DECLARADO"
                    ? `🛡️ ${jugadorActual.nombre} no puede cambiar — el Rey ya está a la vista.`
                    : `🛡️ ¡BLOQUEO REAL! ${jugadorActual.nombre} chocó con el Rey de ${jugadorDerecha.nombre}.`;
                io.to(idSala).emit('mensajeGlobal', msgBloqueo);
                io.to(idSala).emit('accionMesa', {
                    tipo: 'BLOQUEO',
                    icono: '👑',
                    jugador: jugadorActual.nombre,
                    objetivo: jugadorDerecha.nombre,
                    texto: `¡Rey de ${jugadorDerecha.nombre} frenó a ${jugadorActual.nombre}!`
                });
            } else if (derechaEsRinger) {
                // Jugador adyacente al que tocó campana → roba del mazo en vez de intercambiar
                if (sala.mazo.length === 0 && sala.descarte.length > 0) {
                    sala.mazo = barajar([...sala.descarte]);
                    sala.descarte = [];
                    io.to(sala.idSala).emit('mensajeGlobal', '🔀 ¡La baraja se agotó y fue mezclada de nuevo!');
                }
                if (sala.mazo.length > 0) {
                    const cartaVieja = jugadorActual.cartaActual;
                    let nuevaCarta = sala.mazo.pop();
                    sala.descarte.push(cartaVieja);
                    jugadorActual.cartaActual = nuevaCarta;
                    bots.olvidarCarta(sala.jugadores, jugadorActual);
                    io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                    io.to(idSala).emit('mensajeGlobal', `🃏 ${jugadorActual.nombre} robó del mazo (no puede cambiar con quien tocó la campana).`);
                    io.to(idSala).emit('actualizarMazo', { cartasRestantes: sala.mazo.length });
                    io.to(idSala).emit('accionMesa', {
                        tipo: 'MAZO',
                        icono: '🃏',
                        jugador: jugadorActual.nombre,
                        texto: `${jugadorActual.nombre} robó del mazo (campana)`
                    });
                } else {
                    io.to(idSala).emit('mensajeGlobal', `⚠️ No quedan cartas en el mazo, ${jugadorActual.nombre} mantiene.`);
                    io.to(idSala).emit('accionMesa', {
                        tipo: 'MANTENER',
                        icono: '✋',
                        jugador: jugadorActual.nombre,
                        texto: `${jugadorActual.nombre} mantiene (sin cartas)`
                    });
                }
            } else {
                let temp = jugadorActual.cartaActual;
                bots.recordarCambio(sala.jugadores, jugadorActual, jugadorDerecha, temp, jugadorDerecha.cartaActual);
                jugadorActual.cartaActual = jugadorDerecha.cartaActual;
                jugadorDerecha.cartaActual = temp;
                io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                io.to(jugadorDerecha.id).emit('tuCarta', jugadorDerecha.cartaActual);
                io.to(idSala).emit('mensajeGlobal', `🔄 ${jugadorActual.nombre} cambió con ${jugadorDerecha.nombre}.`);
                io.to(idSala).emit('accionMesa', {
                    tipo: 'CAMBIO',
                    icono: '🔄',
                    jugador: jugadorActual.nombre,
                    objetivo: jugadorDerecha.nombre,
                    texto: `${jugadorActual.nombre} cambió con ${jugadorDerecha.nombre}`
                });
                if (sala.config.modoRey === "DECLARADO" && sala.config.modoJuego !== 'CAMPANA') {
                    jugadorActual.cartaRevelada = jugadorActual.cartaActual === 9;
                    jugadorDerecha.cartaRevelada = jugadorDerecha.cartaActual === 9;
                }
            }
        } else {
            // Reshuffle descarte si el mazo está vacío
            if (sala.mazo.length === 0 && sala.descarte.length > 0) {
                sala.mazo = barajar([...sala.descarte]);
                sala.descarte = [];
                io.to(sala.idSala).emit('mensajeGlobal', '🔀 ¡La baraja se agotó y fue mezclada de nuevo!');
            }

            if (sala.mazo.length > 0) {
                const cartaVieja = jugadorActual.cartaActual;
                let nuevaCarta = sala.mazo.pop();
                // Si el mazo tiene múltiples 9s y la carta es igual, intentar con la siguiente
                if (nuevaCarta === cartaVieja && sala.mazo.length > 0) {
                    sala.descarte.push(nuevaCarta);
                    nuevaCarta = sala.mazo.pop();
                }
                sala.descarte.push(cartaVieja);
                jugadorActual.cartaActual = nuevaCarta;
                bots.olvidarCarta(sala.jugadores, jugadorActual);
                io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                io.to(idSala).emit('mensajeGlobal', `🃏 El Dealer (${jugadorActual.nombre}) cambió su carta con el mazo.`);
                io.to(idSala).emit('actualizarMazo', { cartasRestantes: sala.mazo.length });
                io.to(idSala).emit('accionMesa', {
                    tipo: 'MAZO',
                    icono: '🃏',
                    jugador: jugadorActual.nombre,
                    texto: `Dealer (${jugadorActual.nombre}) cambió con el mazo`
                });
            } else {
                io.to(idSala).emit('mensajeGlobal', `⚠️ No quedan cartas en el mazo, el Dealer mantiene.`);
                io.to(idSala).emit('accionMesa', {
                    tipo: 'MANTENER',
                    icono: '✋',
                    jugador: jugadorActual.nombre,
                    texto: `${jugadorActual.nombre} mantiene (sin cartas)`
                });
            }
        }
    } else {
        if (!porTimeout) {
            io.to(idSala).emit('mensajeGlobal', `✋ ${jugadorActual.nombre} decidió mantener.`);
            io.to(idSala).emit('accionMesa', {
                tipo: 'MANTENER',
                icono: '✋',
                jugador: jugadorActual.nombre,
                texto: `${jugadorActual.nombre} se plantó`
            });
        }
    }

    jugadorActual.yaJugo = true;

    const esDealer = indiceActual === sala.dealerIndex;
    const esModoCampana = sala.config.modoJuego === 'CAMPANA';

    if (esDealer && !esModoCampana) {
        // Clásico: el dealer termina la ronda
        setTimeout(() => { resolverRonda(sala, io); }, 1000);
    } else {
        // Campana: al pasar por el dealer se incrementa el contador de vueltas
        if (esDealer && esModoCampana) {
            sala.vueltasCampana = (sala.vueltasCampana || 0) + 1;
            if (sala.vueltasCampana >= 2) {
                // 2 vueltas sin campana → resolver con penalización
                setTimeout(() => { resolverRonda(sala, io); }, 1000);
                return;
            }
        }
        sala.turnoActualIndex = siguienteVivo(sala.jugadores, sala.turnoActualIndex);
        gestionarTurnos(sala, io, false);
    }
}

function iniciarRevancha(sala, io) {
    if (!estadoSalas[sala.idSala]) return;
    if (sala.estadoActual !== "FINALIZADO") return;
    if (sala.revanchaIniciada) return;
    if (!sala.votosRevancha || sala.votosRevancha.size === 0) return;

    // Si todos los votantes se desconectaron mientras esperábamos, no tiene
    // sentido empezar revancha. La sala muere natural al swept.
    const votantesOnline = sala.jugadores.filter(
        j => !j.esBot && j.online && sala.votosRevancha.has(j.nombre)
    );
    if (votantesOnline.length === 0) {
        log.info('Revancha cancelada: sin votantes online', { idSala: sala.idSala });
        return;
    }

    sala.revanchaIniciada = true;
    tocarSala(sala);

    // try/finally garantiza que `revanchaIniciada` se libera aunque algo falle
    // entre acá y el set explícito a false al final. Sin esto, un error dejaría
    // la sala atascada (próximas llamadas a iniciarRevancha serían no-op).
    try {
        // Cancelar timers de desconexión de jugadores que NO seguirán en la revancha
        // (bots, humanos offline, o humanos que no votaron). Sin esto, un timer
        // pendiente podría disparar y emitir "no regresó a tiempo" sobre alguien
        // que ya no existe.
        sala.jugadores.forEach(j => {
            const sigue = !j.esBot && j.online && sala.votosRevancha.has(j.nombre);
            if (!sigue && temporizadoresDesconexion[j.nombre]) {
                clearTimeout(temporizadoresDesconexion[j.nombre]);
                delete temporizadoresDesconexion[j.nombre];
            }
        });

        // Solo quedan los humanos online que votaron revancha
        sala.jugadores = sala.jugadores.filter(
            j => !j.esBot && j.online && sala.votosRevancha.has(j.nombre)
        );
        sala.jugadores.forEach(j => {
            j.vidas = sala.config.vidas;
            j.yaJugo = false;
            j.vecesRey = 0;
            j.reyAnterior = false;
            j.cartaRevelada = false;
        });

        // Rellenar con bots si no completaron el número de jugadores
        const botsNecesarios = sala.config.maxJugadores - sala.jugadores.length;
        const nombresUsadosRev = sala.jugadores.map(j => j.nombre);
        for (let i = 1; i <= botsNecesarios; i++) {
            const nombre = nombreBotAleatorio(nombresUsadosRev);
            nombresUsadosRev.push(nombre);
            sala.jugadores.push({
                id: 'bot_revancha_' + i, nombre,
                vidas: sala.config.vidas, yaJugo: false,
                online: true, esBot: true,
                vecesRey: 0, reyAnterior: false
            });
        }

        sala.votosRevancha = new Set();
        sala.rondaActual = 0;
        sala.dealerIndex = 0;
        sala.mazo = crearMazo(sala.config);
        sala.descarte = [];
        sala.estadoActual = "EN_JUEGO";

        io.to(sala.idSala).emit('revanchaIniciando');
        setTimeout(() => { iniciarRonda(sala, io); }, 1500);
    } finally {
        sala.revanchaIniciada = false;
    }
}

// ==========================================
// CONEXIONES SOCKET
// ==========================================
io.on('connection', (socket) => {
    const nombreUsuarioLogueado = socket.usuario.username;
    log.info('Socket conectado', { user: nombreUsuarioLogueado, socketId: socket.id });

    // Radar de partidas pendientes
    let salaPendiente = null;
    for (let id in estadoSalas) {
        let sala = estadoSalas[id];
        let enEstaSala = sala.jugadores.find(j =>
            j.nombre === nombreUsuarioLogueado &&
            j.vidas > 0 &&
            (sala.estadoActual === "TURNOS_INTERCAMBIO" || sala.estadoActual === "REVELACION")
        );
        if (enEstaSala) { salaPendiente = id; break; }
    }
    if (salaPendiente) {
        setTimeout(() => { socket.emit('partidaPendiente', salaPendiente); }, 800);
    }

    socket.on('abandonarSala', (idSala) => {
        if (!permitir(socket.id, 'abandonarSala', 1000)) return;
        if (!esIdSalaValido(idSala)) return;
        let sala = estadoSalas[idSala];
        if (!sala) return;
        let idx = sala.jugadores.findIndex(j => j.nombre === nombreUsuarioLogueado);
        if (idx !== -1) {
            if (sala.estadoActual === "LOBBY") {
                sala.jugadores.splice(idx, 1);
                if (sala.jugadores.length === 0) limpiarSala(idSala);
                else emitirLobby(idSala);
            } else {
                sala.jugadores[idx].vidas = 0;
                sala.jugadores[idx].online = false;
                io.to(idSala).emit('mensajeGlobal', `🏳️ ${nombreUsuarioLogueado} ha desertado de la corte.`);

                // Si el desertor estaba en turno, su carta quedó con vidas=0 y
                // ejecutarAccion corta temprano en `vidas <= 0` → la partida se
                // colgaría hasta que el sweeper borre la sala. Cancelar el timer
                // de turno y avanzar manualmente al siguiente jugador vivo.
                if (sala.estadoActual === "TURNOS_INTERCAMBIO" && sala.turnoActualIndex === idx) {
                    if (temporizadores[idSala]) {
                        clearTimeout(temporizadores[idSala]);
                        delete temporizadores[idSala];
                    }
                    if (idx === sala.dealerIndex) {
                        resolverRonda(sala, io);
                    } else {
                        let intentos = 0;
                        do {
                            sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
                            intentos++;
                        } while (
                            intentos < sala.jugadores.length &&
                            sala.jugadores[sala.turnoActualIndex] &&
                            sala.jugadores[sala.turnoActualIndex].vidas <= 0
                        );
                        gestionarTurnos(sala, io, false);
                    }
                }
            }
        }
    });

    socket.on('crearSala', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const { configuracion } = payload;
        if (!permitir(socket.id, 'crearSala', 3000)) return;

        // Sanitizar configuración — el cliente puede mandar cualquier cosa.
        // Sin esto: vidas=999, maxJugadores=1000, numBots=100 son aceptados → DoS.
        const cfg = sanitizarConfig(configuracion);
        if (!cfg) return socket.emit('errorSala', 'Configuración inválida.');

        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let idSala = '';
        for (let i = 0; i < 5; i++) idSala += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

        // Hashear la password de sala — guardarla en plaintext la expondría
        // a cualquier log/dump del objeto estadoSalas.
        const password = cfg.password ? bcrypt.hashSync(cfg.password, 10) : null;
        delete cfg.password; // no exponer en config pública

        estadoSalas[idSala] = {
            idSala, estadoActual: "LOBBY", config: cfg, password, hostId: socket.id,
            jugadores: [{ id: socket.id, nombre: nombreUsuarioLogueado, vidas: cfg.vidas, yaJugo: false, online: true }],
            dealerIndex: 0, turnoActualIndex: 1, mazo: [], descarte: [], rondaActual: 1,
            campanaTocada: false, campanaTocadorId: null, campanaTocadorIndex: -1,
            ultimaActividad: Date.now() // para el sweeper de salas zombi
        };

        const numBots = cfg.numBots;
        const nombresUsados = estadoSalas[idSala].jugadores.map(j => j.nombre);
        for (let i = 1; i <= numBots; i++) {
            const nombre = nombreBotAleatorio(nombresUsados);
            nombresUsados.push(nombre);
            estadoSalas[idSala].jugadores.push({
                id: 'bot_' + i, nombre,
                vidas: cfg.vidas, yaJugo: false, online: true, esBot: true
            });
        }

        socket.join(idSala);
        socket.emit('salaCreada', idSala);
        emitirLobby(idSala); // ← USA HELPER
        log.info('Sala creada', { idSala, host: nombreUsuarioLogueado, bots: cfg.numBots });
    });

    socket.on('unirseSala', (payload) => {
        // Límite generoso: el cliente puede reconectar legítimamente por
        // visibilitychange, lock de teléfono, etc. 500ms basta para bloquear
        // spam sin romper reconexiones genuinas (suelen estar a >1s entre sí).
        if (!permitir(socket.id, 'unirseSala', 500)) return;
        if (!payload || typeof payload !== 'object') return;
        const { idSala, password } = payload;

        const username = socket.usuario ? socket.usuario.username : null;
        if (!username) return socket.emit('errorSala', 'Error de sesión. Vuelve a iniciar.');

        if (!esIdSalaValido(idSala)) return socket.emit('errorSala', 'Código de sala inválido.');
        if (password !== undefined && password !== null && typeof password !== 'string') return;

        const sala = estadoSalas[idSala.toUpperCase()];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        tocarSala(sala); // actividad para el sweeper

        let jugadorExistente = sala.jugadores.find(j => j.nombre === username);

        if (jugadorExistente) {
            // Detectar sesión activa duplicada (otra pestaña o token reutilizado).
            // Reasignar id ANTES de desconectar al socket viejo: el handler de
            // disconnect busca al jugador por socket.id y ya no lo encontrará → no-op.
            const socketAnterior = io.sockets.sockets.get(jugadorExistente.id);
            const reemplazandoSesion = socketAnterior && socketAnterior.id !== socket.id;

            if (temporizadoresDesconexion[username]) {
                clearTimeout(temporizadoresDesconexion[username]);
                delete temporizadoresDesconexion[username];
                io.to(sala.idSala).emit('mensajeGlobal', `🔌 ${username} regresó a la batalla a tiempo.`);
            }
            jugadorExistente.id = socket.id;
            jugadorExistente.online = true;
            socket.join(sala.idSala);

            if (reemplazandoSesion) {
                socketAnterior.emit('sesionReemplazada', 'Te conectaste desde otra pestaña o dispositivo.');
                // Delay para que el paquete del emit llegue antes de cerrar el socket
                setTimeout(() => socketAnterior.disconnect(true), 150);
            }

            if (sala.estadoActual !== "LOBBY") {
                socket.emit('reconexionExitosa', {
                    idSala: sala.idSala,
                    carta: jugadorExistente.cartaActual,
                    ronda: sala.rondaActual,
                    dealer: sala.jugadores[sala.dealerIndex].nombre,
                    jugadores: jugadoresPublicos(sala),
                    estado: sala.estadoActual,
                    turnoEnCurso: sala.jugadores[sala.turnoActualIndex].id,
                    turnoNombre: sala.jugadores[sala.turnoActualIndex].nombre,
                    modoRey: sala.config.modoRey
                });
                let jActual = sala.jugadores[sala.turnoActualIndex];
                if (sala.estadoActual === "TURNOS_INTERCAMBIO" && jActual.nombre === username) {
                    socket.emit('cambioDeTurno', { id: socket.id, nombre: username });
                }
            } else {
                emitirLobby(sala.idSala); // ← USA HELPER
            }
            return;
        }

        if (sala.estadoActual !== "LOBBY") return socket.emit('errorSala', 'El juego ya comenzó.');
        if (sala.jugadores.length >= sala.config.maxJugadores) return socket.emit('errorSala', 'La sala está llena.');
        if (sala.password && !bcrypt.compareSync((password || '').trim(), sala.password)) {
            return socket.emit('errorSala', 'WRONG_PASSWORD');
        }

        socket.join(sala.idSala);
        sala.jugadores.push({ id: socket.id, nombre: username, vidas: sala.config.vidas, yaJugo: false, online: true });
        emitirLobby(sala.idSala); // ← USA HELPER
    });

    socket.on('iniciarPartida', (idSala) => {
        if (!permitir(socket.id, 'iniciarPartida', 1000)) return;
        if (!esIdSalaValido(idSala)) return;
        let sala = estadoSalas[idSala];
        if (sala && sala.jugadores[0].nombre === nombreUsuarioLogueado) {
            sala.rondaActual = 0;
            sala.dealerIndex = 0;
            sala.mazo = crearMazo(sala.config);
            sala.descarte = [];
            iniciarRonda(sala, io);
            log.info('Partida iniciada', { idSala, jugadores: sala.jugadores.length });
        }
    });

    socket.on('siguienteRonda', (id) => {
        if (!permitir(socket.id, 'siguienteRonda', 300)) return;
        if (!esIdSalaValido(id)) return;
        const sala = estadoSalas[id];
        if (!sala || sala.jugadores[sala.dealerIndex].nombre !== nombreUsuarioLogueado || sala.estadoActual !== "REVELACION") return;

        sala.estadoActual = "PREPARANDO_NUEVA_RONDA";
        let vivos = sala.jugadores.filter(j => j.vidas > 0);

        if (vivos.length === 1) {
            const ganador = vivos[0];
            sala.estadoActual = "FINALIZADO";
            io.to(id).emit('finDelJuego', ganador);
            registrarFinPartida(sala, ganador);
            return;
        } else if (vivos.length === 0) {
            sala.estadoActual = "FINALIZADO";
            const empate = { nombre: "Nadie (Empate Total)", vidas: 0 };
            io.to(id).emit('finDelJuego', empate);
            registrarFinPartida(sala, empate);
            return;
        }

        io.to(id).emit('nuevaRondaIniciada', { jugadoresActualizados: jugadoresPublicos(sala) });
        iniciarRonda(sala, io);
    });

    socket.on('accionJugador', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const { idSala, accion } = payload;
        if (!permitir(socket.id, 'accionJugador', 400)) return;
        if (!esIdSalaValido(idSala)) return;
        if (!['MANTENER', 'CAMBIAR', 'CAMPANA'].includes(accion)) return;

        // Validar identidad por nombre (no socket.id) para sobrevivir reconexiones
        // y prevenir que un socket extranjero ejecute un turno ajeno.
        const sala = estadoSalas[idSala];
        if (!sala) return;
        const jugadorEnTurno = sala.jugadores[sala.turnoActualIndex];
        if (!jugadorEnTurno || jugadorEnTurno.nombre !== nombreUsuarioLogueado) return;

        ejecutarAccion(idSala, accion, io, socket.id);
    });

    socket.on('quieroJugarOtraVez', (idSala) => {
        if (!permitir(socket.id, 'quieroJugarOtraVez', 500)) return;
        if (!esIdSalaValido(idSala)) return;
        const sala = estadoSalas[idSala];
        if (!sala || sala.estadoActual !== "FINALIZADO") return;
        if (!sala.votosRevancha) sala.votosRevancha = new Set();

        // El jugador debe estar realmente en la sala y online — un socket viejo
        // con token válido no debería poder votar revancha de salas ajenas.
        const jugador = sala.jugadores.find(
            j => !j.esBot && j.nombre === socket.usuario.username && j.online
        );
        if (!jugador) return;

        sala.votosRevancha.add(socket.usuario.username);
        tocarSala(sala);
        const humanos = sala.jugadores.filter(j => !j.esBot && j.online);
        io.to(idSala).emit('contadorRevancha', {
            votos: sala.votosRevancha.size,
            total: humanos.length
        });
        if (humanos.length > 0 && sala.votosRevancha.size >= humanos.length) {
            iniciarRevancha(sala, io);
        }
    });

    socket.on('reaccion', (payload) => {
        // El cliente tiene cooldown de 2500ms, pero el servidor lo refuerza con
        // 300ms — bloquea spam si alguien hace bypass del cliente.
        if (!permitir(socket.id, 'reaccion', 300)) return;
        if (!payload || typeof payload !== 'object') return;
        const { idSala, emoji } = payload;
        if (!esIdSalaValido(idSala)) return;
        if (!EMOJIS_REACCION.has(emoji)) return; // bloquea payloads gigantes / arbitrarios
        const sala = estadoSalas[idSala];
        if (!sala) return;
        const jugador = sala.jugadores.find(j => j.id === socket.id);
        if (!jugador) return;
        // Broadcast to others in the room
        socket.to(idSala).emit('reaccionJugador', { jugadorId: socket.id, emoji });
    });

    socket.on('disconnect', () => {
        // Limpiar entradas del rate limiter para este socket
        for (const key of Object.keys(_socketRates)) {
            if (key.startsWith(socket.id + ':')) delete _socketRates[key];
        }
        for (let id in estadoSalas) {
            let sala = estadoSalas[id];
            let idx = sala.jugadores.findIndex(j => j.id === socket.id);
            if (idx !== -1) {
                const jugador = sala.jugadores[idx];
                if (sala.estadoActual === "LOBBY") {
                    sala.jugadores.splice(idx, 1);
                    if (sala.jugadores.length === 0) {
                        limpiarSala(id);
                    } else {
                        emitirLobby(id); // ← USA HELPER
                    }
                } else if (sala.estadoActual === "FINALIZADO") {
                    jugador.online = false;
                    // Ignorar bots: tienen online=true siempre, sin esto la sala
                    // nunca se borra cuando se juega contra IA.
                    if (sala.jugadores.every(j => j.esBot || !j.online)) limpiarSala(id);
                } else {
                    jugador.online = false;
                    io.to(id).emit('mensajeGlobal', `⚠️ ${jugador.nombre} perdió la conexión. Tiene 3 minutos para volver.`);

                    // Si era su turno, cancelar el timer actual y acelerar a 8s para no bloquear el juego
                    if (sala.estadoActual === "TURNOS_INTERCAMBIO" && sala.turnoActualIndex === idx) {
                        if (temporizadores[id]) {
                            clearTimeout(temporizadores[id]);
                            delete temporizadores[id];
                        }
                        io.to(id).emit('mensajeGlobal', `⏳ Era el turno de ${jugador.nombre}. Jugando automáticamente en 8 segundos...`);
                        iniciarReloj(id, io, 8);
                    }

                    temporizadoresDesconexion[jugador.nombre] = setTimeout(() => {
                        delete temporizadoresDesconexion[jugador.nombre]; // limpiar la propia entry
                        let salaActual = estadoSalas[id];
                        if (salaActual) {
                            let jPerdido = salaActual.jugadores.find(x => x.nombre === jugador.nombre);
                            if (jPerdido && !jPerdido.online && jPerdido.vidas > 0) {
                                jPerdido.vidas = 0;
                                io.to(id).emit('mensajeGlobal', `☠️ ${jPerdido.nombre} no regresó a tiempo y fue eliminado.`);
                                io.to(id).emit('nuevaRondaIniciada', { jugadoresActualizados: jugadoresPublicos(salaActual) });
                            }
                        }
                    }, 180000); // 3 minutos — margen para bloqueo de pantalla en celular
                }
                break;
            }
        }
    });
});

// DDL (ALTER TABLE) no admite placeholders para nombres de columna ni tipos,
// así que tenemos que interpolar strings. Para evitar que un cambio futuro
// descuidado introduzca SQL injection, validamos cada nombre contra una regex
// estricta y la definición contra un whitelist explícito.
const REGEX_NOMBRE_COLUMNA = /^[a-z_][a-z0-9_]{0,63}$/;
const DEFINICIONES_COLUMNA_PERMITIDAS = new Set([
    'INT DEFAULT 0',
    'INT DEFAULT NULL',
    'VARCHAR(255) DEFAULT NULL',
    'TIMESTAMP DEFAULT CURRENT_TIMESTAMP',
]);

async function agregarColumnasSiNoExisten() {
    const columnas = [
        { nombre: 'partidas_jugadas', def: 'INT DEFAULT 0' },
        { nombre: 'racha_actual',     def: 'INT DEFAULT 0' },
        { nombre: 'racha_maxima',     def: 'INT DEFAULT 0' },
    ];
    for (const col of columnas) {
        if (!REGEX_NOMBRE_COLUMNA.test(col.nombre)) {
            log.error('Nombre de columna inválido, salteando', { columna: col.nombre });
            continue;
        }
        if (!DEFINICIONES_COLUMNA_PERMITIDAS.has(col.def)) {
            log.error('Definición de columna no permitida, salteando', {
                columna: col.nombre, def: col.def
            });
            continue;
        }
        const [rows] = await conRetry(
            () => pool.execute(
                `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = ?`,
                [col.nombre]
            ),
            { op: 'check_columna', columna: col.nombre }
        );
        if (rows[0].cnt === 0) {
            // Interpolación segura: ambos campos pasaron las validaciones de arriba.
            await conRetry(
                () => pool.execute(`ALTER TABLE usuarios ADD COLUMN ${col.nombre} ${col.def}`),
                { op: 'alter_table', columna: col.nombre }
            );
            log.info('Columna creada en migración', { columna: col.nombre });
        }
    }
}

const PUERTO = process.env.PORT || 4000;
server.listen(PUERTO, async () => {
    log.info('Servidor iniciado', { puerto: PUERTO });
    try {
        await agregarColumnasSiNoExisten();
        log.info('Migración de stats verificada');
    } catch (err) {
        log.error('Migración de stats falló', { error: err.message });
    }
});

// ==========================================
// SWEEPER DE SALAS ZOMBI
// ==========================================
// Cada 5 min recorre estadoSalas y borra las que quedaron atascadas:
// - LOBBY/EN_JUEGO/REVELACION sin actividad por 30 min → host nunca empezó,
//   todos se desconectaron sin disparar el handler, partida congelada, etc.
// - FINALIZADO sin actividad por 10 min → fin de partida, nadie pidió revancha.
// Sin esto: salas pueden persistir en memoria del proceso indefinidamente.
const SWEEPER_INTERVAL_MS = 5 * 60 * 1000;
const SALA_INACTIVA_MS = 30 * 60 * 1000;
const SALA_FINALIZADA_MS = 10 * 60 * 1000;

function sweepSalasZombi() {
    const ahora = Date.now();
    const aBorrar = [];
    for (const id in estadoSalas) {
        const sala = estadoSalas[id];
        const inactividad = ahora - (sala.ultimaActividad || 0);
        const limite = sala.estadoActual === "FINALIZADO" ? SALA_FINALIZADA_MS : SALA_INACTIVA_MS;
        if (inactividad > limite) {
            aBorrar.push({ id, estado: sala.estadoActual, minutos: Math.round(inactividad / 60000) });
        }
    }
    for (const { id, estado, minutos } of aBorrar) {
        log.info('Sweeper borra sala zombi', { idSala: id, estado, inactividad_min: minutos });
        limpiarSala(id);
    }
}

const sweeperInterval = setInterval(sweepSalasZombi, SWEEPER_INTERVAL_MS);

// ==========================================
// SHUTDOWN GRACEFUL
// ==========================================
// Sin esto: SIGTERM/SIGINT corta la conexión de los sockets bruscamente, las
// partidas activas mueren sin aviso, y timers pendientes pueden hacer ruido en
// los logs. Con esto: avisar al cliente, cancelar timers, cerrar todo en orden.
let cerrando = false;
async function shutdownGracefully(signal) {
    if (cerrando) {
        log.warn('Segunda señal de shutdown, forzando salida', { signal });
        process.exit(1);
    }
    cerrando = true;
    log.info('Shutdown graceful iniciado', { signal });

    // Avisar a clientes — el frontend mostrará un toast y dejará que Socket.io
    // reconecte automáticamente cuando el servidor vuelva.
    io.emit('servidorReiniciando', 'El servidor se está reiniciando.');

    // Dar tiempo a que el paquete viaje antes de cerrar las conexiones.
    await new Promise(r => setTimeout(r, 500));

    // Cancelar TODOS los timers pendientes para no disparar callbacks sobre
    // estado que estamos por destruir.
    clearInterval(sweeperInterval);
    for (const id of Object.keys(temporizadores)) clearTimeout(temporizadores[id]);
    for (const username of Object.keys(temporizadoresDesconexion)) clearTimeout(temporizadoresDesconexion[username]);

    // Cerrar Socket.io (rechaza conexiones nuevas y cierra las existentes).
    await new Promise(resolve => io.close(resolve));
    log.info('Socket.io cerrado');

    // Cerrar HTTP server, con timeout duro de 5s por si hay requests colgados.
    const httpCerrado = new Promise(resolve => {
        server.close(err => {
            if (err) log.error('Error cerrando HTTP server', { error: err.message });
            else log.info('HTTP server cerrado');
            resolve();
        });
    });
    await Promise.race([
        httpCerrado,
        new Promise(r => setTimeout(() => {
            log.warn('HTTP server no cerró en 5s, forzando');
            r();
        }, 5000)),
    ]);

    // Cerrar pool de DB para liberar las conexiones.
    try {
        await pool.end();
        log.info('Pool MySQL cerrado');
    } catch (e) {
        log.error('Error cerrando pool', { error: e.message });
    }

    log.info('Shutdown completado');
    process.exit(0);
}

process.on('SIGTERM', () => shutdownGracefully('SIGTERM'));
process.on('SIGINT', () => shutdownGracefully('SIGINT'));