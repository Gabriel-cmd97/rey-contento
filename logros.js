// logros.js — catálogo de logros. Es la única fuente: el servidor lo manda al
// cliente en /mis-stats (catalogo) y en el aviso 'logroDesbloqueado', así que
// para agregar uno basta con sumarlo aquí y otorgarlo en server.js.
// `icono` es un símbolo del sprite de index.html (i-<icono>).
// `retirado`: ya no se puede ganar; solo se muestra a quien ya lo tiene.

const CATALOGO = [
    { id: 'aprendiz',       titulo: 'Aprendiz',       descripcion: 'Completa la partida de práctica.',         icono: 'libro' },
    { id: 'primera_corona', titulo: 'Primera corona', descripcion: 'Gana tu primera partida.',                 icono: 'corona' },
    { id: 'por_un_pelo',    titulo: 'Por un pelo',    descripcion: 'Gana una partida con una sola vida.',      icono: 'corazon' },
    { id: 'intocable',      titulo: 'Intocable',      descripcion: 'Gana una partida sin perder ninguna vida.', icono: 'escudo' },
    { id: 'oido_fino',      titulo: 'Oído fino',      descripcion: 'Toca la campana y acierta.',               icono: 'campana', retirado: true },
    { id: 'muro_del_rey',   titulo: 'Muro del Rey',   descripcion: 'Ten al Rey y frena un cambio.',            icono: 'mano' },
    { id: 'racha_real',     titulo: 'Racha real',     descripcion: 'Gana 3 partidas seguidas.',                icono: 'rayo' },
    { id: 'rey_de_reyes',   titulo: 'Rey de reyes',   descripcion: 'Gana 10 partidas.',                        icono: 'trofeo' },
    { id: 'veterano',       titulo: 'Veterano',       descripcion: 'Juega 25 partidas.',                       icono: 'espadas' },
];

const POR_ID = Object.fromEntries(CATALOGO.map(l => [l.id, l]));

// Logros que se deciden al terminar una partida, a partir de las cifras ya
// actualizadas en la base (`stats`: victorias, partidas_jugadas, racha_actual).
// `gano`, `vidasFinales` y `vidasPerdidas` son de esta partida.
function logrosDeFinDePartida({ gano, vidasFinales, vidasPerdidas, stats }) {
    const ids = [];
    if (gano) {
        ids.push('primera_corona');
        if (vidasFinales === 1) ids.push('por_un_pelo');
        if (vidasPerdidas === 0) ids.push('intocable');
        if (stats && stats.racha_actual >= 3) ids.push('racha_real');
        if (stats && stats.victorias >= 10) ids.push('rey_de_reyes');
    }
    if (stats && stats.partidas_jugadas >= 25) ids.push('veterano');
    return ids;
}

// Lugar de cada jugador a partir del orden de caída: el ganador es 1.º y
// quienes cayeron en la misma ronda comparten lugar. `caidas` va en el orden
// en que cayeron: [{ nombre, ronda }].
function lugaresFinales(ganadorNombre, caidas, totalJugadores) {
    const lugares = {};
    if (ganadorNombre) lugares[ganadorNombre] = 1;
    let siguiente = ganadorNombre ? 2 : 1;
    const inversas = [...caidas].reverse();
    inversas.forEach((c, i) => {
        // Empate solo si cayeron en la misma ronda Y perdieron su primera vida en la misma ronda.
        const mismaRonda = i > 0 && inversas[i - 1].ronda === c.ronda && inversas[i - 1].primera === c.primera;
        lugares[c.nombre] = mismaRonda ? lugares[inversas[i - 1].nombre] : siguiente;
        siguiente++;
    });
    return (nombre) => lugares[nombre] || totalJugadores;
}

module.exports = { CATALOGO, POR_ID, logrosDeFinDePartida, lugaresFinales };
