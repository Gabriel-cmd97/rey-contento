// bots.js — decisión de los bots.
//
// Idea: el bot estima la probabilidad de perder la ronda si MANTIENE su carta
// y si la CAMBIA (por la del vecino derecho o, siendo dealer, por la del
// mazo), y escoge la opción menos riesgosa. Solo usa información que un
// jugador humano atento también tiene: su carta, la pila de descarte (pública),
// los reyes revelados en modo DECLARADO y lo que él mismo dio o recibió en un
// cambio. Nunca mira las cartas ocultas de los demás.
//
// Niveles (config.dificultadBots):
//   FACIL   — umbral fijo (el bot de siempre) y se equivoca 1 de cada 4 veces.
//   NORMAL  — calcula el riesgo con la baraja completa, sin contar cartas.
//   DIFICIL — cuenta el descarte y recuerda los cambios de la ronda.

// Cuántas cartas de cada valor (0..9) trae la baraja: ver crearMazo().
const COMPOSICION = [4, 8, 8, 8, 8, 8, 8, 8, 8, 8];

const DIFICULTADES = ['FACIL', 'NORMAL', 'DIFICIL'];

// Probabilidad de perder con la carta `c` contra `nOtros` cartas desconocidas
// tomadas de `dist` (arreglo de probabilidades por valor).
// Clásico: pierde la más baja. Campana: pierde la más alta. Si todos empatan
// nadie pierde, y si varios empatan en la carta crítica pierden todos.
function probPerder(c, dist, nOtros, esCampana) {
    if (nOtros <= 0) return 0;
    let peorOIgual = 0; // P(una carta ajena no me salva): ≥ c en clásico, ≤ c en campana
    for (let v = 0; v < dist.length; v++) {
        if (esCampana ? v <= c : v >= c) peorOIgual += dist[v];
    }
    const igual = dist[c] || 0;
    return Math.max(0, Math.pow(peorOIgual, nOtros) - Math.pow(igual, nOtros));
}

// Distribución de las cartas que el bot no conoce.
function distribucionDesconocida(sala, bot, dificultad) {
    const cuenta = COMPOSICION.slice();
    const quitar = (v) => { if (v >= 0 && v <= 9 && cuenta[v] > 0) cuenta[v]--; };

    quitar(bot.cartaActual);
    if (dificultad === 'DIFICIL') {
        (sala.descarte || []).forEach(quitar);
        for (const j of sala.jugadores) {
            if (j === bot || j.vidas <= 0) continue;
            const conocida = cartaConocida(sala, bot, j);
            if (conocida !== null) quitar(conocida);
        }
    }
    const total = cuenta.reduce((a, b) => a + b, 0);
    if (total === 0) return COMPOSICION.map(n => n / 76);
    return cuenta.map(n => n / total);
}

// Carta de `j` que el bot conoce legítimamente, o null.
function cartaConocida(sala, bot, j) {
    if (j.cartaRevelada && j.cartaActual === 9) return 9; // Rey declarado, a la vista
    const recuerdo = bot.memoria && bot.memoria[j.id];
    return recuerdo === undefined ? null : recuerdo;
}

function probPerderSiCambia(dist, nOtros, esCampana) {
    let p = 0;
    for (let x = 0; x < dist.length; x++) {
        if (dist[x] > 0) p += dist[x] * probPerder(x, dist, nOtros, esCampana);
    }
    return p;
}

// El bot de siempre: umbral fijo.
function decisionFacil(sala, bot) {
    const c = bot.cartaActual;
    if (sala.config.modoJuego === 'CAMPANA') {
        if (!sala.campanaTocada && c <= 2) return 'CAMPANA';
        return c >= 6 ? 'CAMBIAR' : 'MANTENER';
    }
    return c <= 4 ? 'CAMBIAR' : 'MANTENER';
}

