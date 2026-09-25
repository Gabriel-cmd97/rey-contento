// eventos.js — eventos de ronda: una regla especial que dura una sola ronda.
// Nunca en la práctica ni en el duelo final. En modo FIESTA hay evento en
// todas las rondas y la mesa vota el de la siguiente (ver `opcionesVotacion`).
//
// Cómo afecta cada uno (dónde vive la regla):
//   MUNDO_AL_REVES  pierde la carta más alta; el Rey no está protegido
//                   (reglas.resolverCartas, server.reyProtegido, bots)
//   NIEBLA          nadie recibe su carta hasta la revelación (server.enviarCarta, bots)
//   DOBLE_CASTIGO   quien pierde, pierde 2 vidas (reglas.resolverCartas)
//   MERCADO         cambiar = robar del mazo, para todos (server.ejecutarAccion, bots)
//   AMNISTIA        nadie pierde vida; quien tenía la más baja pierde su
//                   turno la ronda siguiente (reglas.resolverCartas, server.gestionarTurnos)
//   CARRUSEL        al acabar los turnos todos pasan su carta a la derecha; el
//                   Rey protegido no se mueve (reglas.rotarCartas, server.resolverRonda)
//   CONFESION       al empezar se anuncia la carta de alguien al azar (server.iniciarRonda)
//   VENGANZA        quien perdió vida la ronda anterior puede cambiar con
//                   cualquiera (server accionJugador `objetivo`, bots)
//   PREMIO          la carta más alta gana una vida, sin pasar de las
//                   iniciales; no en parejas (reglas.resolverCartas)
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
    CARRUSEL:       { id: 'CARRUSEL', titulo: 'Carrusel', icono: 'cambio',
        descripcion: 'Al final de la ronda todos pasan su carta a la derecha. El Rey no se mueve.' },
    CONFESION:      { id: 'CONFESION', titulo: 'Confesión', icono: 'ojo',
        descripcion: 'Al empezar se revela a toda la mesa la carta de alguien al azar.' },
    VENGANZA:       { id: 'VENGANZA', titulo: 'Venganza', icono: 'diana',
        descripcion: 'Quien perdió vida la ronda pasada puede cambiar con cualquier jugador: toca su asiento.' },
    PREMIO:         { id: 'PREMIO', titulo: 'Premio real', icono: 'corona',
        descripcion: 'Quien tenga la carta más alta gana una vida.' },
};
const IDS = Object.keys(CATALOGO);

const PROBABILIDAD = 0.35;      // por ronda, desde la ronda 2
const MAX_RONDAS_SIN_EVENTO = 3; // después de 3 rondas sin evento, el siguiente es seguro

const esFiesta = (sala) => sala.config.modoJuego === 'FIESTA';

// ¿Puede haber evento en esta sala y ronda? `vivos` = jugadores con vida.
// En Fiesta también en la ronda 1.
function puedeHaberEvento(sala, vivos) {
    return sala.config.eventos !== false && !sala.config.practica
        && (sala.rondaActual >= 2 || esFiesta(sala)) && vivos > 2;
}

// Eventos que tienen sentido en esta sala: Premio no en parejas (las vidas son
// del equipo) y Venganza solo si hay algún vengador vivo.
function disponibles(sala) {
    return IDS.filter(id => {
        if (id === 'PREMIO') return !sala.config.equipos;
        if (id === 'VENGANZA') return (sala.vengadores || []).some(n => sala.jugadores?.some(j => j.nombre === n && j.vidas > 0));
        return true;
    });
}

// Decide el evento de la ronda (id o null) y actualiza el contador de la sala.
// Fiesta: siempre hay, y si la mesa votó gana el más votado (empate: azar).
function elegirEvento(sala, vivos, azar = Math.random) {
    const votacion = sala.votacion;
    sala.votacion = null;
    if (!puedeHaberEvento(sala, vivos)) return null;
    sala.rondasSinEvento = (sala.rondasSinEvento || 0) + 1;
    const toca = esFiesta(sala) || sala.rondasSinEvento > MAX_RONDAS_SIN_EVENTO || azar() < PROBABILIDAD;
    if (!toca) return null;
    const validos = disponibles(sala);
    let opciones = validos.filter(id => id !== sala.ultimoEvento); // nunca el mismo dos veces seguidas
    if (votacion) {
        const votadas = votacion.opciones.filter(id => validos.includes(id));
        const conteo = contarVotos(votacion);
        const max = Math.max(0, ...votadas.map(id => conteo[id] || 0));
        const ganadoras = votadas.filter(id => (conteo[id] || 0) === max);
        if (ganadoras.length) opciones = ganadoras;
    }
    const id = opciones[Math.floor(azar() * opciones.length)];
    sala.rondasSinEvento = 0;
    sala.ultimoEvento = id;
    return id;
}

// Fiesta: 3 eventos al azar para que la mesa vote el de la siguiente ronda.
// Se llama al resolver la ronda (ya con los vengadores nuevos).
function opcionesVotacion(sala, azar = Math.random) {
    const pool = disponibles(sala).filter(id => id !== sala.ultimoEvento);
    for (let i = pool.length - 1; i > 0; i--) {
        const k = Math.floor(azar() * (i + 1));
        [pool[i], pool[k]] = [pool[k], pool[i]];
    }
    return pool.slice(0, 3);
}

// votacion = { opciones: [id], votos: { nombre: id } } → { id: cuántos }
function contarVotos(votacion) {
    const conteo = {};
    Object.values(votacion.votos || {}).forEach(id => { conteo[id] = (conteo[id] || 0) + 1; });
    return conteo;
}

module.exports = { CATALOGO, IDS, elegirEvento, puedeHaberEvento, disponibles, opcionesVotacion, contarVotos,
    PROBABILIDAD, MAX_RONDAS_SIN_EVENTO };
