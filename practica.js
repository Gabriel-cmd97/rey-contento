// practica.js — guion de la partida de práctica guiada.
//
// Mesa fija: asiento 0 = tú, 1 = bot A (tu vecino de la derecha), 2 = bot B.
// El dealer arranca en B (asiento 2), así en la ronda 1 juegas primero; luego
// rota como siempre: ronda 2 dealer = tú, ronda 3 dealer = A.
//
// Por ronda: `cartas` por asiento, `mazo` = carta que queda arriba del mazo
// (la que roba el dealer si cambia) y `bots` = lo que hace cada bot en su
// turno. El texto que acompaña a cada paso vive en el cliente (main.js,
// sección PRÁCTICA GUIADA); si cambias las cartas aquí, revisa esos textos.

const DEALER_INICIAL = 2;

const RONDAS = {
    // Enseña: pierde la más baja, cambias con tu derecha, las cartas viajan
    // y el dealer roba del mazo.
    1: { cartas: [1, 7, 4], mazo: 5, bots: { 1: 'CAMBIAR', 2: 'CAMBIAR' } },
    // Enseña: eres el dealer; si cambias, robas del mazo (y ahí hay un 7).
    2: { cartas: [2, 8, 6], mazo: 7, bots: { 1: 'MANTENER', 2: 'MANTENER' } },
    // Enseña (modo declarado): A tiene el Rey a la vista; nadie se lo quita
    // y tu turno se salta solo.
    3: { cartas: [6, 9, 2], mazo: 5, bots: { 1: 'MANTENER', 2: 'MANTENER' } },
};

const ULTIMA_RONDA = 3;

// Reparte las cartas del guion para la ronda. Devuelve false si la ronda no
// tiene guion (no debería pasar: la práctica se detiene en ULTIMA_RONDA).
function repartirGuion(sala) {
    const r = RONDAS[sala.rondaActual];
    if (!r) return false;
    sala.jugadores.forEach((j, i) => {
        if (j.vidas > 0 && r.cartas[i] !== undefined) j.cartaActual = r.cartas[i];
    });
    sala.mazo.push(r.mazo); // pop() toma el último: queda arriba del mazo
    return true;
}

function decisionBot(sala, indiceBot) {
    return RONDAS[sala.rondaActual]?.bots[indiceBot] || 'MANTENER';
}

module.exports = { DEALER_INICIAL, RONDAS, ULTIMA_RONDA, repartirGuion, decisionBot };
