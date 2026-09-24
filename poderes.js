// poderes.js — modo "Con poderes" (config.poderes). Cada vez que un jugador
// pierde una vida y sigue en juego recibe un poder al azar (máximo
// MAX_PODERES guardados). Cada poder se usa una vez.
//
//   ESPIAR   en tu turno: ves la carta de tu vecino de la derecha (solo tú)
//   ORACULO  en tu turno: ves la carta de arriba del mazo (solo tú)
//   SALTO    en tu turno, en lugar de jugar: cambias con quien está dos
//            lugares a tu derecha (el Rey y los escudos lo bloquean)
//   ESCUDO   en cualquier momento de la ronda: nadie puede cambiar contigo
//            hasta que termine la ronda
//
// El servidor aplica los efectos (server.js, socket 'usarPoder'); aquí viven
// el catálogo, a quién se da y cómo deciden los bots. `icono` es un símbolo
// del sprite de index.html.

const CATALOGO = {
    ESPIAR:  { id: 'ESPIAR',  titulo: 'Espiar',  icono: 'ojo',     enTuTurno: true,
               descripcion: 'Ves la carta de tu vecino de la derecha.' },
    ORACULO: { id: 'ORACULO', titulo: 'Oráculo', icono: 'naipe',   enTuTurno: true,
               descripcion: 'Ves la carta de arriba del mazo.' },
    SALTO:   { id: 'SALTO',   titulo: 'Salto',   icono: 'flecha',  enTuTurno: true,
               descripcion: 'Cambias con quien está dos lugares a tu derecha.' },
    ESCUDO:  { id: 'ESCUDO',  titulo: 'Escudo',  icono: 'escudo',  enTuTurno: false,
               descripcion: 'Nadie puede cambiar contigo esta ronda.' },
};
const IDS = Object.keys(CATALOGO);
const MAX_PODERES = 2;

// Da un poder al azar a quien perdió una vida. Devuelve el id o null.
function darPoder(jugador, azar = Math.random) {
    jugador.poderes ||= [];
    if (jugador.vidas <= 0 || jugador.poderes.length >= MAX_PODERES) return null;
    const id = IDS[Math.floor(azar() * IDS.length)];
    jugador.poderes.push(id);
    return id;
}

function quitarPoder(jugador, id) {
    const i = (jugador.poderes || []).indexOf(id);
    if (i === -1) return false;
    jugador.poderes.splice(i, 1);
    return true;
}

// ¿Conviene la carta `otra` en lugar de la `mia`? (la más baja pierde, salvo
// que pierda la más alta: campana o "Mundo al revés")
function mejorQue(otra, mia, pierdeLaMasAlta) {
    return pierdeLaMasAlta ? otra < mia : otra > mia;
}

// Qué poder usa un bot antes de su jugada (o null). `ctx`: { esDealer,
// puedeSaltar, pierdeLaMasAlta, mercado, niebla }. Decide con su propia carta,
// que conoce (salvo en la niebla, donde solo usa el escudo al azar).
function poderParaBot(bot, ctx, azar = Math.random) {
    const p = bot.poderes || [];
    if (!p.length) return null;
    const c = bot.cartaActual;
    const buena = ctx.pierdeLaMasAlta ? c <= 3 : c >= 6;
    const mala = ctx.pierdeLaMasAlta ? c >= 6 : c <= 3;
    if (ctx.niebla) return p.includes('ESCUDO') && azar() < 0.3 ? 'ESCUDO' : null;
    if (p.includes('ESCUDO') && buena) return 'ESCUDO';                       // proteger una buena carta
    if (p.includes('ORACULO') && (ctx.esDealer || ctx.mercado) && !buena) return 'ORACULO';
    if (p.includes('ESPIAR') && !ctx.esDealer && !ctx.mercado && !buena) return 'ESPIAR';
    if (p.includes('SALTO') && ctx.puedeSaltar && mala && azar() < 0.6) return 'SALTO';
    return null;
}

module.exports = { CATALOGO, IDS, MAX_PODERES, darPoder, quitarPoder, mejorQue, poderParaBot };
