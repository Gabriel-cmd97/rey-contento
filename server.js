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
        const [rows] = await pool.execute('SELECT username, victorias FROM usuarios ORDER BY victorias DESC LIMIT 5');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'No se pudo cargar el Salón de la Fama' });
    }
});

app.get('/sala/:id', (req, res) => {
    res.redirect(`/?sala=${req.params.id}`);
});

// ==========================================
// MOTOR DEL JUEGO
// ==========================================
function resolverRonda(sala, io) {
    if (sala.estadoActual === "REVELACION" || sala.estadoActual === "FINALIZADO") return;
    sala.estadoActual = "REVELACION";
    if (temporizadores[sala.idSala]) clearTimeout(temporizadores[sala.idSala]);

    let vivos = sala.jugadores.filter(j => j.vidas > 0);
    if (vivos.length === 0) return;

    let minValor = Math.min(...vivos.map(j => j.cartaActual));
    let perdedores = [];

    sala.jugadores.forEach(j => {
        if (j.vidas > 0 && j.cartaActual === minValor) {
            j.vidas -= 1;
            perdedores.push(j.id);
        }
    });

    let sobrevivientes = sala.jugadores.filter(j => j.vidas > 0);
    let juegoTerminado = sobrevivientes.length <= 1;

    if (juegoTerminado) sala.estadoActual = "FINALIZADO";

    io.to(sala.idSala).emit('rondaTerminada', {
        jugadores: sala.jugadores,
        perdedores: perdedores,
        cartaMortal: minValor,
        dealerId: sala.jugadores[sala.dealerIndex].id,
        juegoTerminado: juegoTerminado
    });

    if (!juegoTerminado && sala.jugadores[sala.dealerIndex].esBot) {
        setTimeout(() => {
            if (!estadoSalas[sala.idSala] || sala.estadoActual !== "REVELACION") return;
            let vivos = sala.jugadores.filter(j => j.vidas > 0);
            if (vivos.length <= 1) return;
            sala.estadoActual = "PREPARANDO_NUEVA_RONDA";
            io.to(sala.idSala).emit('nuevaRondaIniciada', { jugadoresActualizados: sala.jugadores });
            iniciarRonda(sala, io);
        }, 4000);
    }

    if (juegoTerminado) {
        const ganador = sobrevivientes[0] || { nombre: "Nadie (Empate total)", vidas: 0 };
        setTimeout(() => {
            io.to(sala.idSala).emit('finDelJuego', ganador);
            if (ganador.id) {
                pool.execute('UPDATE usuarios SET victorias = victorias + 1 WHERE username = ?', [ganador.nombre])
                    .catch(err => console.error(err));
            }
        }, 4000);
    }
}

function gestionarTurnos(sala, io, esInicio = false) {
    if (!estadoSalas[sala.idSala] || sala.estadoActual !== "TURNOS_INTERCAMBIO") return;

    if (temporizadores[sala.idSala]) {
        clearTimeout(temporizadores[sala.idSala]);
        delete temporizadores[sala.idSala];
    }

    let indiceActual = sala.turnoActualIndex;
    let jugadorActual = sala.jugadores[indiceActual];
    let indiceDerecha = (indiceActual + 1) % sala.jugadores.length;
    let jugadorDerecha = sala.jugadores[indiceDerecha];

    if (jugadorActual.vidas <= 0) {
        if (indiceActual === sala.dealerIndex) {
            resolverRonda(sala, io);
        } else {
            let intentos = 0;
            do {
                sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
                intentos++;
            } while (intentos < sala.jugadores.length && sala.jugadores[sala.turnoActualIndex].vidas <= 0);

            if (sala.jugadores[sala.turnoActualIndex].vidas <= 0) {
                resolverRonda(sala, io);
            } else {
                gestionarTurnos(sala, io, false);
            }
        }
        return;
    }

    let debeSaltar = false;
    let razon = "";

    if (jugadorActual.cartaActual === 9) {
        debeSaltar = true;
        razon = `👑 ${jugadorActual.nombre} tiene al Rey. Turno auto-completado.`;
    } else if (sala.config.modoRey === "DECLARADO" && jugadorDerecha.cartaActual === 9 && indiceActual !== sala.dealerIndex) {
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
        }, 2000);
    } else {
        let idJugadorEnTurno = jugadorActual.id;
        let tiempoTurno = jugadorActual.online ? 10 : 30;

        if (esInicio) {
            io.to(sala.idSala).emit('juegoIniciado', {
                id: idJugadorEnTurno, nombre: jugadorActual.nombre,
                tiempo: tiempoTurno, jugadores: sala.jugadores
            });
        } else {
            io.to(sala.idSala).emit('cambioDeTurno', {
                id: idJugadorEnTurno, nombre: jugadorActual.nombre,
                tiempo: tiempoTurno, jugadores: sala.jugadores
            });
        }

        if (jugadorActual.esBot) {
            const decision = jugadorActual.cartaActual <= 4 ? 'CAMBIAR' : 'MANTENER';
            setTimeout(() => {
                const salaActual = estadoSalas[sala.idSala];
                if (!salaActual) return;
                const botVivo = salaActual.jugadores.find(j => j.id === jugadorActual.id && j.vidas > 0);
                if (!botVivo) return;
                ejecutarAccion(sala.idSala, decision, io, jugadorActual.id);
            }, 2000);
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
        io.to(idSala).emit('mensajeGlobal', `⏰ Tiempo agotado para ${jugadorActual.nombre}. Se mantiene su carta.`);
        ejecutarAccion(idSala, 'MANTENER', io, jugadorActual.id);
    }, (tiempoSegundos || 10) * 1000);
}

