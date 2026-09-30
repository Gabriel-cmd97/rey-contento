// progreso.js — niveles (experiencia) y recompensa diaria. Reglas puras, sin
// base ni sockets; server.js guarda y avisa. Pruebas: tests/progreso.test.js.
//
// XP por partida: 20 por jugar + 3 por ronda que aguantaste (tope 30) + 40 si
// ganaste. Nivel n pide 100·n XP más que el anterior: nivel 2 a los 100, 3 a
// los 300, 4 a los 600, 5 a los 1000…
// Recompensa diaria: racha de 7 días (se reinicia si faltas un día); el día
// cuenta en hora de CDMX (UTC-6, sin horario de verano desde 2022).

const PREMIOS_DIARIOS = [20, 30, 40, 50, 60, 80, 150]; // día 1…7 (el 7 es el cofre grande)

// Monedas del reino (Blis, Letios y Gaudios). 30/09/2026.
const BLIS = {
    jugar: 10, ganar: 30, porBonus: 5,     // por partida (+5 por cada bonus: apuesta, derrocar, corona)
    subirNivel: 50, campeonTorneo: 150,
    diario: [10, 15, 20, 25, 30, 40, 100], // día 1…7 del cofre
};
const LETIOS = {
    campeonTorneo: 10,                      // Campeón absoluto del Torneo de la noche
    rachaSieteDias: 5,                      // Cofre supremo del día 7
};
const GAUDIOS = {
    costoBlis: 100,                         // Costo de abrir un Arcón de Gaudios con Blis
    costoGaudios: 1,                        // Costo de abrir un Arcón con divisa Gaudio
    rachaSieteDias: 1,                      // Gaudio obtenido al completar racha de 7 días
};
const DOBLONES = BLIS;                      // Alias retrocompatible
function blisDePartida({ gano, bonus = 0 }) {
    return BLIS.jugar + (gano ? BLIS.ganar : 0) + BLIS.porBonus * bonus;
}
const doblonesDePartida = blisDePartida;

function xpDePartida({ gano, rondasAguantadas }) {
    const porRondas = Math.min(30, 3 * Math.max(0, rondasAguantadas || 0));
    return 20 + porRondas + (gano ? 40 : 0);
}

// XP total que se necesita para llegar al nivel n (nivel 1 = 0).
function xpParaNivel(n) {
    return 50 * (n - 1) * n;
}

// { nivel, xpEnNivel, xpDelNivel } a partir del XP total.
function nivelDe(xp) {
    let n = 1;
    while (xpParaNivel(n + 1) <= xp) n++;
    return { nivel: n, xpEnNivel: xp - xpParaNivel(n), xpDelNivel: xpParaNivel(n + 1) - xpParaNivel(n) };
}

// Fecha 'AAAA-MM-DD' en CDMX.
function hoyCDMX(ahora = new Date()) {
    return new Date(ahora.getTime() - 6 * 3600 * 1000).toISOString().slice(0, 10);
}
function diaAnterior(fecha) {
    const d = new Date(fecha + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// Estado del premio de hoy: { disponible, racha (la que tendrías al cobrar), premio }.
// `ultimoDia` = último día que cobró ('AAAA-MM-DD' o null), `racha` = su racha guardada.
function estadoPremio(ultimoDia, racha, hoy = hoyCDMX()) {
    if (ultimoDia === hoy) return { disponible: false, racha: racha || 1, premio: 0 };
    const sigue = ultimoDia && ultimoDia === diaAnterior(hoy);
    const nueva = sigue ? ((racha || 0) % 7) + 1 : 1;
    return { disponible: true, racha: nueva, premio: PREMIOS_DIARIOS[nueva - 1] };
}

// Lo que se abre al subir de nivel (30/09/2026): quien empieza ve solo el
// Clásico; los modos extra llegan como premio. El cliente lo aplica en el lobby
// (aplicarDesbloqueos) y el servidor lo anuncia al subir (sumarXp).
const DESBLOQUEOS = [
    { nivel: 2, id: 'fiesta',  titulo: 'Modo Fiesta' },
    { nivel: 2, id: 'torneo',  titulo: 'Torneo de la noche' },
    { nivel: 3, id: 'poderes', titulo: 'Poderes' },
    { nivel: 4, id: 'parejas', titulo: 'Parejas (Diez)' },
    { nivel: 5, id: 'corte',   titulo: 'La Corte' },
];
function desbloqueosEntre(antes, ahora) { return DESBLOQUEOS.filter(d => d.nivel > antes && d.nivel <= ahora); }

module.exports = { DESBLOQUEOS, desbloqueosEntre, PREMIOS_DIARIOS, BLIS, LETIOS, GAUDIOS, blisDePartida, DOBLONES, doblonesDePartida, xpDePartida, xpParaNivel, nivelDe, hoyCDMX, diaAnterior, estadoPremio };
