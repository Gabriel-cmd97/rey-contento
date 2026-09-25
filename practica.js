// practica.js — guiones de las partidas de práctica guiada.
//
// Mesa fija: asiento 0 = tú, 1 = bot A (tu vecino de la derecha), 2 = bot B.
// El dealer arranca en B (asiento 2), así en la ronda 1 juegas primero; luego
// rota como siempre: ronda 2 dealer = tú, ronda 3 dealer = A.
//
// Por ronda: `cartas` por asiento, `mazo` = carta que queda arriba del mazo
// (la que roba el dealer si cambia), `bots` = lo que hace cada bot en su turno
// y, opcionalmente, `evento` (id de eventos.js), `confesion` (asiento cuya
// carta revela la Confesión), `poderes` que recibe cada
// asiento al empezar la ronda y `esperaInicio` (ms extra antes del primer
// turno, para dar tiempo a leer y reaccionar). El texto de cada paso vive en
// el cliente (main.js, PRÁCTICA GUIADA); si cambias las cartas, revisa esos textos.
// Pruebas: tests/practica.test.js.

const DEALER_INICIAL = 2;

const GUIONES = {
    // Lo básico: pierde la más baja, cambiar con tu derecha, el dealer roba
    // del mazo y el Rey declarado no se deja quitar.
    basica: {
        1: { cartas: [1, 7, 4], mazo: 5, bots: { 1: 'CAMBIAR', 2: 'CAMBIAR' } },
        2: { cartas: [2, 8, 6], mazo: 7, bots: { 1: 'MANTENER', 2: 'MANTENER' } },
        3: { cartas: [6, 9, 2], mazo: 5, bots: { 1: 'MANTENER', 2: 'MANTENER' } },
    },
    // Eventos y poderes: Mundo al revés, el Oráculo del dealer y el Escudo.
    poderes: {
        // Mundo al revés: tu 8 es peligroso; al cambiarlo con A, A pierde.
        1: { cartas: [8, 2, 5], mazo: 6, bots: { 1: 'MANTENER', 2: 'MANTENER' }, evento: 'MUNDO_AL_REVES' },
        // Eres el dealer con un 3; el Oráculo te muestra un 8 arriba del mazo.
        2: { cartas: [3, 7, 4], mazo: 8, bots: { 1: 'MANTENER', 2: 'MANTENER' }, poderes: { 0: ['ORACULO'] } },
        // Tienes un 8; B (tu izquierda) juega primero e intenta quitártelo.
        // Con el Escudo arriba su cambio rebota y B pierde con su 2.
        3: { cartas: [8, 5, 2], mazo: 6, bots: { 1: 'MANTENER', 2: 'CAMBIAR' }, poderes: { 0: ['ESCUDO'] }, esperaInicio: 8000 },
    },
    // Modo Fiesta: los eventos de amigos.
    fiesta: {
        // Confesión: A tiene al Rey y se sabe. Tu 0 no se salva: pierdes y
        // quedas como vengador para la ronda 2.
        1: { cartas: [0, 9, 4], mazo: 5, bots: { 1: 'MANTENER', 2: 'MANTENER' }, evento: 'CONFESION', confesion: 1, esperaInicio: 2500 },
        // Venganza: eres el dealer con un 1; B no cambia su 7 → tocas su asiento.
        2: { cartas: [1, 3, 7], mazo: 2, bots: { 1: 'MANTENER', 2: 'MANTENER' }, evento: 'VENGANZA' },
        // Carrusel: hagas lo que hagas, al final te llega el 8 de B.
        3: { cartas: [3, 6, 8], mazo: 1, bots: { 1: 'MANTENER', 2: 'MANTENER' }, evento: 'CARRUSEL' },
    },
};
const ULTIMA_RONDA = 3;

function guionDe(sala) {
    return GUIONES[sala.config.practica] || GUIONES.basica;
}
function rondaDe(sala) {
    return guionDe(sala)[sala.rondaActual];
}

// Reparte las cartas del guion para la ronda. Devuelve false si la ronda no
// tiene guion (no debería pasar: la práctica se detiene en ULTIMA_RONDA).
function repartirGuion(sala) {
    const r = rondaDe(sala);
    if (!r) return false;
    sala.jugadores.forEach((j, i) => {
        if (j.vidas > 0 && r.cartas[i] !== undefined) j.cartaActual = r.cartas[i];
    });
    sala.mazo.push(r.mazo); // pop() toma el último: queda arriba del mazo
    return true;
}

function decisionBot(sala, indiceBot) {
    return rondaDe(sala)?.bots[indiceBot] || 'MANTENER';
}

function eventoDeRonda(sala) {
    return rondaDe(sala)?.evento || null;
}

// Poderes que el guion da al empezar la ronda: [{ indice, poder }].
function poderesDeRonda(sala) {
    const p = rondaDe(sala)?.poderes || {};
    return Object.entries(p).flatMap(([i, lista]) => lista.map(poder => ({ indice: Number(i), poder })));
}

// Asiento cuya carta revela la Confesión del guion (null = al azar).
function confesionDeRonda(sala) {
    const i = rondaDe(sala)?.confesion;
    return i === undefined ? null : i;
}

function esperaInicio(sala) {
    return rondaDe(sala)?.esperaInicio || 0;
}

// Compatibilidad: RONDAS es el guion básico.
const RONDAS = GUIONES.basica;

module.exports = { DEALER_INICIAL, GUIONES, RONDAS, ULTIMA_RONDA, repartirGuion, decisionBot, eventoDeRonda, poderesDeRonda, confesionDeRonda, esperaInicio };
