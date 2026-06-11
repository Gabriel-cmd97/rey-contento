require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const limitarAuth = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: 'Demasiados intentos. Espera 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const estadoSalas = {};
const temporizadores = {};
const temporizadoresDesconexion = {};
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_temporal';

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

    let password = null;
    if (typeof raw.password === 'string') {
        const trimmed = raw.password.trim();
        if (trimmed.length > 0 && trimmed.length <= 50) password = trimmed;
        else if (trimmed.length > 50) return null; // rechazar passwords absurdamente largos
    }

    return { vidas, maxJugadores, numBots, modoJuego, modoRey, frecuenciaReyes, password };
}

// Fisher-Yates: distribución uniforme garantizada (a diferencia de sort(() => Math.random()-0.5))
function barajar(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function crearMazo(config) {
    // Base: 4 ceros + 8 de cada número 1-8 = 68 cartas
    const base = [];
    for (let i = 0; i < 4; i++) base.push(0);
    for (let n = 1; n <= 8; n++) {
        for (let i = 0; i < 8; i++) base.push(n);
    }
    barajar(base);

    if (config.frecuenciaReyes === 'NORMAL') {
        // Completamente aleatorio — 9s distribuidos orgánicamente
        return barajar([...base, 9,9,9,9,9,9,9,9]);
    }

    // ALTA / LOCURA: insertar los 8 nines sesgados hacia el tope del array
    // pop() sirve desde el final → tope = primeras rondas
    for (let i = 0; i < 8; i++) {
        const len = base.length; // crece de 68 a 75
        const fraccion = config.frecuenciaReyes === 'LOCURA' ? 0.35 : 0.55;
        const min = Math.floor(len * (1 - fraccion));
        const pos  = min + Math.floor(Math.random() * (len - min + 1));
        base.splice(pos, 0, 9);
    }
    return base; // 76 cartas, 9s concentrados hacia el final (=primeras rondas)
}

// Helper para emitir actualizarLobby siempre con maxJugadores
function emitirLobby(idSala) {
    const sala = estadoSalas[idSala];
    if (!sala) return;
    io.to(idSala).emit('actualizarLobby', {
        jugadores: sala.jugadores,
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
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.execute('INSERT INTO usuarios (username, password_hash) VALUES (?, ?)', [username, hashedPassword]);
        res.status(201).json({ mensaje: '¡Cuenta creada! Ya puedes iniciar sesión.' });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'Ese nombre de usuario ya está ocupado.' });
        } else {
            res.status(500).json({ error: 'Error en la base de datos.' });
        }
    }
});

app.post('/login', limitarAuth, async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM usuarios WHERE username = ?', [username]);
        if (rows.length === 0) return res.status(401).json({ error: 'Usuario no encontrado.' });
        const user = rows[0];
        const passwordValida = await bcrypt.compare(password, user.password_hash);
        if (!passwordValida) return res.status(401).json({ error: 'Contraseña incorrecta.' });
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ mensaje: 'Login exitoso', token, username: user.username });
    } catch (error) {
        res.status(500).json({ error: 'Error en el servidor.' });
    }
});

app.get('/leaderboard', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT username, victorias, partidas_jugadas, racha_actual, racha_maxima FROM usuarios ORDER BY victorias DESC LIMIT 10'
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'No se pudo cargar el Salón de la Fama' });
    }
});

