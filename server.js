require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const bots = require('./bots');
const practica = require('./practica');
const logros = require('./logros');
const eventos = require('./eventos');
const poderes = require('./poderes');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { barajar, crearMazo, siguienteVivo, resolverCartas } = require('./reglas');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
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
app.use(compression()); // gzip: main.js/style.css/index.html pesan ~4 veces menos

// ==========================================
// CACHÉ DE ARCHIVOS CON VERSIÓN
// ==========================================
// index.html se sirve con main.js?v=<huella> y style.css?v=<huella>, donde la
// huella sale del contenido. Así esos archivos se guardan un año en el
// celular y, en cuanto cambian, la huella cambia y se descargan solos.
// index.html siempre se revalida (no-cache) para no quedar con una versión vieja.
const DIR_PUBLICO = path.join(__dirname, 'public');
const _huellas = {}; // archivo → { mtimeMs, huella }
function huellaDe(archivo) {
    const ruta = path.join(DIR_PUBLICO, archivo);
    const { mtimeMs } = fs.statSync(ruta);
    const guardada = _huellas[archivo];
    if (guardada && guardada.mtimeMs === mtimeMs) return guardada.huella;
    const huella = crypto.createHash('sha1').update(fs.readFileSync(ruta)).digest('hex').slice(0, 10);
    _huellas[archivo] = { mtimeMs, huella };
    return huella;
}
let _indexCache = { clave: '', html: '' };
function servirIndex(req, res) {
    const clave = `${huellaDe('index.html')}-${huellaDe('main.js')}-${huellaDe('style.css')}`;
    if (_indexCache.clave !== clave) {
        _indexCache = {
            clave,
            html: fs.readFileSync(path.join(DIR_PUBLICO, 'index.html'), 'utf8')
                .replace('href="style.css"', `href="style.css?v=${huellaDe('style.css')}"`)
                .replace('src="main.js"', `src="main.js?v=${huellaDe('main.js')}"`),
        };
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(_indexCache.html);
}
app.get(['/', '/index.html'], servirIndex);
app.use((req, res, next) => {
    if (req.query.v) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // con versión: un año
    else if (req.path.startsWith('/iconos/')) res.setHeader('Cache-Control', 'public, max-age=86400'); // íconos: un día
    else res.setHeader('Cache-Control', 'no-cache'); // lo demás: se revalida (ETag → 304 si no cambió)
    next();
});
app.use(express.static('public', { cacheControl: false }));

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
// Tiempo por turno fijo para todos los modos (ya no se elige al crear sala):
// con eventos, poderes y parejas hace falta tiempo para ver la mesa. La
// práctica guiada usa 60 s y un jugador desconectado tiene al menos 30 s.
const TIEMPO_TURNO = 20;

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

    // Partida de práctica guiada: mesa fija contra 2 bots con guion
    // (practica.js). Todo lo demás de la config se ignora.
    // Dos guiones (practica.js): 'basica' y 'poderes' (eventos y poderes).
    const tipoPractica = raw.practica === true || raw.practica === 'basica' ? 'basica'
        : raw.practica === 'poderes' ? 'poderes' : null;
    if (tipoPractica) {
        return { vidas: 3, maxJugadores: 3, numBots: 2, modoJuego: 'CLASICO',
                 modoRey: tipoPractica === 'basica' ? 'DECLARADO' : 'SORPRESA',
                 frecuenciaReyes: 'NORMAL', dificultadBots: 'NORMAL', tiempoTurno: 60,
                 practica: tipoPractica, eventos: false, poderes: tipoPractica === 'poderes', password: null };
    }

    let password = null;
    if (typeof raw.password === 'string') {
        const trimmed = raw.password.trim();
        if (trimmed.length > 0 && trimmed.length <= 50) password = trimmed;
        else if (trimmed.length > 50) return null; // rechazar passwords absurdamente largos
    }

    const conEventos = raw.eventos !== false; // eventos de ronda (solo afectan al modo clásico)
    const conPoderes = raw.poderes === true;  // modo "Con poderes" (opcional)
    // Parejas: 0 = sin equipos, 2 = 2 contra 2, 3 = 3 contra 3. La mesa queda
    // de 4 o 6 y al empezar se completa con bots.
    const equipos = enLista(Number.parseInt(raw.equipos, 10), [0, 2, 3], 0);
    const maxMesa = equipos ? equipos * 2 : maxJugadores;
    // En parejas los bots no ocupan lugares desde el lobby (dejarían fuera a
    // los amigos): entran al empezar, solo en los lugares que quedaron libres.
    return { vidas, maxJugadores: maxMesa, numBots: equipos ? 0 : Math.min(numBots, maxMesa - 1), modoJuego, modoRey, frecuenciaReyes,
             dificultadBots, tiempoTurno: TIEMPO_TURNO, eventos: conEventos, poderes: conPoderes, equipos, password };
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
// Frases rápidas: el cliente manda solo el número de la frase (su lista está en
// FRASES_RAPIDAS de main.js). Nunca texto libre: nada que moderar ni payloads raros.
const TOTAL_FRASES = 8;

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
    const sinCampana = sala.config.modoJuego !== 'CAMPANA';
    const escudos = sala.escudos || [];
    return sala.jugadores.map(({ memoria, cartaActual, cartaRevelada, reyDescubierto, poderes: susPoderes, turnosSinJugar, ...publico }) => {
        publico.numPoderes = (susPoderes || []).length; // la mesa ve cuántos, no cuáles
        publico.escudo = escudos.includes(publico.nombre);
        const esReyVisible = cartaActual === 9 && (reyDeclarado || (sinCampana && reyDescubierto));
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
        equipos: sala.config.equipos || 0,
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
// ==========================================
// CÓDIGO DE RECUPERACIÓN DE CUENTA
// ==========================================
// No se pide correo: al registrarse (o desde el perfil) el jugador recibe un
// código de 12 caracteres que se muestra una sola vez; en la base solo queda
// su hash bcrypt. Con usuario + código se cambia la contraseña, y el código
// usado se reemplaza por uno nuevo.
const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
function generarCodigoRecuperacion() {
    let c = '';
    for (let i = 0; i < 12; i++) c += ALFABETO_CODIGO[crypto.randomInt(ALFABETO_CODIGO.length)];
    return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}
// Acepta el código con o sin guiones, espacios o minúsculas.
function normalizarCodigo(c) {
    return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
async function nuevoCodigoRecuperacion(username) {
    const codigo = generarCodigoRecuperacion();
    const hash = await bcrypt.hash(normalizarCodigo(codigo), 10);
    await conRetry(
        () => pool.execute('UPDATE usuarios SET codigo_recuperacion = ? WHERE username = ?', [hash, username]),
        { op: 'guardar_codigo', username }
    );
    return codigo;
}

app.post('/recuperar', limitarLogin, async (req, res) => {
    const { username, codigo, password } = req.body || {};
    const error = 'Usuario o código de recuperación incorrectos.';
    if (!esUsernameLogin(username) || normalizarCodigo(codigo).length !== 12) return res.status(401).json({ error });
    if (!esPasswordValida(password)) return res.status(400).json({ error: 'La contraseña nueva debe tener entre 4 y 100 caracteres.' });
    try {
        const [rows] = await conRetry(
            () => pool.execute('SELECT username, codigo_recuperacion FROM usuarios WHERE username = ?', [username]),
            { op: 'recuperar' });
        const user = rows[0];
        // Siempre comparar contra un hash (real o dummy): mismo tiempo exista o no.
        const valido = await bcrypt.compare(normalizarCodigo(codigo), (user && user.codigo_recuperacion) || HASH_DUMMY_LOGIN);
        if (!user || !user.codigo_recuperacion || !valido) return res.status(401).json({ error });
        const hashPassword = await bcrypt.hash(password, 10);
        await conRetry(
            () => pool.execute('UPDATE usuarios SET password_hash = ? WHERE username = ?', [hashPassword, user.username]),
            { op: 'recuperar_password', username });
        const codigoRecuperacion = await nuevoCodigoRecuperacion(user.username);
        log.info('Contraseña recuperada con código', { username: user.username });
        res.json({ mensaje: 'Listo: cambiaste tu contraseña. Ya puedes iniciar sesión.', username: user.username, codigoRecuperacion });
    } catch (e) {
        log.error('Recuperar falló', { error: e.message, codigo: e.code });
        res.status(500).json({ error: 'Error en el servidor.' });
    }
});

// Genera un código nuevo (invalida el anterior). Requiere sesión iniciada.
app.post('/codigo-recuperacion', limitarAuth, async (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    let datos;
    try { datos = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión.' }); }
    try {
        const codigoRecuperacion = await nuevoCodigoRecuperacion(datos.username);
        res.json({ codigoRecuperacion });
    } catch (e) {
        log.error('Nuevo código falló', { error: e.message });
        res.status(500).json({ error: 'Error en el servidor.' });
    }
});

// ==========================================
// PANEL DE USO (/estadisticas.html)
// ==========================================
// Protegido con PANEL_CLAVE (.env) en el encabezado x-clave. Sin clave
// configurada, el panel queda apagado.
function claveDelPanelValida(req) {
    const esperada = process.env.PANEL_CLAVE || '';
    const recibida = String(req.headers['x-clave'] || '');
    if (!esperada || recibida.length !== esperada.length) return false;
    return crypto.timingSafeEqual(Buffer.from(recibida), Buffer.from(esperada));
}

app.get('/api/panel', limitarLectura, async (req, res) => {
    if (!claveDelPanelValida(req)) return res.status(401).json({ error: 'Clave incorrecta.' });
    const q = async (sql, p = []) => (await conRetry(() => pool.execute(sql, p), { op: 'panel' }))[0];
    try {
        const DIAS = 14;
        // Las filas guardadas antes de existir la columna `partida` se agrupan
        // por ganador y minuto (las de una misma partida se insertan juntas).
        const ID_PARTIDA = "COALESCE(partida, CONCAT('antes-', COALESCE(ganador, ''), '-', DATE_FORMAT(fecha, '%Y%m%d%H%i')))";
        const [totales] = await q(`SELECT
            (SELECT COUNT(*) FROM usuarios) AS usuarios,
            (SELECT COUNT(*) FROM usuarios WHERE fecha_registro >= NOW() - INTERVAL 7 DAY) AS nuevos7,
            (SELECT COUNT(DISTINCT ${ID_PARTIDA}) FROM historial) AS partidas,
            (SELECT COUNT(DISTINCT username) FROM historial WHERE fecha >= NOW() - INTERVAL 7 DAY) AS activos7,
            (SELECT COUNT(*) FROM logros) AS logros`);
        const porDia = await q(`SELECT DATE(fecha - INTERVAL 6 HOUR) AS dia, COUNT(DISTINCT ${ID_PARTIDA}) AS partidas, COUNT(DISTINCT username) AS jugadores
            FROM historial WHERE fecha - INTERVAL 6 HOUR >= DATE(NOW() - INTERVAL 6 HOUR) - INTERVAL ${DIAS - 1} DAY GROUP BY DATE(fecha - INTERVAL 6 HOUR)`);
        const registros = await q(`SELECT DATE(fecha_registro - INTERVAL 6 HOUR) AS dia, COUNT(*) AS n FROM usuarios
            WHERE fecha_registro - INTERVAL 6 HOUR >= DATE(NOW() - INTERVAL 6 HOUR) - INTERVAL ${DIAS - 1} DAY GROUP BY DATE(fecha_registro - INTERVAL 6 HOUR)`);
        const modos = await q(`SELECT modo, COUNT(DISTINCT ${ID_PARTIDA}) AS n FROM historial GROUP BY modo ORDER BY n DESC`);
        const caidas = await q(`SELECT cayo_ronda AS ronda, COUNT(*) AS n FROM historial WHERE cayo_ronda IS NOT NULL GROUP BY cayo_ronda ORDER BY cayo_ronda`);
        const [abandonos] = await q(`SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM historial) AS total FROM historial WHERE cayo_ronda IS NULL AND lugar <> 1`);
        const logrosGanados = await q(`SELECT logro, COUNT(*) AS n FROM logros GROUP BY logro`);

        // En vivo, desde la memoria del servidor.
        const salas = Object.values(estadoSalas);
        const enVivo = {
            conectados: io.engine.clientsCount,
            salasJugando: salas.filter(s => ["TURNOS_INTERCAMBIO", "REVELACION", "PREPARANDO_NUEVA_RONDA"].includes(s.estadoActual)).length,
            salasEsperando: salas.filter(s => s.estadoActual === "LOBBY").length,
            humanosEnMesa: salas.reduce((n, s) => n + s.jugadores.filter(j => !j.esBot && j.online).length, 0),
        };

        // Serie de días completa (los días sin partidas en cero), en hora de
        // la Ciudad de México (UTC-6); la base guarda UTC.
        const clave = d => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
        const hoyMx = new Date(Date.now() - 6 * 3600 * 1000);
        const dias = [];
        for (let i = DIAS - 1; i >= 0; i--) {
            const k = new Date(hoyMx.getTime() - i * 86400000).toISOString().slice(0, 10);
            const fila = porDia.find(r => clave(r.dia) === k) || {};
            const reg = registros.find(r => clave(r.dia) === k) || {};
            dias.push({ dia: k, partidas: fila.partidas || 0, jugadores: fila.jugadores || 0, registros: reg.n || 0 });
        }
        res.json({
            generado: new Date().toISOString(), totales, enVivo, dias, modos, caidas,
            abandonos: { n: abandonos.n, total: abandonos.total },
            logros: logros.CATALOGO.map(l => ({ id: l.id, titulo: l.titulo, n: (logrosGanados.find(g => g.logro === l.id) || {}).n || 0 })),
        });
    } catch (e) {
        log.error('Panel falló', { error: e.message });
        res.status(500).json({ error: 'Error al cargar el panel.' });
    }
});

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
        // Si falla guardar el código, la cuenta igual queda creada: se genera
        // después desde el perfil.
        const codigoRecuperacion = await nuevoCodigoRecuperacion(username).catch(() => null);
        res.status(201).json({ mensaje: '¡Cuenta creada! Ya puedes iniciar sesión.', codigoRecuperacion });
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
        const [ganados] = await conRetry(
            () => pool.execute('SELECT logro, fecha FROM logros WHERE username = ? ORDER BY fecha', [username]),
            { op: 'mis-logros', username });
        const [historial] = await conRetry(
            () => pool.execute(
                'SELECT fecha, lugar, jugadores, rondas, ganador, cayo_ronda, modo FROM historial WHERE username = ? ORDER BY fecha DESC, id DESC LIMIT 10',
                [username]),
            { op: 'mi-historial', username });
        res.json({ ...u, winrate, catalogoLogros: logros.CATALOGO, logros: ganados, historial });
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
// Otorga un logro una sola vez (PRIMARY KEY username+logro) y avisa al
// jugador en la sala si es nuevo. Nunca a bots.
async function otorgarLogro(sala, nombre, idLogro) {
    const jugador = sala.jugadores.find(j => j.nombre === nombre);
    if (!jugador || jugador.esBot || !logros.POR_ID[idLogro]) return;
    try {
        const [r] = await conRetry(
            () => pool.execute('INSERT IGNORE INTO logros (username, logro) VALUES (?, ?)', [nombre, idLogro]),
            { op: 'otorgar_logro', nombre, idLogro }
        );
        if (r.affectedRows === 1) {
            io.to(jugador.id).emit('logroDesbloqueado', logros.POR_ID[idLogro]);
            log.info('Logro desbloqueado', { nombre, logro: idLogro });
        }
    } catch (err) {
        log.error('Fallo otorgar logro', { error: err.message, nombre, idLogro });
    }
}

async function registrarFinPartida(sala, ganador) {
    if (sala.config.practica) return; // la práctica no cuenta en las estadísticas
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

    // Ganador humano: victoria + racha. (Si gana un bot o nadie, solo se
    // reinicia la racha de los humanos, abajo.)
    // Quiénes ganan: el humano ganador o, en parejas, los humanos del equipo.
    const ganadoresNombres = ganador.esEquipo
        ? humanos.filter(j => j.equipo === ganador.equipo).map(j => j.nombre)
        : (!!ganador.id && !ganador.esBot ? [ganador.nombre] : []);
    for (const nombreGanador of ganadoresNombres) await conRetry(
        () => pool.execute(
            `UPDATE usuarios SET victorias = victorias + 1,
             racha_actual = racha_actual + 1,
             racha_maxima = GREATEST(racha_maxima, racha_actual + 1)
             WHERE username = ?`,
            [nombreGanador]
        ),
        { op: 'update_victoria', ganador: nombreGanador }
    ).catch(err => log.error('Fallo update victoria', { error: err.message, codigo: err.code, ganador: nombreGanador }));

    // Perdedores humanos: resetear racha
    const perdedores = humanos.filter(j => !ganadoresNombres.includes(j.nombre)).map(j => j.nombre);
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

    await registrarHistorialYLogros(sala, ganador, humanos);
}

// Una fila de historial por humano y los logros de fin de partida.
async function registrarHistorialYLogros(sala, ganador, humanos) {
    const hayGanador = !!ganador.id;
    const lugarDe = ganador.esEquipo
        ? (n => ganador.integrantes.includes(n) ? 1 : 2) // parejas: 1.º el equipo ganador, 2.º el otro
        : logros.lugaresFinales(hayGanador ? ganador.nombre : null, sala.caidas || [], sala.jugadores.length);
    const modo = sala.config.rapida ? 'RAPIDA' : sala.config.equipos ? 'PAREJAS' : sala.config.modoJuego;
    for (const j of humanos) {
        const caida = (sala.caidas || []).find(c => c.nombre === j.nombre);
        await conRetry(
            () => pool.execute(
                `INSERT INTO historial (username, partida, lugar, jugadores, rondas, ganador, cayo_ronda, modo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [j.nombre, sala.idPartida || null, lugarDe(j.nombre), sala.jugadores.length, sala.rondaActual,
                 hayGanador ? ganador.nombre : null, caida ? caida.ronda : null, modo]
            ),
            { op: 'insert_historial', nombre: j.nombre }
        ).catch(err => log.error('Fallo insert historial', { error: err.message, nombre: j.nombre }));
    }
    try {
        const nombres = humanos.map(j => j.nombre);
        const [stats] = await pool.query(
            'SELECT username, victorias, partidas_jugadas, racha_actual FROM usuarios WHERE username IN (?)', [nombres]);
        for (const j of humanos) {
            const ids = logros.logrosDeFinDePartida({
                gano: ganador.esEquipo ? ganador.integrantes.includes(j.nombre) : (hayGanador && ganador.nombre === j.nombre),
                vidasFinales: j.vidas,
                vidasPerdidas: (sala.vidasPerdidas || {})[j.nombre] || 0,
                stats: stats.find(s => s.username === j.nombre),
            });
            for (const id of ids) await otorgarLogro(sala, j.nombre, id);
        }
    } catch (err) {
        log.error('Fallo logros de fin de partida', { error: err.message });
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

    const { valorCritico, perdedores, culpables, castigados, campanaInfo, mensajes } = resolverCartas(sala);
    // Amnistía: quien tenía la carta mortal pierde su turno en la ronda siguiente.
    sala.castigadosSiguiente = sala.jugadores.filter(j => castigados.includes(j.id)).map(j => j.nombre);
    mensajes.forEach(m => io.to(sala.idSala).emit('mensajeGlobal', m));

    // Historial y logros: quién perdió vidas y quién quedó fuera en esta ronda.
    sala.caidas ||= []; sala.vidasPerdidas ||= {};
    sala.jugadores.filter(j => perdedores.includes(j.id)).forEach(j => {
        sala.vidasPerdidas[j.nombre] = (sala.vidasPerdidas[j.nombre] || 0) + (sala.evento === 'DOBLE_CASTIGO' ? 2 : 1);
        if (j.vidas <= 0 && !sala.caidas.some(c => c.nombre === j.nombre)) {
            sala.caidas.push({ nombre: j.nombre, ronda: sala.rondaActual });
        }
    });
    if (sala.config.poderes && !sala.config.practica) { // en la práctica los poderes los da el guion
        sala.jugadores.filter(j => perdedores.includes(j.id) && j.vidas > 0).forEach(j => {
            const id = poderes.darPoder(j);
            if (!id) return;
            if (!j.esBot) io.to(j.id).emit('poderGanado', { poder: poderes.CATALOGO[id], poderes: j.poderes });
            io.to(sala.idSala).emit('accionMesa', { tipo: 'PODER', icono: '✨', jugador: j.nombre, texto: `${j.nombre} ganó un poder` });
        });
    }
    if (campanaInfo && campanaInfo.acertada && !sala.config.practica) {
        const ringer = sala.jugadores.find(j => j.id === campanaInfo.tocadorId);
        if (ringer) otorgarLogro(sala, ringer.nombre, 'oido_fino');
    }

    let sobrevivientes = sala.jugadores.filter(j => j.vidas > 0);
    const humanosVivos = sobrevivientes.filter(j => !j.esBot);
    const equiposVivos = new Set(sobrevivientes.map(j => j.equipo));
    let juegoTerminado = sala.config.equipos
        ? equiposVivos.size <= 1 || humanosVivos.length === 0
        : sobrevivientes.length <= 1 || humanosVivos.length === 0;

    if (juegoTerminado) sala.estadoActual = "FINALIZADO";

    // Enviar cartas reveladas al descarte (persistente entre rondas)
    vivos.forEach(j => { if (j.cartaActual !== undefined && j.cartaActual !== null) sala.descarte.push(j.cartaActual); });

    // Pausas tras revelar: el cliente voltea las cartas una por una (~180 ms
    // por jugador) y después muestra el resumen, así que hay que dejarle ver.
    // La revelación dura ~0.45 s por jugador (más suspenso); el resumen sale al
    // terminar y hay que dejar verlo.
    const MS_PAUSA_BOT = 11000;      // dealer bot: pasa a la siguiente ronda (tiempo para ver quién tenía qué)
    const MS_PAUSA_VICTORIA = 6500;  // fin de partida: muestra la victoria
    // Con dealer humano, la ronda sigue sola a los 15 s por si no presiona
    // "siguiente ronda" (antes la sala quedaba atorada en REVELACION).
    const SEG_AUTO_SIGUIENTE_RONDA = 15;
    // La práctica termina al revelar la última ronda del guion: el cliente
    // muestra el cierre y el jugador sale de la sala.
    const finDePractica = sala.config.practica && sala.rondaActual >= practica.ULTIMA_RONDA;
    if (finDePractica) sala.jugadores.filter(j => !j.esBot).forEach(j => otorgarLogro(sala, j.nombre, 'aprendiz'));
    const dealerEsBot = sala.jugadores[sala.dealerIndex].esBot;
    // En la práctica hay que dar tiempo a leer las explicaciones.
    const pausaBot = sala.config.practica ? 12000 : MS_PAUSA_BOT;
    const pausaHumano = sala.config.practica ? 60 : SEG_AUTO_SIGUIENTE_RONDA;
    // Milisegundos hasta que la siguiente ronda empiece sola (null: no hay).
    // Se manda al cliente para que muestre la cuenta regresiva en el resumen.
    // En el duelo final el choque de cartas dura más: se le da tiempo.
    const extraDuelo = sala.enDuelo ? 2000 : 0;
    const msAutoSiguiente = (juegoTerminado || finDePractica) ? null
        : (dealerEsBot ? pausaBot : pausaHumano * 1000) + extraDuelo;

    io.to(sala.idSala).emit('rondaTerminada', {
        jugadores: jugadoresPublicos(sala),
        perdedores: perdedores,
        cartaMortal: valorCritico,
        dealerId: sala.jugadores[sala.dealerIndex].id,
        juegoTerminado: juegoTerminado,
        campana: campanaInfo,
        autoSiguienteMs: msAutoSiguiente,
        // Parejas: quién tenía la carta mortal (el equipo entero pierde la vida).
        culpables: sala.jugadores.filter(j => culpables.includes(j.id)).map(j => j.nombre),
    });

    io.to(sala.idSala).emit('accionMesa', {
        tipo: 'FIN_RONDA',
        icono: '💀',
        texto: `Fin de ronda — Carta mortal: ${valorCritico}`
    });

    // Avance automático. Si el dealer avanza antes, el estado ya no es
    // REVELACION y este timer no hace nada.
    if (msAutoSiguiente !== null) {
        const rondaResuelta = sala.rondaActual;
        setTimeout(() => {
            // rondaResuelta: si el dealer ya avanzó y otra ronda llegó a
            // REVELACION antes de tiempo, este timer viejo no debe saltarla.
            if (!estadoSalas[sala.idSala] || sala.estadoActual !== "REVELACION" || sala.rondaActual !== rondaResuelta) return;
            let vivos = sala.jugadores.filter(j => j.vidas > 0);
            if (vivos.length <= 1) return;
            sala.estadoActual = "PREPARANDO_NUEVA_RONDA";
            if (!dealerEsBot) io.to(sala.idSala).emit('mensajeGlobal', '⏩ La siguiente ronda empezó automáticamente.');
            io.to(sala.idSala).emit('nuevaRondaIniciada', { jugadoresActualizados: jugadoresPublicos(sala) });
            iniciarRonda(sala, io);
        }, msAutoSiguiente);
    }

    if (juegoTerminado) {
        let ganador = sobrevivientes[0] || { nombre: "Nadie (Empate total)", vidas: 0 };
        if (sala.config.equipos && sobrevivientes.length) {
            // Gana el equipo: la victoria es de todos sus integrantes.
            const e = sobrevivientes[0].equipo;
            ganador = { esEquipo: true, equipo: e, nombre: `Equipo ${NOMBRE_EQUIPO[e]}`, vidas: sobrevivientes[0].vidas,
                        id: `equipo-${e}`, integrantes: sala.jugadores.filter(j => j.equipo === e).map(j => j.nombre) };
        }
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
        }, MS_PAUSA_VICTORIA + extraDuelo);
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

    // Quien tiene al Rey siempre se queda con él. En DECLARADO todos lo saben,
    // así que su turno se salta a la vista; en SORPRESA su turno debe verse
    // como cualquier otro (pausa y "decidió mantener") para no delatarlo.
    const protege = reyProtegido(sala);
    const reyOculto = protege && jugadorActual.cartaActual === 9 && sala.config.modoRey !== "DECLARADO";
    if ((sala.castigados || []).includes(jugadorActual.nombre)) {
        debeSaltar = true;
        razon = `⛓️ ${jugadorActual.nombre} pierde su turno por la Amnistía.`;
    } else if (protege && jugadorActual.cartaActual === 9 && !reyOculto) {
        debeSaltar = true;
        razon = `👑 ${jugadorActual.nombre} tiene al Rey. Turno auto-completado.`;
    } else if (protege && sala.evento !== 'MERCADO' && sala.config.modoRey === "DECLARADO" && jugadorDerecha.cartaActual === 9 && indiceActual !== sala.dealerIndex) {
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
        const tiempoSala = sala.config.tiempoTurno || TIEMPO_TURNO;
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

        if (reyOculto) {
            // Mantiene tras una pausa como la de cualquier jugador que piensa.
            setTimeout(() => {
                const salaActual = estadoSalas[sala.idSala];
                if (!salaActual || salaActual.estadoActual !== "TURNOS_INTERCAMBIO") return;
                if (salaActual.jugadores[salaActual.turnoActualIndex]?.id !== jugadorActual.id) return;
                ejecutarAccion(sala.idSala, 'MANTENER', io, jugadorActual.id);
            }, bots.retrasoBot());
            return;
        }

        if (jugadorActual.esBot || jugadorActual.automatico) {
            const esDealer = indiceActual === sala.dealerIndex;
            const decidir = () => jugadorActual.automatico ? decisionPorAusente(sala, jugadorActual)
                : sala.config.practica
                ? practica.decisionBot(sala, indiceActual)
                : bots.decidirBot(sala, jugadorActual, {
                esDealer,
                derecha: jugadorDerecha,
                derechaEsRinger: esCampana && sala.campanaTocada && jugadorDerecha.id === sala.campanaTocadorId,
            });
            const sigueSuTurno = () => {
                const salaActual = estadoSalas[sala.idSala];
                return salaActual && salaActual.estadoActual === "TURNOS_INTERCAMBIO"
                    && salaActual.jugadores[salaActual.turnoActualIndex]?.id === jugadorActual.id && jugadorActual.vidas > 0;
            };
            setTimeout(() => {
                if (!sigueSuTurno()) return;
                // Modo con poderes: el bot puede usar uno antes de jugar.
                const pierdeLaMasAlta = esCampana || sala.evento === 'MUNDO_AL_REVES';
                const poder = sala.config.poderes && !sala.config.practica ? poderes.poderParaBot(jugadorActual, {
                    esDealer, pierdeLaMasAlta, mercado: sala.evento === 'MERCADO', niebla: sala.evento === 'NIEBLA',
                    puedeSaltar: !esDealer && sala.evento !== 'MERCADO' && sala.jugadores.filter(j => j.vidas > 0).length >= 3,
                }) : null;
                const r = poder ? usarPoder(sala, indiceActual, poder) : { error: true };
                if (poder === 'SALTO' && !r.error) return; // el salto ya fue su jugada
                // Tras espiar u oráculo decide con lo que vio; si no, como siempre.
                const decision = (!r.error && r.carta !== undefined)
                    ? (poderes.mejorQue(r.carta, jugadorActual.cartaActual, pierdeLaMasAlta) ? 'CAMBIAR' : 'MANTENER')
                    : decidir();
                setTimeout(() => { if (sigueSuTurno()) ejecutarAccion(sala.idSala, decision, io, jugadorActual.id); }, poder && !r.error ? 900 : 0);
            }, bots.retrasoBot());
            return;
        }

        iniciarReloj(sala.idSala, io, tiempoReloj);
    }
}

// ==========================================
// INACTIVIDAD (AFK)
// ==========================================
// Si se te acaba el tiempo, el juego decide por ti con el cálculo de un bot.
// TURNOS_PARA_AUTOMATICO turnos seguidos sin jugar (o no volver tras
// desconectarte) te dejan en modo automático: un bot juega por ti hasta que
// vuelves (botón "Volver a jugar", cualquier jugada o reconectarte).
const TURNOS_PARA_AUTOMATICO = 2;

function activarAutomatico(sala, j) {
    if (!j || j.esBot || j.automatico || j.vidas <= 0) return;
    j.automatico = true;
    io.to(sala.idSala).emit('mensajeGlobal', `🤖 ${j.nombre} está ausente: un bot jugará por él.`);
    io.to(sala.idSala).emit('accionMesa', { tipo: 'AUTOMATICO', icono: '🤖', jugador: j.nombre, texto: `${j.nombre} pasó a modo automático` });
    io.to(j.id).emit('modoAutomatico', { activo: true });
}

function desactivarAutomatico(sala, j, avisar = true) {
    if (!j) return;
    j.turnosSinJugar = 0;
    if (!j.automatico) return;
    j.automatico = false;
    if (avisar) io.to(sala.idSala).emit('mensajeGlobal', `👋 ${j.nombre} volvió a jugar.`);
    io.to(j.id).emit('modoAutomatico', { activo: false });
}

// Lo que haría un bot en el lugar de `j` (para jugar por quien no alcanzó).
function decisionPorAusente(sala, j) {
    const idx = sala.jugadores.indexOf(j);
    const derecha = sala.jugadores[siguienteVivo(sala.jugadores, idx)];
    const esCampana = sala.config.modoJuego === 'CAMPANA';
    const decision = bots.decidirBot({ ...sala, config: { ...sala.config, dificultadBots: 'NORMAL' } }, j, {
        esDealer: idx === sala.dealerIndex, derecha,
        derechaEsRinger: esCampana && sala.campanaTocada && derecha.id === sala.campanaTocadorId,
    });
    return decision === 'CAMPANA' && (!esCampana || sala.campanaTocada) ? 'MANTENER' : decision;
}

function iniciarReloj(idSala, io, tiempoSegundos) {
    if (temporizadores[idSala]) clearTimeout(temporizadores[idSala]);
    temporizadores[idSala] = setTimeout(() => {
        const sala = estadoSalas[idSala];
        if (!sala || sala.estadoActual !== "TURNOS_INTERCAMBIO") return;
        const jugadorActual = sala.jugadores[sala.turnoActualIndex];
        // Se acabó su tiempo: se juega por él y se cuenta la inactividad.
        const decision = sala.config.practica ? 'MANTENER' : decisionPorAusente(sala, jugadorActual);
        jugadorActual.turnosSinJugar = (jugadorActual.turnosSinJugar || 0) + 1;
        io.to(idSala).emit('mensajeGlobal', jugadorActual.online
            ? `⏰ Se acabó el tiempo de ${jugadorActual.nombre}: el juego jugó por él.`
            : `📵 ${jugadorActual.nombre} está desconectado: el juego jugó por él.`);
        io.to(idSala).emit('accionMesa', {
            tipo: 'TIMEOUT', icono: '⏰', jugador: jugadorActual.nombre,
            texto: `Tiempo agotado: se jugó por ${jugadorActual.nombre}`
        });
        if (jugadorActual.turnosSinJugar >= TURNOS_PARA_AUTOMATICO && !sala.config.practica) activarAutomatico(sala, jugadorActual);
        ejecutarAccion(idSala, decision, io, jugadorActual.id, true);
    }, (tiempoSegundos || 10) * 1000);
}

function iniciarRonda(sala, io) {
    // Guardia: se llama desde varios setTimeout (revancha, fin de turno)
    if (!estadoSalas[sala.idSala]) return;
    sala.rondaActual += 1;
    // Contadores de la partida para historial y logros (se reinician en la
    // ronda 1: partida nueva o revancha).
    // Lo de la ronda anterior deja de valer: evento y castigos de la Amnistía.
    sala.evento = null;
    sala.escudos = [];
    sala.castigados = sala.castigadosSiguiente || [];
    sala.castigadosSiguiente = [];
    if (sala.rondaActual === 1) {
        prepararEquipos(sala);
        sala.caidas = []; sala.vidasPerdidas = {};
        sala.dueloAnunciado = false; sala.rondasSinEvento = 0; sala.ultimoEvento = null; sala.castigados = [];
        sala.idPartida = `${sala.idSala}-${Date.now().toString(36)}`; // agrupa el historial por partida
    }
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
    sala.jugadores.forEach(j => { j.reyDescubierto = false; });
    bots.olvidarRonda(sala.jugadores);
    // En la práctica las cartas vienen del guion (y no se reparte el Rey al azar).
    const conGuion = sala.config.practica && practica.repartirGuion(sala);

    let jugadoresConNueve = conGuion ? [] : vivos.filter(j => j.cartaActual === 9);
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

    // Duelo final: quedan 2 en una partida que empezó con más. Se presenta una
    // vez con su pantalla de "versus"; los eventos no aplican en el duelo.
    sala.enDuelo = vivos.length === 2 && sala.jugadores.length > 2 && !sala.config.equipos;
    const anunciarDuelo = sala.enDuelo && !sala.dueloAnunciado;
    if (anunciarDuelo) sala.dueloAnunciado = true;
    // En la práctica el evento lo pone el guion; si no, se sortea.
    sala.evento = sala.config.practica ? practica.eventoDeRonda(sala) : eventos.elegirEvento(sala, vivos.length);
    // Poderes que el guion de práctica regala al empezar la ronda.
    if (sala.config.practica) {
        practica.poderesDeRonda(sala).forEach(({ indice, poder }) => {
            const j = sala.jugadores[indice];
            if (!j || j.vidas <= 0) return;
            (j.poderes ||= []).push(poder);
            if (!j.esBot) io.to(j.id).emit('poderGanado', { poder: poderes.CATALOGO[poder], poderes: j.poderes });
        });
    }
    // Presentaciones antes de jugar (el cliente las muestra con estos tiempos).
    // El evento se muestra MS_CARTA_EVENTO en el cliente (4 s para leerlo con calma) + 400 ms de salida.
    const MS_INTRO_DUELO = 2800, MS_INTRO_EVENTO = 4400;
    const introMs = (anunciarDuelo ? MS_INTRO_DUELO : 0) + (sala.evento ? MS_INTRO_EVENTO : 0);
    if (sala.evento) {
        const ev = eventos.CATALOGO[sala.evento];
        io.to(sala.idSala).emit('accionMesa', { tipo: 'EVENTO', icono: '✨', texto: `Evento: ${ev.titulo}` });
    }

    io.to(sala.idSala).emit('datosMesa', {
        evento: sala.evento ? eventos.CATALOGO[sala.evento] : null,
        duelo: sala.enDuelo,
        anunciarDuelo,
        duelistas: sala.enDuelo ? vivos.map(j => j.nombre) : null,
        introMs,
        ronda: sala.rondaActual,
        dealer: sala.jugadores[sala.dealerIndex].nombre,
        modoRey: sala.config.modoRey,
        modoJuego: sala.config.modoJuego || 'CLASICO',
        cartasRestantes: sala.mazo.length,
        jugadores: jugadoresPublicos(sala)
    });

    sala.jugadores.forEach(j => {
        if (j.vidas > 0 && j.online) enviarCarta(sala, j);
    });

    // DECLARADO: el Rey se reparte boca abajo y se revela a MS_REVELAR_REY
    // (el cliente espera lo mismo para voltearlo); el primer turno arranca
    // después, para que nadie juegue antes de saber dónde está.
    const MS_REVELAR_REY = 2000;
    const hayReyDeclarado = sala.config.modoRey === "DECLARADO" && sala.config.modoJuego !== 'CAMPANA' && sala.evento !== 'NIEBLA'
        && sala.jugadores.some(j => j.vidas > 0 && j.cartaActual === 9);
    if (hayReyDeclarado) {
        const ronda = sala.rondaActual;
        setTimeout(() => {
            if (!estadoSalas[sala.idSala] || sala.rondaActual !== ronda) return;
            if (sala.evento === 'NIEBLA') return; // en la niebla no se anuncia nada
            const reyes = sala.jugadores.filter(j => j.vidas > 0 && j.cartaActual === 9).map(j => j.nombre);
            if (reyes.length === 1) io.to(sala.idSala).emit('mensajeGlobal', `👑 El Rey está en manos de ${reyes[0]}.`);
            else if (reyes.length > 1) io.to(sala.idSala).emit('mensajeGlobal', `👑 Hay ${reyes.length} Reyes: los tienen ${reyes.slice(0, -1).join(', ')} y ${reyes[reyes.length - 1]}.`);
        }, introMs + MS_REVELAR_REY);
    }

    const esperaGuion = sala.config.practica ? practica.esperaInicio(sala) : 0; // tiempo para leer en la práctica
    // Con Rey declarado, el cliente hace la gran revelación (~2.6 s) antes del primer turno.
    const MS_GRAN_REY = 2800;
    setTimeout(() => { gestionarTurnos(sala, io, true); }, introMs + esperaGuion + (hayReyDeclarado ? MS_REVELAR_REY + MS_GRAN_REY : 500));
}

// Arranca la partida de una sala en LOBBY (la llaman "Empezar juego" y el
// arranque automático de la partida rápida).
function empezarPartida(sala) {
    if (!estadoSalas[sala.idSala] || sala.estadoActual !== "LOBBY") return;
    sala.rondaActual = 0;
    sala.dealerIndex = sala.config.practica ? practica.DEALER_INICIAL : 0;
    sala.mazo = crearMazo(sala.config);
    sala.descarte = [];
    iniciarRonda(sala, io);
    log.info('Partida iniciada', { idSala: sala.idSala, jugadores: sala.jugadores.length, rapida: !!sala.config.rapida });
}

// ==========================================
// PARTIDA RÁPIDA
// ==========================================
// Mesa pública de 4: el jugador entra a la primera sala rápida con lugar o se
// crea una. Empieza sola a los RAPIDA_ESPERA_MS o en cuanto se llena, y los
// lugares vacíos se completan con bots.
const RAPIDA_ESPERA_MS = 20000;
const temporizadoresRapida = {}; // idSala → timeout de arranque

function configRapida() {
    return { vidas: 3, maxJugadores: 4, numBots: 0, modoJuego: 'CLASICO', modoRey: 'SORPRESA',
             frecuenciaReyes: 'NORMAL', dificultadBots: 'NORMAL', tiempoTurno: TIEMPO_TURNO, eventos: true, rapida: true };
}

function nuevoIdSala() {
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id;
    do {
        id = '';
        for (let i = 0; i < 5; i++) id += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    } while (estadoSalas[id]);
    return id;
}

function arrancarRapida(idSala) {
    clearTimeout(temporizadoresRapida[idSala]);
    delete temporizadoresRapida[idSala];
    const sala = estadoSalas[idSala];
    if (!sala || sala.estadoActual !== "LOBBY") return;
    // Solo juegan los humanos conectados; si no queda ninguno, la sala sobra.
    sala.jugadores = sala.jugadores.filter(j => j.esBot || j.online);
    if (!sala.jugadores.some(j => !j.esBot)) return limpiarSala(idSala);
    const usados = sala.jugadores.map(j => j.nombre);
    for (let i = 1; sala.jugadores.length < sala.config.maxJugadores; i++) {
        const nombre = nombreBotAleatorio(usados);
        usados.push(nombre);
        sala.jugadores.push({ id: 'bot_' + i, nombre, vidas: sala.config.vidas, yaJugo: false, online: true, esBot: true });
    }
    emitirLobby(idSala);
    empezarPartida(sala);
}

// Aplica un poder de `sala.jugadores[idx]`. Devuelve { error } o
// { carta } (lo que vio con Espiar u Oráculo). El Salto ejecuta la jugada.
function usarPoder(sala, idx, poder) {
    const j = sala.jugadores[idx];
    const def = poderes.CATALOGO[poder];
    if (!def || !sala.config.poderes) return { error: 'Esta mesa no tiene poderes.' };
    if (!j || j.vidas <= 0 || !(j.poderes || []).includes(poder)) return { error: 'No tienes ese poder.' };
    if (sala.estadoActual !== "TURNOS_INTERCAMBIO") return { error: 'Los poderes se usan durante la ronda.' };
    const esSuTurno = sala.turnoActualIndex === idx;
    if (def.enTuTurno && !esSuTurno) return { error: `${def.titulo} solo se usa en tu turno.` };
    const aviso = (texto) => io.to(sala.idSala).emit('mensajeGlobal', texto);
    const privado = (datos) => { if (!j.esBot) io.to(j.id).emit('resultadoPoder', datos); };
    let resultado = {};

    if (poder === 'ESPIAR') {
        const objetivo = sala.jugadores[siguienteVivo(sala.jugadores, idx)];
        if (!objetivo || objetivo === j) return { error: 'No hay a quién espiar.' };
        poderes.quitarPoder(j, poder);
        resultado.carta = objetivo.cartaActual;
        if (j.esBot) (j.memoria ||= {})[objetivo.id] = objetivo.cartaActual;
        privado({ poder: def, objetivo: objetivo.nombre, objetivoId: objetivo.id, carta: objetivo.cartaActual });
        aviso(`👁️ ${j.nombre} espió la carta de ${objetivo.nombre}.`);
        io.to(sala.idSala).emit('accionMesa', { tipo: 'ESPIAR', icono: '👁️', jugador: j.nombre, objetivo: objetivo.nombre, texto: `${j.nombre} espió a ${objetivo.nombre}` });
    } else if (poder === 'ORACULO') {
        if (sala.mazo.length === 0 && sala.descarte.length > 0) { sala.mazo = barajar([...sala.descarte]); sala.descarte = []; }
        if (sala.mazo.length === 0) return { error: 'El mazo está vacío.' };
        poderes.quitarPoder(j, poder);
        resultado.carta = sala.mazo[sala.mazo.length - 1];
        privado({ poder: def, carta: resultado.carta });
        aviso(`🔮 ${j.nombre} consultó al Oráculo.`);
        io.to(sala.idSala).emit('accionMesa', { tipo: 'ORACULO', icono: '🔮', jugador: j.nombre, texto: `${j.nombre} consultó al Oráculo` });
    } else if (poder === 'ESCUDO') {
        if ((sala.escudos || []).includes(j.nombre)) return { error: 'Ya tienes el escudo arriba.' };
        poderes.quitarPoder(j, poder);
        (sala.escudos ||= []).push(j.nombre);
        aviso(`🛡️ ${j.nombre} levantó un escudo: nadie puede cambiar con él esta ronda.`);
        io.to(sala.idSala).emit('accionMesa', { tipo: 'ESCUDO', icono: '🛡️', jugador: j.nombre, jugadorId: j.id, texto: `${j.nombre} levantó un escudo` });
    } else if (poder === 'SALTO') {
        if (idx === sala.dealerIndex) return { error: 'El dealer no puede saltar: si cambia, roba del mazo.' };
        if (sala.evento === 'MERCADO') return { error: 'En el Mercado no hay cambios entre jugadores.' };
        const uno = siguienteVivo(sala.jugadores, idx), dos = siguienteVivo(sala.jugadores, uno);
        if (dos === idx || dos === uno) return { error: 'No hay nadie dos lugares a tu derecha.' };
        poderes.quitarPoder(j, poder);
        if (!j.esBot) io.to(j.id).emit('misPoderes', j.poderes);
        ejecutarAccion(sala.idSala, 'CAMBIAR', io, j.id, false, { objetivoIndex: dos });
        return resultado;
    }
    if (!j.esBot) io.to(j.id).emit('misPoderes', j.poderes);
    return resultado;
}

// ==========================================
// PAREJAS (config.equipos)
// ==========================================
// Equipos Oro (0) y Plata (1) sentados alternados: el asiento par es Oro y el
// impar Plata, así tu vecino de la derecha siempre es rival. Las vidas son del
// equipo (resolverCartas las descuenta a todos sus integrantes) y cada quien
// ve la carta de sus compañeros (enviarCarta → 'cartaCompanero').
const NOMBRE_EQUIPO = ['Oro', 'Plata'];

// Completa la mesa con bots y asigna equipos (al empezar partida o revancha).
function prepararEquipos(sala) {
    if (!sala.config.equipos) return;
    const usados = sala.jugadores.map(j => j.nombre);
    for (let i = 1; sala.jugadores.length < sala.config.maxJugadores; i++) {
        const nombre = nombreBotAleatorio(usados);
        usados.push(nombre);
        sala.jugadores.push({ id: 'bot_eq_' + i, nombre, vidas: sala.config.vidas, yaJugo: false, online: true, esBot: true });
    }
    sala.jugadores.forEach((j, i) => { j.equipo = i % 2; });
}

function companeros(sala, jugador) {
    return sala.jugadores.filter(t => t !== jugador && t.equipo === jugador.equipo && t.vidas > 0);
}

// ¿El Rey protege esta ronda? No en campana (ahí el 9 es la peor carta) ni
// con el evento "Mundo al revés" (pierde la más alta y el Rey queda expuesto).
function reyProtegido(sala) {
    return sala.config.modoJuego !== 'CAMPANA' && sala.evento !== 'MUNDO_AL_REVES';
}

// Manda a un jugador su carta. Con el evento "Niebla" nadie la ve hasta la
// revelación (rondaTerminada trae todas).
function enviarCarta(sala, jugador) {
    if (sala.evento === 'NIEBLA') return;
    io.to(jugador.id).emit('tuCarta', jugador.cartaActual);
    // Parejas: tus compañeros también la ven (los bots la recuerdan).
    if (sala.config.equipos) companeros(sala, jugador).forEach(t => {
        if (t.esBot) (t.memoria ||= {})[jugador.id] = jugador.cartaActual;
        else io.to(t.id).emit('cartaCompanero', { id: jugador.id, carta: jugador.cartaActual });
    });
}

// 3 minutos para volver (margen para el bloqueo de pantalla del celular); si
// no regresa, un bot juega por él (modo automático). Nota: antes lo eliminaba.
// no regresa, queda eliminado. Se usa al desconectarse y al restaurar salas
// tras un reinicio del servidor.
function programarGraciaDesconexion(idSala, nombre) {
    clearTimeout(temporizadoresDesconexion[nombre]);
    temporizadoresDesconexion[nombre] = setTimeout(() => {
        delete temporizadoresDesconexion[nombre]; // limpiar la propia entry
        const salaActual = estadoSalas[idSala];
        if (!salaActual) return;
        const jPerdido = salaActual.jugadores.find(x => x.nombre === nombre);
        // No regresó: en lugar de eliminarlo, un bot termina la partida por él.
        if (jPerdido && !jPerdido.online && jPerdido.vidas > 0) activarAutomatico(salaActual, jPerdido);
    }, 180000);
}

// `opciones.objetivoIndex` cambia con otro jugador en lugar del vecino (poder Salto).
function ejecutarAccion(idSala, accion, io, socketId, porTimeout = false, opciones = {}) {
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
    // Quien tiene al Rey no puede soltarlo (ni cambiando ni robando del mazo).
    if (accion === 'CAMBIAR' && reyProtegido(sala) && jugadorActual.cartaActual === 9) accion = 'MANTENER';

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
        // Con el evento "Mercado" todos roban del mazo, como el dealer.
        if (indiceActual !== sala.dealerIndex && sala.evento !== 'MERCADO') {
            const esSalto = opciones.objetivoIndex !== undefined;
            let jugadorDerecha = sala.jugadores[esSalto ? opciones.objetivoIndex : siguienteVivo(sala.jugadores, indiceActual)];
            const bloqueEscudo = (sala.escudos || []).includes(jugadorDerecha.nombre);
            const bloqueRey = !bloqueEscudo && reyProtegido(sala) && jugadorDerecha.cartaActual === 9;
            const derechaEsRinger = !esSalto && sala.config.modoJuego === 'CAMPANA' && sala.campanaTocada && jugadorDerecha.id === sala.campanaTocadorId;

            if (bloqueEscudo) {
                io.to(idSala).emit('mensajeGlobal', `🛡️ El escudo de ${jugadorDerecha.nombre} rebotó el cambio de ${jugadorActual.nombre}.`);
                io.to(idSala).emit('accionMesa', {
                    tipo: 'BLOQUEO_ESCUDO', icono: '🛡️', jugador: jugadorActual.nombre, objetivo: jugadorDerecha.nombre,
                    texto: `El escudo de ${jugadorDerecha.nombre} rebotó a ${jugadorActual.nombre}`
                });
            } else if (bloqueRey) {
                jugadorDerecha.reyDescubierto = true; // ya todos lo saben: se ve en la mesa
                if (!sala.config.practica) otorgarLogro(sala, jugadorDerecha.nombre, 'muro_del_rey');
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
                    enviarCarta(sala, jugadorActual);
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
                enviarCarta(sala, jugadorActual);
                enviarCarta(sala, jugadorDerecha);
                io.to(idSala).emit('mensajeGlobal', esSalto
                    ? `🏹 ${jugadorActual.nombre} saltó y cambió con ${jugadorDerecha.nombre}.`
                    : `🔄 ${jugadorActual.nombre} cambió con ${jugadorDerecha.nombre}.`);
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
                enviarCarta(sala, jugadorActual);
                io.to(idSala).emit('mensajeGlobal', indiceActual === sala.dealerIndex
                    ? `🃏 El Dealer (${jugadorActual.nombre}) cambió su carta con el mazo.`
                    : `🃏 ${jugadorActual.nombre} robó del mazo (Mercado).`);
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
        if (idx !== -1 && sala.config.practica) {
            // La práctica es solo tuya: al salir se borra la sala con sus timers.
            socket.leave(idSala);
            limpiarSala(idSala);
            return;
        }
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

    // Mesas públicas esperando jugadores (pestaña Unirse del lobby).
    socket.on('listarSalas', () => {
        if (!permitir(socket.id, 'listarSalas', 1500)) return;
        const ahora = Date.now();
        const salas = Object.values(estadoSalas)
            .filter(s => s.estadoActual === "LOBBY" && !s.password && !s.config.practica
                && s.jugadores.length < s.config.maxJugadores
                && s.jugadores.some(j => !j.esBot && j.online)
                && !s.jugadores.some(j => j.nombre === nombreUsuarioLogueado))
            .slice(0, 20)
            .map(s => ({
                idSala: s.idSala,
                anfitrion: (s.jugadores.find(j => !j.esBot) || {}).nombre || '',
                jugadores: s.jugadores.length,
                max: s.config.maxJugadores,
                modoJuego: s.config.modoJuego,
                modoRey: s.config.modoRey,
                vidas: s.config.vidas,
                rapida: !!s.config.rapida,
                equipos: s.config.equipos || 0,
                faltanMs: s.config.rapida ? Math.max(0, (s.arrancaEn || ahora) - ahora) : null,
            }));
        socket.emit('salasAbiertas', salas);
    });

    socket.on('partidaRapida', () => {
        if (!permitir(socket.id, 'partidaRapida', 2000)) return;
        const username = socket.usuario ? socket.usuario.username : null;
        if (!username) return socket.emit('errorSala', 'Error de sesión. Vuelve a iniciar.');

        let sala = Object.values(estadoSalas).find(s =>
            s.config.rapida && s.estadoActual === "LOBBY" &&
            s.jugadores.length < s.config.maxJugadores &&
            !s.jugadores.some(j => j.nombre === username));
        if (!sala) {
            const idSala = nuevoIdSala();
            sala = estadoSalas[idSala] = {
                idSala, estadoActual: "LOBBY", config: configRapida(), password: null, hostId: null,
                jugadores: [], dealerIndex: 0, turnoActualIndex: 1, mazo: [], descarte: [], rondaActual: 1,
                campanaTocada: false, campanaTocadorId: null, campanaTocadorIndex: -1,
                ultimaActividad: Date.now(), arrancaEn: Date.now() + RAPIDA_ESPERA_MS,
            };
            temporizadoresRapida[idSala] = setTimeout(() => arrancarRapida(idSala), RAPIDA_ESPERA_MS);
            log.info('Sala rápida creada', { idSala, por: username });
        }
        tocarSala(sala);
        sala.jugadores.push({ id: socket.id, nombre: username, vidas: sala.config.vidas, yaJugo: false, online: true });
        socket.join(sala.idSala);
        socket.emit('rapidaUnido', { idSala: sala.idSala, faltanMs: Math.max(0, sala.arrancaEn - Date.now()) });
        emitirLobby(sala.idSala);
        if (sala.jugadores.length >= sala.config.maxJugadores) arrancarRapida(sala.idSala);
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
            // Su socket cambió: lo que apuntaba al id viejo debe seguirlo.
            if (sala.campanaTocadorId === jugadorExistente.id) sala.campanaTocadorId = socket.id;
            if (sala.hostId === jugadorExistente.id) sala.hostId = socket.id;
            jugadorExistente.id = socket.id;
            jugadorExistente.online = true;
            desactivarAutomatico(sala, jugadorExistente); // volvió: recupera el control
            socket.join(sala.idSala);

            if (reemplazandoSesion) {
                socketAnterior.emit('sesionReemplazada', 'Te conectaste desde otra pestaña o dispositivo.');
                // Delay para que el paquete del emit llegue antes de cerrar el socket
                setTimeout(() => socketAnterior.disconnect(true), 150);
            }

            if (sala.estadoActual !== "LOBBY") {
                if (sala.config.poderes) socket.emit('misPoderes', jugadorExistente.poderes || []);
                if (sala.config.equipos && sala.evento !== 'NIEBLA' && sala.estadoActual === "TURNOS_INTERCAMBIO") {
                    companeros(sala, jugadorExistente).forEach(t => socket.emit('cartaCompanero', { id: t.id, carta: t.cartaActual }));
                }
                socket.emit('reconexionExitosa', {
                    idSala: sala.idSala,
                    carta: sala.evento === 'NIEBLA' ? null : jugadorExistente.cartaActual,
                    evento: sala.evento ? eventos.CATALOGO[sala.evento] : null,
                    duelo: !!sala.enDuelo,
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
        if (sala && !sala.config.rapida && sala.jugadores[0].nombre === nombreUsuarioLogueado) {
            empezarPartida(sala);
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

        desactivarAutomatico(sala, jugadorEnTurno); // jugó él: está presente
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

    socket.on('volverAJugar', (idSala) => {
        if (!permitir(socket.id, 'volverAJugar', 800)) return;
        if (!esIdSalaValido(idSala)) return;
        const sala = estadoSalas[idSala];
        const j = sala && sala.jugadores.find(x => x.nombre === nombreUsuarioLogueado);
        if (j) desactivarAutomatico(sala, j);
    });

    socket.on('usarPoder', (payload) => {
        if (!permitir(socket.id, 'usarPoder', 800)) return;
        if (!payload || typeof payload !== 'object') return;
        const { idSala, poder } = payload;
        if (!esIdSalaValido(idSala) || !poderes.IDS.includes(poder)) return;
        const sala = estadoSalas[idSala];
        if (!sala) return;
        const idx = sala.jugadores.findIndex(j => j.nombre === nombreUsuarioLogueado);
        if (idx === -1) return;
        desactivarAutomatico(sala, sala.jugadores[idx]);
        const r = usarPoder(sala, idx, poder);
        if (r.error) socket.emit('errorPoder', r.error);
    });

    socket.on('frase', (payload) => {
        if (!permitir(socket.id, 'frase', 2000)) return;
        if (!payload || typeof payload !== 'object') return;
        const { idSala, frase } = payload;
        if (!esIdSalaValido(idSala)) return;
        if (!Number.isInteger(frase) || frase < 0 || frase >= TOTAL_FRASES) return;
        const sala = estadoSalas[idSala];
        if (!sala) return;
        const jugador = sala.jugadores.find(j => j.id === socket.id);
        if (!jugador) return;
        socket.to(idSala).emit('fraseJugador', { jugadorId: socket.id, frase });
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
                    io.to(id).emit('mensajeGlobal', `⚠️ ${jugador.nombre} perdió la conexión. Si no vuelve en 3 minutos, un bot jugará por él.`);

                    // Si era su turno, cancelar el timer actual y acelerar a 8s para no bloquear el juego
                    if (sala.estadoActual === "TURNOS_INTERCAMBIO" && sala.turnoActualIndex === idx) {
                        if (temporizadores[id]) {
                            clearTimeout(temporizadores[id]);
                            delete temporizadores[id];
                        }
                        io.to(id).emit('mensajeGlobal', `⏳ Era el turno de ${jugador.nombre}. Jugando automáticamente en 8 segundos...`);
                        iniciarReloj(id, io, 8);
                    }

                    programarGraciaDesconexion(id, jugador.nombre);
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
        { nombre: 'codigo_recuperacion', def: 'VARCHAR(255) DEFAULT NULL' }, // hash bcrypt
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

// Tablas de historial y logros (se crean solas si no existen).
async function crearTablasSiNoExisten() {
    await conRetry(() => pool.execute(`CREATE TABLE IF NOT EXISTS historial (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) NOT NULL,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        lugar INT NOT NULL,
        jugadores INT NOT NULL,
        rondas INT NOT NULL,
        ganador VARCHAR(50) NULL,
        cayo_ronda INT NULL,
        modo VARCHAR(20) NOT NULL,
        INDEX idx_historial_usuario (username, fecha)
    )`), { op: 'crear_historial' });
    await conRetry(() => pool.execute(`CREATE TABLE IF NOT EXISTS logros (
        username VARCHAR(50) NOT NULL,
        logro VARCHAR(40) NOT NULL,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (username, logro)
    )`), { op: 'crear_logros' });
    // Columna agregada después de crear la tabla: id de partida para contarlas.
    const [col] = await pool.execute(`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historial' AND COLUMN_NAME = 'partida'`);
    if (col[0].n === 0) {
        await pool.execute('ALTER TABLE historial ADD COLUMN partida VARCHAR(40) NULL AFTER username');
        log.info('Columna partida agregada a historial');
    }
}

// ==========================================
// PERSISTENCIA DE SALAS (sobrevivir a un reinicio)
// ==========================================
// El estado vive en memoria; para que un reinicio (pm2 restart, deploy o una
// caída) no borre las partidas, se guarda en ARCHIVO_SALAS al apagar y cada
// GUARDADO_CADA_MS. Al arrancar se restaura si es reciente: los humanos quedan
// desconectados con la gracia de siempre y la partida sigue a los
// MS_REANUDAR, cuando sus celulares ya se reconectaron solos.
const ARCHIVO_SALAS = path.join(__dirname, '.estado-salas.json');
const GUARDADO_CADA_MS = 10000;
const MAX_ANTIGUEDAD_MS = 10 * 60 * 1000;
const MS_REANUDAR = 6000;
const ESTADOS_GUARDABLES = new Set(["LOBBY", "TURNOS_INTERCAMBIO", "REVELACION", "PREPARANDO_NUEVA_RONDA"]);

function guardarSalas() {
    const salas = Object.values(estadoSalas)
        .filter(s => ESTADOS_GUARDABLES.has(s.estadoActual) && s.jugadores.some(j => !j.esBot))
        .map(({ votosRevancha, ...s }) => s); // el Set no se serializa y solo sirve al final
    const tmp = ARCHIVO_SALAS + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ guardado: Date.now(), salas }));
    fs.renameSync(tmp, ARCHIVO_SALAS); // nunca queda un archivo a medias
    return salas.length;
}

function restaurarSalas() {
    let datos;
    try {
        if (!fs.existsSync(ARCHIVO_SALAS)) return;
        datos = JSON.parse(fs.readFileSync(ARCHIVO_SALAS, 'utf8'));
    } catch (err) {
        return log.error('No se pudo leer el estado guardado de las salas', { error: err.message });
    }
    if (!datos || !Array.isArray(datos.salas) || Date.now() - datos.guardado > MAX_ANTIGUEDAD_MS) return;

    let restauradas = 0;
    for (const sala of datos.salas) {
        if (!sala || !esIdSalaValido(sala.idSala) || estadoSalas[sala.idSala]) continue;
        sala.ultimaActividad = Date.now();
        sala.jugadores.forEach(j => { if (!j.esBot) j.online = false; });
        estadoSalas[sala.idSala] = sala;
        restauradas++;

        if (sala.estadoActual === "LOBBY") {
            // Sala rápida: su arranque se reprograma con margen para reconectar.
            if (sala.config.rapida) {
                sala.arrancaEn = Date.now() + Math.max(15000, (sala.arrancaEn || 0) - datos.guardado);
                temporizadoresRapida[sala.idSala] = setTimeout(() => arrancarRapida(sala.idSala), sala.arrancaEn - Date.now());
            }
            continue;
        }
        sala.jugadores.filter(j => !j.esBot && j.vidas > 0).forEach(j => programarGraciaDesconexion(sala.idSala, j.nombre));
        setTimeout(() => {
            if (!estadoSalas[sala.idSala]) return;
            if (sala.estadoActual === "TURNOS_INTERCAMBIO") {
                // Reanudar el turno pendiente (si el jugador sigue fuera, tiene 30 s).
                gestionarTurnos(sala, io, false);
            } else if (sala.estadoActual === "REVELACION" || sala.estadoActual === "PREPARANDO_NUEVA_RONDA") {
                if (sala.jugadores.filter(j => j.vidas > 0).length <= 1) return;
                sala.estadoActual = "PREPARANDO_NUEVA_RONDA";
                io.to(sala.idSala).emit('nuevaRondaIniciada', { jugadoresActualizados: jugadoresPublicos(sala) });
                iniciarRonda(sala, io);
            }
        }, MS_REANUDAR);
    }
    if (restauradas) log.info('Salas restauradas tras el reinicio', { salas: restauradas });
}

const guardadoInterval = setInterval(() => {
    try { guardarSalas(); } catch (err) { log.error('Fallo guardado periódico de salas', { error: err.message }); }
}, GUARDADO_CADA_MS);

restaurarSalas();

const PUERTO = process.env.PORT || 4000;
server.listen(PUERTO, async () => {
    log.info('Servidor iniciado', { puerto: PUERTO });
    try {
        await agregarColumnasSiNoExisten();
        await crearTablasSiNoExisten();
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

    // Guardar las partidas en curso para restaurarlas al volver a arrancar.
    clearInterval(guardadoInterval);
    try {
        const n = guardarSalas();
        log.info('Salas guardadas para el reinicio', { salas: n });
    } catch (err) {
        log.error('No se pudieron guardar las salas', { error: err.message });
    }

    // Cancelar TODOS los timers pendientes para no disparar callbacks sobre
    // estado que estamos por destruir.
    clearInterval(sweeperInterval);
    for (const id of Object.keys(temporizadores)) clearTimeout(temporizadores[id]);
    for (const id of Object.keys(temporizadoresRapida)) clearTimeout(temporizadoresRapida[id]);
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