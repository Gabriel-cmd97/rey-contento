// torneo.js — reglas puras del Torneo de la noche (sin sockets ni base).
// server.js (sección TORNEO DE LA NOCHE) lleva el estado y las mesas.
// Pruebas: tests/torneo.test.js.
//
// Todos los días a la HORA (CDMX) arranca; las inscripciones abren
// MIN_INSCRIPCION minutos antes. Los inscritos se reparten en mesas de hasta
// MAX_MESA; los humanos que ganan su mesa van a la final. El campeón es "Rey de
// la noche" por 24 h.

const HORA = 21;             // 9:00 pm
const MIN_INSCRIPCION = 10;  // abren a las 8:50 pm
const MAX_MESA = 6;
const MIN_JUGADORES = 2;     // con menos se cancela
const PREMIO_CAMPEON = 100;  // XP
const MS_REY_NOCHE = 24 * 3600 * 1000;

// Minutos desde medianoche en CDMX (UTC-6).
function minutosCDMX(ahora = new Date()) {
    const d = new Date(ahora.getTime() - 6 * 3600 * 1000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// 'antes' | 'inscripcion' | 'hora' (ya toca arrancar) para la hora dada.
function momento(minutos, hora = HORA) {
    const inicio = hora * 60;
    if (minutos >= inicio - MIN_INSCRIPCION && minutos < inicio) return 'inscripcion';
    if (minutos >= inicio && minutos < inicio + 60) return 'hora';
    return 'antes';
}

// Reparte nombres en el menor número de mesas de hasta MAX_MESA, parejas en
// tamaño (7 → 4 y 3, no 6 y 1). `azar` para barajar.
function repartirMesas(nombres, azar = Math.random) {
    const lista = [...nombres];
    for (let i = lista.length - 1; i > 0; i--) {
        const k = Math.floor(azar() * (i + 1));
        [lista[i], lista[k]] = [lista[k], lista[i]];
    }
    const nMesas = Math.max(1, Math.ceil(lista.length / MAX_MESA));
    const mesas = Array.from({ length: nMesas }, () => []);
    lista.forEach((n, i) => mesas[i % nMesas].push(n));
    return mesas;
}

// Tras terminar todas las mesas de la primera fase: { campeon } si ya hay (o
// null si nadie), o { final: [nombres] } si hay que jugar la final.
function siguienteFase(ganadoresDeMesa) {
    const humanos = ganadoresDeMesa.filter(Boolean);
    if (humanos.length === 0) return { campeon: null };
    if (humanos.length === 1) return { campeon: humanos[0] };
    return { final: humanos };
}

module.exports = { HORA, MIN_INSCRIPCION, MAX_MESA, MIN_JUGADORES, PREMIO_CAMPEON, MS_REY_NOCHE,
    minutosCDMX, momento, repartirMesas, siguienteFase };