app.get('/mis-stats/:username', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT username, victorias, partidas_jugadas, racha_actual, racha_maxima FROM usuarios WHERE username = ?',
            [req.params.username]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const u = rows[0];
        const winrate = u.partidas_jugadas > 0 ? Math.round((u.victorias / u.partidas_jugadas) * 100) : 0;
        res.json({ ...u, winrate });
    } catch (error) {
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
    await pool.execute(
        `UPDATE usuarios SET partidas_jugadas = partidas_jugadas + 1 WHERE username IN (${placeholders})`,
        usernames
    ).catch(err => console.error(err));

    if (!ganador.id || ganador.esBot) return;

    // Ganador: victoria + racha
    await pool.execute(
        `UPDATE usuarios SET victorias = victorias + 1,
         racha_actual = racha_actual + 1,
         racha_maxima = GREATEST(racha_maxima, racha_actual + 1)
         WHERE username = ?`,
        [ganador.nombre]
    ).catch(err => console.error(err));

    // Perdedores humanos: resetear racha
    const perdedores = humanos.filter(j => j.nombre !== ganador.nombre).map(j => j.nombre);
    if (perdedores.length > 0) {
        const placeholdersPerd = perdedores.map(() => '?').join(',');
        await pool.execute(
            `UPDATE usuarios SET racha_actual = 0 WHERE username IN (${placeholdersPerd})`,
            perdedores
        ).catch(err => console.error(err));
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

    const esModoCampana = sala.config.modoJuego === 'CAMPANA';

    // En campana pierde el que tiene la carta MÁS ALTA; en clásico pierde el MÁS BAJO
    const valorCritico = esModoCampana
        ? Math.max(...vivos.map(j => j.cartaActual))
        : Math.min(...vivos.map(j => j.cartaActual));
    const empateTotal = vivos.every(j => j.cartaActual === valorCritico);
    let perdedores = [];

    // Penalización si nadie tocó la campana (auto-resolve por 2 vueltas)
    if (esModoCampana && !sala.campanaTocada && sala.vueltasCampana >= 2) {
        // El que tiene la carta más alta pierde 1 vida extra (ya la perderá también en resolución normal)
        const maxVal = Math.max(...vivos.map(j => j.cartaActual));
        vivos.filter(j => j.cartaActual === maxVal).forEach(j => {
            j.vidas -= 1;
            if (!perdedores.includes(j.id)) perdedores.push(j.id);
        });
        io.to(sala.idSala).emit('mensajeGlobal', `⏰ Nadie tocó la campana — el cobarde con la carta más alta paga doble.`);
    }

    // Penalización campana: en modo campana, el ringer pierde si tiene la carta MÁS ALTA
    let campanaInfo = null;
    if (sala.campanaTocada && sala.campanaTocadorId) {
        const ringer = sala.jugadores.find(j => j.id === sala.campanaTocadorId);
        if (ringer && ringer.vidas > 0) {
            const ringerPierde = !empateTotal && ringer.cartaActual === valorCritico;
            campanaInfo = { tocadorId: ringer.id, acertada: !ringerPierde };
            if (ringerPierde) {
                ringer.vidas -= 1;
                if (!perdedores.includes(ringer.id)) perdedores.push(ringer.id);
                io.to(sala.idSala).emit('mensajeGlobal', `🔔❌ ${ringer.nombre} tocó la campana pero tenía la carta mortal! -1 vida extra.`);
            } else {
                io.to(sala.idSala).emit('mensajeGlobal', `🔔✅ ¡${ringer.nombre} acertó la campana!`);
            }
        }
    }

    if (!empateTotal) {
        sala.jugadores.forEach(j => {
            if (j.vidas > 0 && j.cartaActual === valorCritico) {
                j.vidas -= 1;
                if (!perdedores.includes(j.id)) perdedores.push(j.id);
            }
        });
    } else {
        io.to(sala.idSala).emit('mensajeGlobal', `🤝 ¡Empate total! Todos tienen ${valorCritico} — nadie pierde vida esta ronda.`);
    }

    let sobrevivientes = sala.jugadores.filter(j => j.vidas > 0);
    const humanosVivos = sobrevivientes.filter(j => !j.esBot);
    let juegoTerminado = sobrevivientes.length <= 1 || humanosVivos.length === 0;

    if (juegoTerminado) sala.estadoActual = "FINALIZADO";

    // Enviar cartas reveladas al descarte (persistente entre rondas)
    vivos.forEach(j => { if (j.cartaActual !== undefined && j.cartaActual !== null) sala.descarte.push(j.cartaActual); });

    io.to(sala.idSala).emit('rondaTerminada', {
        jugadores: sala.jugadores,
        perdedores: perdedores,
        cartaMortal: valorCritico,
        dealerId: sala.jugadores[sala.dealerIndex].id,
        juegoTerminado: juegoTerminado,
        campana: campanaInfo
    });

    if (!juegoTerminado && sala.jugadores[sala.dealerIndex].esBot) {
        setTimeout(() => {
            if (!estadoSalas[sala.idSala] || sala.estadoActual !== "REVELACION") return;
            let vivos = sala.jugadores.filter(j => j.vidas > 0);
            if (vivos.length <= 1) return;
            sala.estadoActual = "PREPARANDO_NUEVA_RONDA";
            io.to(sala.idSala).emit('nuevaRondaIniciada', { jugadoresActualizados: sala.jugadores });
            iniciarRonda(sala, io);
        }, 2500);
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
                if (estadoSalas[sala.idSala] && sala.estadoActual === "FINALIZADO" && sala.votosRevancha.size > 0) {
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
    let indiceDerecha = indiceActual;
    let intentosDerecha = 0;
    do {
        indiceDerecha = (indiceDerecha + 1) % sala.jugadores.length;
        intentosDerecha++;
    } while (sala.jugadores[indiceDerecha].vidas <= 0 && intentosDerecha < sala.jugadores.length);
    let jugadorDerecha = sala.jugadores[indiceDerecha];

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
        jugadorActual.yaJugo = true;
        io.to(sala.idSala).emit('turnoSaltadoVisual', jugadorActual.id);
        io.to(sala.idSala).emit('mensajeGlobal', razon);
        setTimeout(() => {
            if (!estadoSalas[sala.idSala]) return;
            if (indiceActual === sala.dealerIndex) {
                resolverRonda(sala, io);
            } else {
                sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
                gestionarTurnos(sala, io, false);
                iniciarReloj(sala.idSala, io);
            }
        }, 1200);
    } else {
        let idJugadorEnTurno = jugadorActual.id;
        let tiempoTurno = jugadorActual.online ? 10 : 30;

        const payloadTurno = {
            id: idJugadorEnTurno, nombre: jugadorActual.nombre,
            tiempo: tiempoTurno, jugadores: sala.jugadores,
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
            let decision;
            if (sala.config.modoJuego === 'CAMPANA' && !sala.campanaTocada && jugadorActual.cartaActual <= 2) {
                decision = 'CAMPANA'; // carta baja = seguro en campana → tocar
            } else if (sala.config.modoJuego === 'CAMPANA') {
                decision = jugadorActual.cartaActual >= 6 ? 'CAMBIAR' : 'MANTENER';
            } else {
                decision = jugadorActual.cartaActual <= 4 ? 'CAMBIAR' : 'MANTENER';
            }
            setTimeout(() => {
                const salaActual = estadoSalas[sala.idSala];
                if (!salaActual) return;
                const botVivo = salaActual.jugadores.find(j => j.id === jugadorActual.id && j.vidas > 0);
                if (!botVivo) return;
                ejecutarAccion(sala.idSala, decision, io, jugadorActual.id);
            }, 1200);
            return;
        }

        iniciarReloj(sala.idSala, io, tiempoTurno);
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
        ejecutarAccion(idSala, 'MANTENER', io, jugadorActual.id);
    }, (tiempoSegundos || 10) * 1000);
}

function iniciarRonda(sala, io) {
    // Guardia: se llama desde varios setTimeout (revancha, fin de turno)
    if (!estadoSalas[sala.idSala]) return;
    sala.rondaActual += 1;
    sala.estadoActual = "TURNOS_INTERCAMBIO";

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
        jugadores: sala.jugadores
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

function ejecutarAccion(idSala, accion, io, socketId) {
    let sala = estadoSalas[idSala];
    if (!sala) return;

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

        // Avanzar al siguiente jugador vivo
        let intentos = 0;
        do {
            sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
            intentos++;
        } while (intentos < sala.jugadores.length && sala.jugadores[sala.turnoActualIndex] && sala.jugadores[sala.turnoActualIndex].vidas <= 0);

        // Si no hay más jugadores vivos después del ringer → resolver directo
        if (!sala.jugadores[sala.turnoActualIndex] || sala.jugadores[sala.turnoActualIndex].vidas <= 0 || sala.turnoActualIndex === indiceActual) {
            resolverRonda(sala, io);
            return;
        }

        setTimeout(() => {
            if (!estadoSalas[idSala]) return;
            gestionarTurnos(sala, io, false);
            iniciarReloj(idSala, io);
        }, 500);
        return;
    }

    if (accion === 'CAMBIAR') {
        if (indiceActual !== sala.dealerIndex) {
            let indiceDerecha = indiceActual;
            let intentos = 0;
            do {
                indiceDerecha = (indiceDerecha + 1) % sala.jugadores.length;
                intentos++;
            } while (sala.jugadores[indiceDerecha].vidas <= 0 && intentos < sala.jugadores.length);

            let jugadorDerecha = sala.jugadores[indiceDerecha];
            const bloqueRey = sala.config.modoJuego !== 'CAMPANA' && jugadorDerecha.cartaActual === 9;
            const derechaEsRinger = sala.config.modoJuego === 'CAMPANA' && sala.campanaTocada && jugadorDerecha.id === sala.campanaTocadorId;

            if (bloqueRey) {
                const msgBloqueo = sala.config.modoRey === "DECLARADO"
                    ? `🛡️ ${jugadorActual.nombre} no puede cambiar — el Rey ya está a la vista.`
                    : `🛡️ ¡BLOQUEO REAL! ${jugadorActual.nombre} chocó con el Rey.`;
                io.to(idSala).emit('mensajeGlobal', msgBloqueo);
            } else if (derechaEsRinger) {
                // Jugador adyacente al que tocó campana → roba del mazo en vez de intercambiar
                if (sala.mazo.length === 0 && sala.descarte.length > 0) {
                    sala.mazo = sala.descarte.sort(() => Math.random() - 0.5);
                    sala.descarte = [];
                    io.to(sala.idSala).emit('mensajeGlobal', '🔀 ¡La baraja se agotó y fue mezclada de nuevo!');
                }
                if (sala.mazo.length > 0) {
                    const cartaVieja = jugadorActual.cartaActual;
                    let nuevaCarta = sala.mazo.pop();
                    sala.descarte.push(cartaVieja);
                    jugadorActual.cartaActual = nuevaCarta;
                    io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                    io.to(idSala).emit('mensajeGlobal', `🃏 ${jugadorActual.nombre} robó del mazo (no puede cambiar con quien tocó la campana).`);
                    io.to(idSala).emit('actualizarMazo', { cartasRestantes: sala.mazo.length });
                } else {
                    io.to(idSala).emit('mensajeGlobal', `⚠️ No quedan cartas en el mazo, ${jugadorActual.nombre} mantiene.`);
                }
            } else {
                let temp = jugadorActual.cartaActual;
                jugadorActual.cartaActual = jugadorDerecha.cartaActual;
                jugadorDerecha.cartaActual = temp;
                io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                io.to(jugadorDerecha.id).emit('tuCarta', jugadorDerecha.cartaActual);
                io.to(idSala).emit('mensajeGlobal', `🔄 ${jugadorActual.nombre} intercambió carta.`);
                if (sala.config.modoRey === "DECLARADO" && sala.config.modoJuego !== 'CAMPANA') {
                    jugadorActual.cartaRevelada = jugadorActual.cartaActual === 9;
                    jugadorDerecha.cartaRevelada = jugadorDerecha.cartaActual === 9;
                }
            }
        } else {
            // Reshuffle descarte si el mazo está vacío
            if (sala.mazo.length === 0 && sala.descarte.length > 0) {
                sala.mazo = sala.descarte.sort(() => Math.random() - 0.5);
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
                io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                io.to(idSala).emit('mensajeGlobal', `🃏 El Dealer (${jugadorActual.nombre}) cambió su carta con el mazo.`);
                io.to(idSala).emit('actualizarMazo', { cartasRestantes: sala.mazo.length });
            } else {
                io.to(idSala).emit('mensajeGlobal', `⚠️ No quedan cartas en el mazo, el Dealer mantiene.`);
            }
        }
    } else {
        io.to(idSala).emit('mensajeGlobal', `✋ ${jugadorActual.nombre} decidió mantener.`);
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

function iniciarRevancha(sala, io) {
    if (!estadoSalas[sala.idSala]) return;
    if (sala.estadoActual !== "FINALIZADO") return;
    if (sala.revanchaIniciada) return;
    sala.revanchaIniciada = true;

    // Solo quedan los humanos que votaron revancha
    sala.jugadores = sala.jugadores.filter(j => !j.esBot && sala.votosRevancha.has(j.nombre));
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
    sala.revanchaIniciada = false;
    sala.rondaActual = 0;
    sala.dealerIndex = 0;
    sala.mazo = crearMazo(sala.config);
    sala.descarte = [];
    sala.estadoActual = "EN_JUEGO";

    io.to(sala.idSala).emit('revanchaIniciando');
    setTimeout(() => { iniciarRonda(sala, io); }, 1500);
}

// ==========================================
// CONEXIONES SOCKET
// ==========================================
io.on('connection', (socket) => {
    const nombreUsuarioLogueado = socket.usuario.username;
    console.log(`🌐 Socket conectado: ${nombreUsuarioLogueado} (${socket.id})`);

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
        let sala = estadoSalas[idSala];
        if (!sala) return;
        let idx = sala.jugadores.findIndex(j => j.nombre === nombreUsuarioLogueado);
        if (idx !== -1) {
            if (sala.estadoActual === "LOBBY") {
                sala.jugadores.splice(idx, 1);
                if (sala.jugadores.length === 0) delete estadoSalas[idSala];
                else emitirLobby(idSala);
            } else {
                sala.jugadores[idx].vidas = 0;
                sala.jugadores[idx].online = false;
                io.to(idSala).emit('mensajeGlobal', `🏳️ ${nombreUsuarioLogueado} ha desertado de la corte.`);
            }
        }
    });

    socket.on('crearSala', ({ configuracion }) => {
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
            campanaTocada: false, campanaTocadorId: null, campanaTocadorIndex: -1
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
        console.log(`🏰 Sala ${idSala} creada por ${nombreUsuarioLogueado}`);
    });

    socket.on('unirseSala', ({ idSala, password }) => {
        const username = socket.usuario ? socket.usuario.username : null;
        if (!username) return socket.emit('errorSala', 'Error de sesión. Vuelve a iniciar.');

        const sala = estadoSalas[idSala?.toUpperCase()];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');

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
                    jugadores: sala.jugadores,
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
        let sala = estadoSalas[idSala];
        if (sala && sala.jugadores[0].nombre === nombreUsuarioLogueado) {
            sala.rondaActual = 0;
            sala.dealerIndex = 0;
            sala.mazo = crearMazo(sala.config);
            sala.descarte = [];
            iniciarRonda(sala, io);
            console.log(`🎮 Partida iniciada en sala ${idSala}`);
        }
    });

    socket.on('siguienteRonda', (id) => {
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

        io.to(id).emit('nuevaRondaIniciada', { jugadoresActualizados: sala.jugadores });
        iniciarRonda(sala, io);
    });

    socket.on('accionJugador', ({ idSala, accion }) => {
        if (!permitir(socket.id, 'accionJugador', 400)) return;
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
        const sala = estadoSalas[idSala];
        if (!sala || sala.estadoActual !== "FINALIZADO") return;
        if (!sala.votosRevancha) sala.votosRevancha = new Set();
        sala.votosRevancha.add(socket.usuario.username);
        const humanos = sala.jugadores.filter(j => !j.esBot && j.online);
        io.to(idSala).emit('contadorRevancha', {
            votos: sala.votosRevancha.size,
            total: humanos.length
        });
        if (sala.votosRevancha.size >= humanos.length) {
            iniciarRevancha(sala, io);
        }
    });

    socket.on('reaccion', ({ idSala, emoji }) => {
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
                        delete estadoSalas[id];
                    } else {
                        emitirLobby(id); // ← USA HELPER
                    }
                } else if (sala.estadoActual === "FINALIZADO") {
                    jugador.online = false;
                    if (sala.jugadores.every(j => !j.online)) delete estadoSalas[id];
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
                        let salaActual = estadoSalas[id];
                        if (salaActual) {
                            let jPerdido = salaActual.jugadores.find(x => x.nombre === jugador.nombre);
                            if (jPerdido && !jPerdido.online && jPerdido.vidas > 0) {
                                jPerdido.vidas = 0;
                                io.to(id).emit('mensajeGlobal', `☠️ ${jPerdido.nombre} no regresó a tiempo y fue eliminado.`);
                                io.to(id).emit('nuevaRondaIniciada', { jugadoresActualizados: salaActual.jugadores });
                            }
                        }
                    }, 180000); // 3 minutos — margen para bloqueo de pantalla en móvil
                }
                break;
            }
        }
    });
});

async function agregarColumnasSiNoExisten() {
    const columnas = [
        { nombre: 'partidas_jugadas', tipo: 'INT DEFAULT 0' },
        { nombre: 'racha_actual',     tipo: 'INT DEFAULT 0' },
        { nombre: 'racha_maxima',     tipo: 'INT DEFAULT 0' },
    ];
    for (const col of columnas) {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = ?`,
            [col.nombre]
        );
        if (rows[0].cnt === 0) {
            await pool.execute(`ALTER TABLE usuarios ADD COLUMN ${col.nombre} ${col.tipo}`);
            console.log(`✅ Columna '${col.nombre}' creada`);
        }
    }
}

const PUERTO = process.env.PORT || 4000;
server.listen(PUERTO, async () => {
    console.log(`🚀 Servidor en puerto ${PUERTO}`);
    try {
        await agregarColumnasSiNoExisten();
        console.log('✅ Columnas de stats verificadas');
    } catch (err) {
        console.error('⚠️ Error en migración de stats:', err.message);
    }
});