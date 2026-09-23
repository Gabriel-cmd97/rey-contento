// reglas.js — reglas puras de Rey Contento: la baraja, el orden de la mesa
// y quién pierde vida al final de la ronda. Nada aquí habla con sockets ni
// con la base; server.js decide qué enviar a los jugadores. Pruebas en
// tests/reglas.test.js.

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

// Índice del siguiente jugador vivo a la derecha de `indice` (el turno avanza
// hacia la derecha). Si nadie más está vivo, da la vuelta completa y devuelve
// el último índice revisado, igual que los bucles que reemplaza: quien llama
// debe comprobar `vidas > 0` si le importa ese caso.
function siguienteVivo(jugadores, indice) {
    let i = indice;
    let intentos = 0;
    do {
        i = (i + 1) % jugadores.length;
        intentos++;
    } while (intentos < jugadores.length && jugadores[i] && jugadores[i].vidas <= 0);
    return i;
}

// Aplica el final de la ronda: resta las vidas y devuelve qué pasó.
// Clásico: pierde la carta más baja. Campana: pierde la más alta, y además
//  - si nadie tocó la campana en 2 vueltas, la carta más alta paga una extra;
//  - si alguien la tocó y tenía la carta mortal, paga una extra.
// Empate total (todos con la misma carta): nadie pierde vida, tampoco por
// la penalización de la campana.
// `mensajes` va en el orden en que se deben anunciar a la mesa.
function resolverCartas(sala) {
    const vivos = sala.jugadores.filter(j => j.vidas > 0);
    const esModoCampana = sala.config.modoJuego === 'CAMPANA';

    const valorCritico = esModoCampana
        ? Math.max(...vivos.map(j => j.cartaActual))
        : Math.min(...vivos.map(j => j.cartaActual));
    const empateTotal = vivos.every(j => j.cartaActual === valorCritico);
    const perdedores = [];
    const mensajes = [];
    const pierde = (j) => {
        j.vidas -= 1;
        if (!perdedores.includes(j.id)) perdedores.push(j.id);
    };

    // Nadie tocó la campana en 2 vueltas: el "cobarde" con la carta más alta
    // paga una vida extra (además de la normal, si le quedan vidas).
    if (esModoCampana && !sala.campanaTocada && sala.vueltasCampana >= 2 && !empateTotal) {
        const maxVal = Math.max(...vivos.map(j => j.cartaActual));
        vivos.filter(j => j.cartaActual === maxVal).forEach(pierde);
        mensajes.push(`⏰ Nadie tocó la campana — el cobarde con la carta más alta paga doble.`);
    }

    let campanaInfo = null;
    if (sala.campanaTocada && sala.campanaTocadorId) {
        const ringer = sala.jugadores.find(j => j.id === sala.campanaTocadorId);
        if (ringer && ringer.vidas > 0) {
            const ringerPierde = !empateTotal && ringer.cartaActual === valorCritico;
            campanaInfo = { tocadorId: ringer.id, acertada: !ringerPierde };
            if (ringerPierde) {
                pierde(ringer);
                mensajes.push(`🔔❌ ${ringer.nombre} tocó la campana pero tenía la carta mortal! -1 vida extra.`);
            } else {
                mensajes.push(`🔔✅ ¡${ringer.nombre} acertó la campana!`);
            }
        }
    }

    if (!empateTotal) {
        sala.jugadores.forEach(j => {
            if (j.vidas > 0 && j.cartaActual === valorCritico) pierde(j);
        });
    } else {
        mensajes.push(`🤝 ¡Empate total! Todos tienen ${valorCritico} — nadie pierde vida esta ronda.`);
    }

    return { vivos, valorCritico, empateTotal, perdedores, campanaInfo, mensajes };
}

module.exports = { barajar, crearMazo, siguienteVivo, resolverCartas };