function iniciarRonda(sala, io) {
    sala.rondaActual += 1;
    sala.estadoActual = "TURNOS_INTERCAMBIO";
    sala.descarte = [];

    let mazoBase = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    let cantidadReyes = sala.config.frecuenciaReyes === "LOCURA" ? 3 : sala.config.frecuenciaReyes === "ALTA" ? 2 : 1;
    for (let i = 0; i < cantidadReyes; i++) mazoBase.push(9);
    sala.mazo = mazoBase.sort(() => Math.random() - 0.5);

    let vivos = sala.jugadores.filter(j => j.vidas > 0);

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
        do {
            sala.dealerIndex = (sala.dealerIndex + 1) % sala.jugadores.length;
        } while (sala.jugadores[sala.dealerIndex].vidas <= 0);
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
        dealer: sala.jugadores[sala.dealerIndex].nombre
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

    setTimeout(() => { gestionarTurnos(sala, io, true); }, 1000);
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

    if (accion === 'CAMBIAR') {
        if (indiceActual !== sala.dealerIndex) {
            let indiceDerecha = indiceActual;
            let intentos = 0;
            do {
                indiceDerecha = (indiceDerecha + 1) % sala.jugadores.length;
                intentos++;
            } while (sala.jugadores[indiceDerecha].vidas <= 0 && intentos < sala.jugadores.length);

            let jugadorDerecha = sala.jugadores[indiceDerecha];
            if (jugadorDerecha.cartaActual === 9) {
                const msgBloqueo = sala.config.modoRey === "DECLARADO"
                    ? `🛡️ ${jugadorActual.nombre} no puede cambiar — el Rey ya está a la vista.`
                    : `🛡️ ¡BLOQUEO REAL! ${jugadorActual.nombre} chocó con el Rey.`;
                io.to(idSala).emit('mensajeGlobal', msgBloqueo);
            } else {
                let temp = jugadorActual.cartaActual;
                jugadorActual.cartaActual = jugadorDerecha.cartaActual;
                jugadorDerecha.cartaActual = temp;
                io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                io.to(jugadorDerecha.id).emit('tuCarta', jugadorDerecha.cartaActual);
                io.to(idSala).emit('mensajeGlobal', `🔄 ${jugadorActual.nombre} intercambió carta.`);
                // Actualizar cartaRevelada tras intercambio en modo DECLARADO
                if (sala.config.modoRey === "DECLARADO") {
                    jugadorActual.cartaRevelada = jugadorActual.cartaActual === 9;
                    jugadorDerecha.cartaRevelada = jugadorDerecha.cartaActual === 9;
                }
            }
        } else {
            if (sala.mazo.length > 0) {
                sala.descarte.push(jugadorActual.cartaActual);
                jugadorActual.cartaActual = sala.mazo.pop();
                io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                io.to(idSala).emit('mensajeGlobal', `🃏 El Dealer (${jugadorActual.nombre}) cambió su carta con el mazo.`);
            } else {
                io.to(idSala).emit('mensajeGlobal', `⚠️ No quedan cartas en el mazo, el Dealer mantiene.`);
            }
        }
    } else {
        io.to(idSala).emit('mensajeGlobal', `✋ ${jugadorActual.nombre} decidió mantener.`);
    }

    jugadorActual.yaJugo = true;

    if (indiceActual === sala.dealerIndex) {
        setTimeout(() => { resolverRonda(sala, io); }, 1000);
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
        const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let idSala = '';
        for (let i = 0; i < 5; i++) idSala += caracteres.charAt(Math.floor(Math.random() * caracteres.length));

        estadoSalas[idSala] = {
            idSala, estadoActual: "LOBBY", config: configuracion, hostId: socket.id, hostNombre: nombreUsuarioLogueado,
            jugadores: [{ id: socket.id, nombre: nombreUsuarioLogueado, vidas: configuracion.vidas, yaJugo: false, online: true }],
            dealerIndex: 0, turnoActualIndex: 1, mazo: [], descarte: [], rondaActual: 1
        };

        const numBots = configuracion.numBots || 0;
        for (let i = 1; i <= numBots; i++) {
            estadoSalas[idSala].jugadores.push({
                id: 'bot_' + i, nombre: '🤖 Bot ' + i,
                vidas: configuracion.vidas, yaJugo: false, online: true, esBot: true
            });
        }

        socket.join(idSala);
        socket.emit('salaCreada', idSala);
        emitirLobby(idSala); // ← USA HELPER
        console.log(`🏰 Sala ${idSala} creada por ${nombreUsuarioLogueado}`);
    });

    socket.on('unirseSala', ({ idSala }) => {
        const username = socket.usuario ? socket.usuario.username : null;
        if (!username) return socket.emit('errorSala', 'Error de sesión. Vuelve a iniciar.');

        const sala = estadoSalas[idSala?.toUpperCase()];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');

        let jugadorExistente = sala.jugadores.find(j => j.nombre === username);

        if (jugadorExistente) {
            if (temporizadoresDesconexion[username]) {
                clearTimeout(temporizadoresDesconexion[username]);
                delete temporizadoresDesconexion[username];
                io.to(sala.idSala).emit('mensajeGlobal', `🔌 ${username} regresó a la batalla a tiempo.`);
            }
            jugadorExistente.id = socket.id;
            jugadorExistente.online = true;
            socket.join(sala.idSala);

            if (sala.estadoActual !== "LOBBY") {
                socket.emit('reconexionExitosa', {
                    idSala: sala.idSala,
                    carta: jugadorExistente.cartaActual,
                    ronda: sala.rondaActual,
                    dealer: sala.jugadores[sala.dealerIndex].nombre,
                    jugadores: sala.jugadores,
                    estado: sala.estadoActual,
                    turnoEnCurso: sala.jugadores[sala.turnoActualIndex].id
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

        socket.join(sala.idSala);
        sala.jugadores.push({ id: socket.id, nombre: username, vidas: sala.config.vidas, yaJugo: false, online: true });
        emitirLobby(sala.idSala); // ← USA HELPER
    });

    socket.on('iniciarPartida', (idSala) => {
        let sala = estadoSalas[idSala];
        if (sala && sala.hostNombre === nombreUsuarioLogueado) {
            sala.rondaActual = 0;
            sala.dealerIndex = 0;
            iniciarRonda(sala, io);
            console.log(`🎮 Partida iniciada en sala ${idSala}`);
        }
    });

    socket.on('siguienteRonda', (id) => {
        const sala = estadoSalas[id];
        if (!sala || sala.jugadores[sala.dealerIndex].id !== socket.id || sala.estadoActual !== "REVELACION") return;

        sala.estadoActual = "PREPARANDO_NUEVA_RONDA";
        let vivos = sala.jugadores.filter(j => j.vidas > 0);

        if (vivos.length === 1) {
            const ganador = vivos[0];
            sala.estadoActual = "FINALIZADO";
            io.to(id).emit('finDelJuego', ganador);
            pool.execute('UPDATE usuarios SET victorias = victorias + 1 WHERE username = ?', [ganador.nombre])
                .catch(err => console.error(err));
            return;
        } else if (vivos.length === 0) {
            sala.estadoActual = "FINALIZADO";
            io.to(id).emit('finDelJuego', { nombre: "Nadie (Empate Total)", vidas: 0 });
            return;
        }

        io.to(id).emit('nuevaRondaIniciada', { jugadoresActualizados: sala.jugadores });
        iniciarRonda(sala, io);
    });

    socket.on('accionJugador', ({ idSala, accion }) => {
        ejecutarAccion(idSala, accion, io, socket.id);
    });

    socket.on('disconnect', () => {
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
                    io.to(id).emit('mensajeGlobal', `⚠️ ${jugador.nombre} perdió la conexión. Tiene 30 segundos para volver.`);
                    temporizadoresDesconexion[jugador.nombre] = setTimeout(() => {
                        let salaActual = estadoSalas[id];
                        if (salaActual) {
                            let jPerdido = salaActual.jugadores.find(x => x.nombre === jugador.nombre);
                            if (jPerdido && !jPerdido.online && jPerdido.vidas > 0) {
                                jPerdido.vidas = 0;
                                io.to(id).emit('mensajeGlobal', `☠️ ${jPerdido.nombre} no regresó a tiempo y fue eliminado.`);
                                // Si era su turno, avanzar el juego para que no quede congelado
                                if (salaActual.estadoActual === "TURNOS_INTERCAMBIO" &&
                                    salaActual.jugadores[salaActual.turnoActualIndex]?.nombre === jPerdido.nombre) {
                                    ejecutarAccion(id, 'MANTENER', io, jPerdido.id);
                                } else {
                                    io.to(id).emit('nuevaRondaIniciada', { jugadoresActualizados: salaActual.jugadores });
                                }
                            }
                        }
                    }, 30000);
                }
                break;
            }
        }
    });
});

const PUERTO = process.env.PORT || 4000;
server.listen(PUERTO, () => console.log(`🚀 Servidor en puerto ${PUERTO}`));