// ctx: { esDealer, derecha (jugador vecino derecho vivo), derechaEsRinger }
function decidirBot(sala, bot, ctx, azar = Math.random) {
    const dificultad = DIFICULTADES.includes(sala.config.dificultadBots)
        ? sala.config.dificultadBots : 'NORMAL';

    if (dificultad === 'FACIL') {
        const d = decisionFacil(sala, bot);
        if (azar() < 0.25) return d === 'MANTENER' ? 'CAMBIAR' : 'MANTENER';
        return d;
    }

    const esCampana = sala.config.modoJuego === 'CAMPANA';
    const c = bot.cartaActual;
    const nOtros = sala.jugadores.filter(j => j !== bot && j.vidas > 0).length;
    const dist = distribucionDesconocida(sala, bot, dificultad);

    const pMantener = probPerder(c, dist, nOtros, esCampana);

    // Campana: tocarla si el riesgo de tener la carta más alta es bajo.
    // Quien la toca y pierde paga una vida extra, así que hay que estar seguro.
    if (esCampana && !sala.campanaTocada) {
        const umbral = dificultad === 'DIFICIL' ? 0.15 : 0.10;
        if (pMantener <= umbral) return 'CAMPANA';
    }

    // ¿Qué carta recibiría al cambiar?
    let pCambiar;
    const robaDelMazo = ctx.esDealer || ctx.derechaEsRinger;
    if (robaDelMazo) {
        pCambiar = probPerderSiCambia(dist, nOtros, esCampana);
    } else {
        const conocida = dificultad === 'DIFICIL' || ctx.derecha.cartaRevelada
            ? cartaConocida(sala, bot, ctx.derecha) : null;
        if (!esCampana && conocida === 9) return 'MANTENER'; // el Rey bloquea el cambio
        pCambiar = conocida !== null
            ? probPerder(conocida, dist, nOtros, esCampana)
            : probPerderSiCambia(dist, nOtros, esCampana);
    }

    // NORMAL duda un poco: solo cambia si la mejora es clara, y a veces se equivoca.
    const margen = dificultad === 'DIFICIL' ? 0 : 0.03;
    let decision = pCambiar < pMantener - margen ? 'CAMBIAR' : 'MANTENER';
    if (dificultad === 'NORMAL' && azar() < 0.08) {
        decision = decision === 'CAMBIAR' ? 'MANTENER' : 'CAMBIAR';
    }
    return decision;
}

// Milisegundos que "piensa" el bot: variable, para que no se sienta mecánico.
function retrasoBot(azar = Math.random) {
    return 1200 + Math.floor(azar() * 1300);
}

// Registrar lo que los bots aprenden de un cambio (los cambios se anuncian a
// toda la mesa). Quien cambia sabe qué carta le dio al vecino y el vecino sabe
// qué carta le quitaron; los demás bots mueven lo que sabían: si conocían la
// carta del actor, ahora la tiene el vecino, y al revés.
function recordarCambio(jugadores, actor, vecino, cartaDelActor, cartaDelVecino) {
    for (const j of jugadores) {
        if (!j.esBot) continue;
        const m = (j.memoria ||= {});
        if (j === actor) { delete m[actor.id]; m[vecino.id] = cartaDelActor; continue; }
        if (j === vecino) { delete m[vecino.id]; m[actor.id] = cartaDelVecino; continue; }
        const sabiaActor = m[actor.id], sabiaVecino = m[vecino.id];
        delete m[actor.id]; delete m[vecino.id];
        if (sabiaVecino !== undefined) m[actor.id] = sabiaVecino;
        if (sabiaActor !== undefined) m[vecino.id] = sabiaActor;
    }
}

// Alguien cambió su carta por una del mazo: nadie sabe la nueva.
function olvidarCarta(jugadores, jugador) {
    for (const j of jugadores) if (j.esBot && j.memoria) delete j.memoria[jugador.id];
}

function olvidarRonda(jugadores) {
    jugadores.forEach(j => { if (j.esBot) j.memoria = {}; });
}

module.exports = {
    DIFICULTADES, COMPOSICION,
    probPerder, distribucionDesconocida, decidirBot, retrasoBot,
    recordarCambio, olvidarCarta, olvidarRonda,
};
