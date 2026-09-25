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
// Pierde la carta más baja. Empate total (todos con la misma carta): nadie
// pierde vida.
// Eventos de ronda (sala.evento, ver eventos.js): MUNDO_AL_REVES hace perder
// a la más alta, DOBLE_CASTIGO quita 2 vidas y AMNISTIA no quita ninguna
// pero devuelve en `castigados` a quienes tenían la carta mortal. PREMIO da
// una vida (sin pasar de config.vidas) a la carta más alta: `premiados`.
// `mensajes` va en el orden en que se deben anunciar a la mesa.
function resolverCartas(sala) {
    const vivos = sala.jugadores.filter(j => j.vidas > 0);
    const pierdeLaMasAlta = sala.evento === 'MUNDO_AL_REVES';
    const vidasPorPerder = sala.evento === 'DOBLE_CASTIGO' ? 2 : 1;
    const amnistia = sala.evento === 'AMNISTIA';

    const valorCritico = pierdeLaMasAlta
        ? Math.max(...vivos.map(j => j.cartaActual))
        : Math.min(...vivos.map(j => j.cartaActual));
    const empateTotal = vivos.every(j => j.cartaActual === valorCritico);
    const perdedores = [];
    const castigados = [];
    const culpables = []; // quienes tenían la carta mortal
    const mensajes = [];
    // Parejas (config.equipos): las vidas son del equipo. El daño se anota y
    // se aplica al final: la carta mortal cuenta una sola vez por equipo aunque
    // la tengan dos compañeros, y las penalizaciones extra se suman.
    const enEquipos = !!sala.config.equipos;
    const danioEquipo = {}; // equipo → { carta, extra }
    const pierde = (j, cuantas = 1, esExtra = false) => {
        if (!culpables.includes(j.id)) culpables.push(j.id);
        if (enEquipos) {
            const d = (danioEquipo[j.equipo] ||= { carta: 0, extra: 0 });
            if (esExtra) d.extra += cuantas; else d.carta = Math.max(d.carta, cuantas);
            return;
        }
        j.vidas = Math.max(0, j.vidas - cuantas);
        if (!perdedores.includes(j.id)) perdedores.push(j.id);
    };

    if (!empateTotal && amnistia) {
        sala.jugadores.forEach(j => { if (j.vidas > 0 && j.cartaActual === valorCritico) castigados.push(j.id); });
        mensajes.push(`🕊️ Amnistía: nadie pierde vida, pero quien tenía el ${valorCritico} pierde su próximo turno.`);
    } else if (!empateTotal) {
        sala.jugadores.forEach(j => {
            if (j.vidas > 0 && j.cartaActual === valorCritico) pierde(j, vidasPorPerder);
        });
        if (vidasPorPerder > 1) mensajes.push(`⚔️ Doble castigo: quien tenía el ${valorCritico} pierde ${vidasPorPerder} vidas.`);
    } else {
        mensajes.push(`🤝 ¡Empate total! Todos tienen ${valorCritico} — nadie pierde vida esta ronda.`);
    }

    const premiados = [];
    if (sala.evento === 'PREMIO' && !empateTotal && !enEquipos) {
        const maxVal = Math.max(...vivos.map(j => j.cartaActual));
        const tope = sala.config.vidas || 3;
        vivos.filter(j => j.cartaActual === maxVal && j.vidas > 0).forEach(j => {
            if (j.vidas < tope) { j.vidas += 1; premiados.push(j.id); }
        });
        const nombres = vivos.filter(j => premiados.includes(j.id)).map(j => j.nombre);
        mensajes.push(nombres.length
            ? `👑 Premio real: ${nombres.join(' y ')} ${nombres.length > 1 ? 'ganan' : 'gana'} una vida con su ${maxVal}.`
            : `👑 Premio real: la más alta fue el ${maxVal}, pero ya tenía todas las vidas.`);
    }

    // Parejas: aplicar el daño a todos los integrantes vivos del equipo.
    if (enEquipos) {
        Object.entries(danioEquipo).forEach(([equipo, d]) => {
            const total = d.carta + d.extra;
            if (!total) return;
            vivos.filter(j => String(j.equipo) === equipo).forEach(j => {
                j.vidas = Math.max(0, j.vidas - total);
                perdedores.push(j.id);
            });
        });
    }

    return { vivos, valorCritico, empateTotal, perdedores, culpables, castigados, premiados, mensajes };
}

// Evento Carrusel: cada jugador vivo pasa su carta al siguiente vivo de su
// derecha, todos a la vez. Quien cumple `retiene(j)` (el Rey protegido) no
// entra en la vuelta: conserva su carta y los demás se la saltan.
// Devuelve [{ de, a }] con los jugadores que dieron y recibieron.
function rotarCartas(jugadores, retiene = () => false) {
    const ronda = jugadores.filter(j => j.vidas > 0 && !retiene(j));
    if (ronda.length < 2) return [];
    const cartas = ronda.map(j => j.cartaActual);
    const pases = [];
    ronda.forEach((j, i) => {
        const receptor = ronda[(i + 1) % ronda.length];
        receptor.cartaActual = cartas[i];
        pases.push({ de: j, a: receptor });
    });
    return pases;
}

module.exports = { barajar, crearMazo, siguienteVivo, resolverCartas, rotarCartas };
