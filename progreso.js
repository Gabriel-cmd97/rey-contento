// progreso.js — niveles (experiencia) y recompensa diaria. Reglas puras, sin
// base ni sockets; server.js guarda y avisa. Pruebas: tests/progreso.test.js.
//
// XP por partida: 20 por jugar + 3 por ronda que aguantaste (tope 30) + 40 si
// ganaste. Nivel n pide 100·n XP más que el anterior: nivel 2 a los 100, 3 a
// los 300, 4 a los 600, 5 a los 1000…
// Recompensa diaria: racha de 7 días (se reinicia si faltas un día); el día
// cuenta en hora de CDMX (UTC-6, sin horario de verano desde 2022).

const PREMIOS_DIARIOS = [20, 30, 40, 50, 60, 80, 150]; // día 1…7 (el 7 es el cofre grande)

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

module.exports = { PREMIOS_DIARIOS, xpDePartida, xpParaNivel, nivelDe, hoyCDMX, diaAnterior, estadoPremio };
