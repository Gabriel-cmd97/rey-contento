// eventos.js — eventos de ronda: una regla especial que dura una sola ronda.
// Solo en modo CLÁSICO, nunca en la práctica ni en el duelo final, y se
// pueden apagar al crear la sala (config.eventos = false).
//
// Cómo afecta cada uno (dónde vive la regla):
//   MUNDO_AL_REVES  pierde la carta más alta; el Rey no está protegido
//                   (reglas.resolverCartas, server.reyProtegido, bots)
//   NIEBLA          nadie recibe su carta hasta la revelación (server.enviarCarta, bots)
//   DOBLE_CASTIGO   quien pierde, pierde 2 vidas (reglas.resolverCartas)
//   MERCADO         cambiar = robar del mazo, para todos (server.ejecutarAccion, bots)
//   AMNISTIA        nadie pierde vida; quien tenía la más baja pierde su
//                   turno la ronda siguiente (reglas.resolverCartas, server.gestionarTurnos)
//
// `icono` es un símbolo del sprite de index.html (i-<icono>).

const CATALOGO = {
    MUNDO_AL_REVES: { id: 'MUNDO_AL_REVES', titulo: 'Mundo al revés', icono: 'cambio',
        descripcion: 'Esta ronda pierde la carta MÁS ALTA. Y el Rey no protege a nadie.' },
    NIEBLA:         { id: 'NIEBLA', titulo: 'Niebla', icono: 'niebla',
        descripcion: 'Nadie ve su carta hasta el final. Decides a ciegas.' },
    DOBLE_CASTIGO:  { id: 'DOBLE_CASTIGO', titulo: 'Doble castigo', icono: 'espadas',
        descripcion: 'Quien pierda esta ronda pierde 2 vidas.' },
    MERCADO:        { id: 'MERCADO', titulo: 'Mercado', icono: 'naipe',
        descripcion: 'Si cambias, robas del mazo. Todos, no solo el dealer.' },
    AMNISTIA:       { id: 'AMNISTIA', titulo: 'Amnistía', icono: 'mano',
        descripcion: 'Nadie pierde vida, pero quien tenga la más baja pierde su próximo turno.' },
};
const IDS = Object.keys(CATALOGO);

const PROBABILIDAD = 0.35;      // por ronda, desde la ronda 2
const MAX_RONDAS_SIN_EVENTO = 3; // después de 3 rondas sin evento, el siguiente es seguro

// ¿Puede haber evento en esta sala y ronda? `vivos` = jugadores con vida.
function puedeHaberEvento(sala, vivos) {
    return sala.config.eventos !== false && !sala.config.practica
        && sala.config.modoJuego !== 'CAMPANA' && sala.rondaActual >= 2 && vivos > 2;
}

// Decide el evento de la ronda (id o null) y actualiza el contador de la sala.
function elegirEvento(sala, vivos, azar = Math.random) {
    if (!puedeHaberEvento(sala, vivos)) return null;
    sala.rondasSinEvento = (sala.rondasSinEvento || 0) + 1;
    const toca = sala.rondasSinEvento > MAX_RONDAS_SIN_EVENTO || azar() < PROBABILIDAD;
    if (!toca) return null;
    const opciones = IDS.filter(id => id !== sala.ultimoEvento); // nunca el mismo dos veces seguidas
    const id = opciones[Math.floor(azar() * opciones.length)];
    sala.rondasSinEvento = 0;
    sala.ultimoEvento = id;
    return id;
}

module.exports = { CATALOGO, IDS, elegirEvento, puedeHaberEvento, PROBABILIDAD, MAX_RONDAS_SIN_EVENTO };
