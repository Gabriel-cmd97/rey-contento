const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });

const estadoSalas = {};

// 🛠️ MODIFICADO: Ahora el mazo acepta más de un 9
function generarMazoMezclado(frecuenciaReyes) {
    let mazo = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    
    // Si el creador eligió locura, metemos más Reyes al mazo base
    if (frecuenciaReyes === "ALTA") mazo.push(9); // 11 cartas (dos 9s)
    if (frecuenciaReyes === "LOCURA") mazo.push(9, 9); // 12 cartas (tres 9s)

    for (let i = mazo.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mazo[i], mazo[j]] = [mazo[j], mazo[i]];
    }
    return mazo;
}

function resolverRonda(sala, io) {
    sala.estadoActual = "REVELACION";
    let minValor = 10; 

    sala.jugadores.forEach(j => {
        if (j.cartaActual < minValor) minValor = j.cartaActual;
    });

    let perdedores = [];
    sala.jugadores.forEach(j => {
        if (j.cartaActual === minValor) {
            j.vidas -= 1;
            perdedores.push(j.id);
        }
    });

    io.to(sala.idSala).emit('rondaTerminada', {
        jugadores: sala.jugadores,
        perdedores: perdedores,
        cartaMortal: minValor
    });
}

function repartirYRevisarRey(sala, io) {
    sala.jugadores.forEach(jugador => {
        jugador.cartaActual = sala.mazo.pop(); 
        jugador.yaJugo = false;
        io.to(jugador.id).emit('tuCarta', jugador.cartaActual);
    });

    if (sala.config.modoRey === "DECLARADO") {
        sala.jugadores.forEach(j => {
            if (j.cartaActual === 9) {
                io.to(sala.idSala).emit('reyRevelado', j.id);
            }
        });
    }
}

function evaluarTurnoAutomatico(sala, io) {
    if (!sala || sala.estadoActual !== "TURNOS_INTERCAMBIO") return;

    let indiceActual = sala.turnoActualIndex;
    let jugadorActual = sala.jugadores[indiceActual];
    let indiceDerecha = (indiceActual + 1) % sala.jugadores.length;
    let jugadorDerecha = sala.jugadores[indiceDerecha];

    let debeSaltar = false;
    let razon = "";

    if (jugadorActual.cartaActual === 9) {
        debeSaltar = true;
        razon = `👑 Jugador ${jugadorActual.id.substring(0,5)} tiene al Rey. Mantiene su carta automáticamente.`;
    } 
    else if (sala.config.modoRey === "DECLARADO" && jugadorDerecha.cartaActual === 9 && indiceActual !== sala.dealerIndex) {
        debeSaltar = true;
        razon = `🛡️ Jugador ${jugadorActual.id.substring(0,5)} está bloqueado por un Rey Declarado. Turno saltado automáticamente.`;
    }

    if (debeSaltar) {
        jugadorActual.yaJugo = true;
        io.to(sala.idSala).emit('mensajeGlobal', razon);

        setTimeout(() => {
            if (!estadoSalas[sala.idSala]) return; 

            if (indiceActual === sala.dealerIndex) {
                resolverRonda(sala, io); 
            } else {
                sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
                let idSiguiente = sala.jugadores[sala.turnoActualIndex].id;
                io.to(sala.idSala).emit('cambioDeTurno', idSiguiente);
                evaluarTurnoAutomatico(sala, io); 
            }
        }, 1500);
    }
}

