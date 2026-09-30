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
    if (sala.config.modoJuego === 'CORTE') return resolverCorte(sala); // La Corte: solo cuentan los Reyes
    if (sala.config.equipos) return resolverDiez(sala); // Parejas se juega a "Diez"
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

// Parejas = "Diez" (desde el 29/09/2026 reemplaza al Parejas clásico): se
// suman las cartas de cada equipo y la meta es 5 por integrante (10 en 2
// contra 2, 15 en 3 contra 3). Pierde el equipo que se pasa (si se pasan
// varios, el que se pasó más); si nadie se pasa, el que quedó más lejos. Si
// empatan, nadie pierde. Mundo al revés invierte: pierde el que quedó más
// cerca (pasarse sigue perdiendo). Doble castigo quita 2; Amnistía, ninguna
// (los del equipo perdedor pierden su próximo turno, como siempre). La vida es
// del equipo: se le quita a todos sus integrantes vivos.
function resolverDiez(sala) {
    const vivos = sala.jugadores.filter(j => j.vidas > 0);
    const equipos = [...new Set(vivos.map(j => j.equipo))];
    const porEquipo = Object.fromEntries(equipos.map(e => [e, vivos.filter(j => j.equipo === e)]));
    const tamano = Math.max(...equipos.map(e => sala.jugadores.filter(j => j.equipo === e).length));
    const objetivo = 5 * tamano;
    const sumas = Object.fromEntries(equipos.map(e => [e, porEquipo[e].reduce((t, j) => t + j.cartaActual, 0)]));
    // "Qué tan mal": pasarse siempre es peor que no llegar.
    const mundoAlReves = sala.evento === 'MUNDO_AL_REVES';
    const peor = (e) => sumas[e] > objetivo ? 1000 + (sumas[e] - objetivo)
        : mundoAlReves ? sumas[e] : objetivo - sumas[e];
    const maximo = Math.max(...equipos.map(peor));
    const empateTotal = equipos.every(e => peor(e) === maximo);
    const perdedoresEq = empateTotal ? [] : equipos.filter(e => peor(e) === maximo);
    const vidasPorPerder = sala.evento === 'DOBLE_CASTIGO' ? 2 : 1;
    const amnistia = sala.evento === 'AMNISTIA';
    const perdedores = [], castigados = [], culpables = [], mensajes = [];
    const NOMBRES = ['Oro', 'Plata', 'Bronce'];
    const texto = (e) => `${NOMBRES[e] || 'Equipo ' + e} ${sumas[e]}${sumas[e] > objetivo ? ' (se pasó)' : ''}`;
    if (empateTotal) {
        mensajes.push(`🤝 ¡Empate! ${equipos.map(texto).join(' · ')}: nadie pierde vida.`);
    } else {
        perdedoresEq.forEach(e => porEquipo[e].forEach(j => {
            culpables.push(j.id);
            if (amnistia) castigados.push(j.id);
            else { j.vidas = Math.max(0, j.vidas - vidasPorPerder); perdedores.push(j.id); }
        }));
        mensajes.push(`🎯 Meta ${objetivo}: ${equipos.map(texto).join(' · ')}.`);
    }
    return { vivos, valorCritico: null, empateTotal, perdedores, culpables, castigados, premiados: [], mensajes,
             diez: { objetivo, sumas, perdedores: perdedoresEq } };
}

// La Corte (29/09/2026): cada equipo tiene un Rey secreto (sala.reyesCorte =
// { equipo: nombre }). Al final se comparan solo las cartas de los Reyes: el
// de la carta más baja (la más alta con Mundo al revés) le cuesta la vida a su
// equipo; empate, nadie. Las acusaciones falladas o acertadas se cobran aquí
// (sala.castigoCorte = { equipo: vidas extra }). Doble castigo quita 2 y la
// Amnistía perdona (el Rey perdedor pierde su próximo turno).
function resolverCorte(sala) {
    const vivos = sala.jugadores.filter(j => j.vidas > 0);
    const reyes = Object.entries(sala.reyesCorte || {})
        .map(([e, nombre]) => ({ equipo: Number(e), j: vivos.find(x => x.nombre === nombre) }))
        .filter(r => r.j);
    const mundoAlReves = sala.evento === 'MUNDO_AL_REVES';
    const cartas = reyes.map(r => r.j.cartaActual);
    const critico = mundoAlReves ? Math.max(...cartas) : Math.min(...cartas);
    const empateTotal = reyes.length < 2 || reyes.every(r => r.j.cartaActual === critico);
    const perdedoresEq = empateTotal ? [] : reyes.filter(r => r.j.cartaActual === critico).map(r => r.equipo);
    const vidasPorPerder = sala.evento === 'DOBLE_CASTIGO' ? 2 : 1;
    const amnistia = sala.evento === 'AMNISTIA';
    const castigo = sala.castigoCorte || {};
    const perdedores = [], castigados = [], culpables = [], mensajes = [];
    const NOMBRES = ['Oro', 'Plata', 'Bronce'];
    const equipos = [...new Set(vivos.map(j => j.equipo))];
    equipos.forEach(e => {
        const porRonda = perdedoresEq.includes(e) ? (amnistia ? 0 : vidasPorPerder) : 0;
        const total = porRonda + (castigo[e] || 0);
        if (perdedoresEq.includes(e)) culpables.push(reyes.find(r => r.equipo === e).j.id);
        if (perdedoresEq.includes(e) && amnistia) castigados.push(reyes.find(r => r.equipo === e).j.id);
        if (!total) return;
        vivos.filter(j => j.equipo === e).forEach(j => { j.vidas = Math.max(0, j.vidas - total); perdedores.push(j.id); });
    });
    sala.castigoCorte = {};
    // Sin nombres ni cartas de los Reyes: el secreto se mantiene (se deduce, si acaso).
    mensajes.push(empateTotal ? '🤝 Los Reyes empataron: nadie pierde por cartas.'
        : `👑 El Rey de ${perdedoresEq.map(e => NOMBRES[e]).join(' y ')} tenía la carta ${mundoAlReves ? 'más alta' : 'más baja'}: ${perdedoresEq.map(e => NOMBRES[e]).join(' y ')} ${vidasPorPerder > 1 && !amnistia ? 'pierde 2 vidas' : amnistia ? 'se salva por la Amnistía' : 'pierde una vida'}.`);
    Object.entries(castigo).forEach(([e, n]) => { if (n) mensajes.push(`⚔️ ${NOMBRES[e]} pierde ${n} ${n === 1 ? 'vida' : 'vidas'} por la acusación.`); });
    // `culpables` vacío hacia afuera: nombrarlos delataría al Rey.
    return { vivos, valorCritico: null, empateTotal, perdedores, culpables: [], reyesCulpables: culpables, castigados, premiados: [], mensajes,
             corte: { perdedores: perdedoresEq, castigo } };
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

module.exports = { barajar, crearMazo, siguienteVivo, resolverCartas, resolverDiez, resolverCorte, rotarCartas };