io.on('connection', (socket) => {
    
    // 🛠️ MODIFICADO: Recibimos el objeto completo de configuración
    socket.on('crearSala', (configuracionDelCreador) => {
        const idSala = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        
        estadoSalas[idSala] = {
            idSala: idSala,
            estadoActual: "LOBBY",
            config: configuracionDelCreador, // Guardamos todas las reglas aquí
            jugadores: [ { id: socket.id, vidas: configuracionDelCreador.vidas } ]
        };
        
        socket.join(idSala);
        socket.emit('salaCreada', idSala); 
        io.to(idSala).emit('actualizarLobby', estadoSalas[idSala].jugadores);
    });
    
    socket.on('unirseSala', (idSala) => {
        const salaBuscada = idSala.toUpperCase();
        let sala = estadoSalas[salaBuscada];

        if (sala) {
            // 🛠️ MODIFICADO: Validar si la sala ya está llena
            if (sala.jugadores.length >= sala.config.maxJugadores) {
                socket.emit('errorSala', 'La sala ya está llena.');
                return;
            }

            const yaEsta = sala.jugadores.find(j => j.id === socket.id);
            if (!yaEsta) {
                socket.join(salaBuscada);
                // 🛠️ MODIFICADO: Entra con las vidas que decidió el creador
                sala.jugadores.push({ id: socket.id, vidas: sala.config.vidas });
                io.to(salaBuscada).emit('actualizarLobby', sala.jugadores);
            }
        } else {
            socket.emit('errorSala', 'La sala no existe.');
        }
    });
    
    socket.on('iniciarPartida', (idSala) => {
        let sala = estadoSalas[idSala];
        if (sala && sala.jugadores[0].id === socket.id) { 
            sala.estadoActual = "TURNOS_INTERCAMBIO";
            sala.mazo = generarMazoMezclado(sala.config.frecuenciaReyes); // 🛠️ Usa la frecuencia elegida
            sala.descarte = [];
            sala.dealerIndex = 0;
            sala.turnoActualIndex = 1 % sala.jugadores.length; 

            repartirYRevisarRey(sala, io); 

            let idJugadorEnTurno = sala.jugadores[sala.turnoActualIndex].id;
            io.to(idSala).emit('juegoIniciado', idJugadorEnTurno);
            
            evaluarTurnoAutomatico(sala, io);
        }
    });
    
    socket.on('siguienteRonda', (idSala) => {
        let sala = estadoSalas[idSala];
        if (!sala || sala.jugadores[0].id !== socket.id) return;

        sala.jugadores = sala.jugadores.filter(j => j.vidas > 0);

        if (sala.jugadores.length === 1) {
            io.to(idSala).emit('finDelJuego', sala.jugadores[0]);
            return; 
        }

        sala.estadoActual = "TURNOS_INTERCAMBIO";
        sala.mazo = generarMazoMezclado(sala.config.frecuenciaReyes); // 🛠️ Usa la frecuencia elegida
        sala.descarte = [];
        sala.dealerIndex = 0; 
        sala.turnoActualIndex = 1 % sala.jugadores.length; 

        let idJugadorEnTurno = sala.jugadores[sala.turnoActualIndex].id;
        io.to(idSala).emit('nuevaRondaIniciada', {
            turno: idJugadorEnTurno,
            jugadoresActualizados: sala.jugadores
        });

        repartirYRevisarRey(sala, io); 
        evaluarTurnoAutomatico(sala, io);
    });

    socket.on('accionJugador', ({ idSala, accion }) => {
        let sala = estadoSalas[idSala];
        if (!sala) return;

        let indiceActual = sala.turnoActualIndex;
        let jugadorActual = sala.jugadores[indiceActual];

        if (jugadorActual.id !== socket.id) return;

        if (accion === 'CAMBIAR') {
            if (indiceActual !== sala.dealerIndex) {
                let indiceDerecha = (indiceActual + 1) % sala.jugadores.length;
                let jugadorDerecha = sala.jugadores[indiceDerecha];

                if (jugadorDerecha.cartaActual === 9) {
                    io.to(idSala).emit('mensajeGlobal', `🛡️ ¡BLOQUEO REAL! Jugador ${jugadorActual.id.substring(0,5)} intentó cambiar, pero chocó con el Rey (9). Pierde su turno.`);
                } else {
                    let temp = jugadorActual.cartaActual;
                    jugadorActual.cartaActual = jugadorDerecha.cartaActual;
                    jugadorDerecha.cartaActual = temp;

                    io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                    io.to(jugadorDerecha.id).emit('tuCarta', jugadorDerecha.cartaActual);
                    io.to(idSala).emit('mensajeGlobal', `🔄 Alguien forzó un cambio de carta.`);
                }
            } else {
                sala.descarte.push(jugadorActual.cartaActual);
                jugadorActual.cartaActual = sala.mazo.pop();
                io.to(jugadorActual.id).emit('tuCarta', jugadorActual.cartaActual);
                io.to(idSala).emit('mensajeGlobal', `🃏 El Dealer cambió su carta con el mazo.`);
            }
        } else {
            io.to(idSala).emit('mensajeGlobal', `✋ Alguien decidió mantener su carta.`);
        }

        jugadorActual.yaJugo = true;

        if (indiceActual === sala.dealerIndex) {
            resolverRonda(sala, io); 
        } else {
            sala.turnoActualIndex = (sala.turnoActualIndex + 1) % sala.jugadores.length;
            let idSiguiente = sala.jugadores[sala.turnoActualIndex].id;
            io.to(idSala).emit('cambioDeTurno', idSiguiente);
            
            evaluarTurnoAutomatico(sala, io);
        }
    });

    socket.on('disconnect', () => {
        for (let idSala in estadoSalas) {
            let sala = estadoSalas[idSala];
            let indexJugador = sala.jugadores.findIndex(j => j.id === socket.id);

            if (indexJugador !== -1) {
                sala.jugadores.splice(indexJugador, 1);
                
                if (sala.jugadores.length === 0) {
                    delete estadoSalas[idSala];
                } else {
                    io.to(idSala).emit('mensajeGlobal', `⚠️ Un jugador abandonó el reino.`);
                    if (sala.estadoActual === "LOBBY") {
                        io.to(idSala).emit('actualizarLobby', sala.jugadores);
                    } else if (sala.jugadores.length === 1) {
                        io.to(idSala).emit('finDelJuego', sala.jugadores[0]);
                    } else if (sala.estadoActual === "TURNOS_INTERCAMBIO") {
                        if (sala.turnoActualIndex >= sala.jugadores.length) sala.turnoActualIndex = 0;
                        io.to(idSala).emit('cambioDeTurno', sala.jugadores[sala.turnoActualIndex].id);
                        evaluarTurnoAutomatico(sala, io);
                    }
                }
                break; 
            }
        }
    });
});

const PUERTO = 3000;
server.listen(PUERTO, () => console.log(`🚀 Servidor en puerto ${PUERTO}`));