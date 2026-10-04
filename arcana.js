// arcana.js — Modo "Guerra Arcana: Hechizos y Grimorios de la Corte"
// En este modo, cada jugador recibe un Grimorio Arcano con pergaminos de hechizo
// de un solo uso para alterar las leyes del juego en tiempo real (invertir turnos,
// crear ilusiones, teletransportar cambios, desterrar cartas o escudarse en sombras).

const HECHIZOS = {
    INVERSION: {
        id: 'INVERSION',
        nombre: 'Inversión de Rumbo',
        runa: '🌀',
        color: '#00d2d3',
        icono: 'reloj',
        descripcion: 'Invierte el sentido de los turnos en la mesa. ¡Ahora los cambios van hacia la izquierda!',
        efecto: 'Inversión inmediata del sentido horario/antihorario de la mesa durante esta ronda.'
    },
    ILUSION: {
        id: 'ILUSION',
        nombre: 'Espejismo Arcano',
        runa: '🔮',
        color: '#a29bfe',
        icono: 'ojo',
        descripcion: 'Encanta tu carta: otorga +2 de poder efectivo en la ronda (máx 9) y disfraza tu carta de Rey ante cualquier espía.',
        efecto: 'Aumenta el valor efectivo en +2 y bloquea deducción rival.'
    },
    VELO_SOMBRAS: {
        id: 'VELO_SOMBRAS',
        nombre: 'Velo de Sombras',
        runa: '🌑',
        color: '#6c5ce7',
        icono: 'escudo',
        descripcion: 'Te envuelve en niebla espectral: nadie puede cambiar contigo y si tienes la carta más baja, el velo absorbe el golpe sin perder vida.',
        efecto: 'Escudo impenetrable y absorción de 1 golpe mortal en la ronda.'
    },
    DESTIERRO: {
        id: 'DESTIERRO',
        nombre: 'Rayo de Destierro',
        runa: '⚡',
        color: '#fdcb6e',
        icono: 'rayo',
        descripcion: 'Lanza un rayo a tu vecino de cambio: destierra su carta al fondo del mazo y le obliga a robar una nueva antes de que decidas.',
        efecto: 'Purga la carta del oponente reemplazándola por una sorpresa del mazo.'
    },
    TRANSMUTACION: {
        id: 'TRANSMUTACION',
        nombre: 'Portal de Transmutación',
        runa: '🧲',
        color: '#e84393',
        icono: 'espadas',
        descripcion: 'Teletransporta tu cambio con CUALQUIER jugador vivo de la mesa a tu elección, ignorando la distancia.',
        efecto: 'Cambio libre a distancia en lugar de limitarse al vecino inmediato.',
        requiereObjetivo: true
    },
    CRONORUPTURA: {
        id: 'CRONORUPTURA',
        nombre: 'Cronorruptura',
        runa: '⏳',
        color: '#fab1a0',
        icono: 'corona',
        descripcion: 'Rompe la barrera temporal: desactiva cualquier escudo o protección del Rey de tu vecino y fuerza el cambio.',
        efecto: 'Ignora escudos e impunidad de Reyes para salvarte.'
    }
};

const IDS_HECHIZOS = Object.keys(HECHIZOS);

// Reparte 2 hechizos balanceados a cada jugador al comenzar la partida
function repartirGrimorios(jugadores, azar = Math.random) {
    jugadores.forEach(jugador => {
        // Seleccionar 2 hechizos diferentes al azar
        const bolsa = [...IDS_HECHIZOS];
        for (let i = bolsa.length - 1; i > 0; i--) {
            const j = Math.floor(azar() * (i + 1));
            [bolsa[i], bolsa[j]] = [bolsa[j], bolsa[i]];
        }
        const grimorio = [bolsa[0], bolsa[1]];

        jugador.arcana = {
            grimorio: grimorio,
            veloActivo: false,
            ilusionActiva: false,
            cronorrupturaActiva: false,
            objetivoTeletransporte: null,
            hechizosLanzados: []
        };
    });
}

// Reabastece un hechizo si el jugador tiene menos de 2 (por ejemplo al perder una vida)
function reabastecerGrimorio(jugador, azar = Math.random) {
    if (!jugador || jugador.vidas <= 0) return null;
    jugador.arcana ||= { grimorio: [], hechizosLanzados: [] };
    if (jugador.arcana.grimorio.length >= 2) return null;

    // Escoger un hechizo que preferentemente no tenga en mano
    const disponibles = IDS_HECHIZOS.filter(h => !jugador.arcana.grimorio.includes(h));
    const candidatos = disponibles.length ? disponibles : IDS_HECHIZOS;
    const nuevoHechizo = candidatos[Math.floor(azar() * candidatos.length)];
    jugador.arcana.grimorio.push(nuevoHechizo);
    return HECHIZOS[nuevoHechizo];
}

// Comprueba si el jugador puede lanzar un hechizo
function puedeLanzarHechizo(sala, jugadorId, hechizoId) {
    if (!sala || sala.estadoActual !== 'TURNOS_INTERCAMBIO') return { ok: false, motivo: 'No es momento de lanzar hechizos.' };
    const jugadorActual = sala.jugadores[sala.turnoActualIndex];
    if (!jugadorActual || jugadorActual.id !== jugadorId) return { ok: false, motivo: 'Solo puedes lanzar hechizos en tu turno.' };
    if (jugadorActual.vidas <= 0) return { ok: false, motivo: 'Estás eliminado.' };

    const arcana = jugadorActual.arcana;
    if (!arcana || !Array.isArray(arcana.grimorio) || !arcana.grimorio.includes(hechizoId)) {
        return { ok: false, motivo: 'No posees ese pergamino en tu grimorio.' };
    }

    return { ok: true, jugador: jugadorActual };
}

// Ejecuta un hechizo en la sala
function ejecutarHechizo(sala, jugadorId, hechizoId, params = {}, helpers = {}) {
    const validacion = puedeLanzarHechizo(sala, jugadorId, hechizoId);
    if (!validacion.ok) return validacion;

    const jugador = validacion.jugador;
    const def = HECHIZOS[hechizoId];
    if (!def) return { ok: false, motivo: 'Hechizo desconocido.' };

    // Consumir el pergamino del grimorio
    const idx = jugador.arcana.grimorio.indexOf(hechizoId);
    if (idx !== -1) jugador.arcana.grimorio.splice(idx, 1);
    jugador.arcana.hechizosLanzados.push(hechizoId);

    sala.sentidoTurnos = sala.sentidoTurnos || 1;
    sala.arcanaEventosRonda ||= [];

    let mensajeGlobal = '';
    let detalle = {};

    switch (hechizoId) {
        case 'INVERSION': {
            sala.sentidoTurnos = sala.sentidoTurnos === 1 ? -1 : 1;
            const dirTexto = sala.sentidoTurnos === -1 ? 'hacia la izquierda' : 'hacia la derecha';
            mensajeGlobal = `🌀 ¡${jugador.nombre} lanzó Inversión de Rumbo! Los turnos ahora fluyen ${dirTexto}.`;
            detalle = { sentido: sala.sentidoTurnos };
            break;
        }

        case 'ILUSION': {
            jugador.arcana.ilusionActiva = true;
            const base = jugador.cartaActual !== undefined ? jugador.cartaActual : 0;
            jugador.cartaEfectiva = Math.min(9, base + 2);
            mensajeGlobal = `🔮 ¡${jugador.nombre} tejió un Espejismo Arcano! Su carta se envuelve en destellos de Rey (+2 efectivo).`;
            detalle = { cartaEfectiva: jugador.cartaEfectiva };
            break;
        }

        case 'VELO_SOMBRAS': {
            jugador.arcana.veloActivo = true;
            sala.escudos ||= [];
            if (!sala.escudos.includes(jugador.nombre)) {
                sala.escudos.push(jugador.nombre);
            }
            mensajeGlobal = `🌑 ¡${jugador.nombre} invoca el Velo de Sombras! Es inmune a cambios y absorbe cualquier golpe mortal.`;
            detalle = { veloActivo: true };
            break;
        }

        case 'DESTIERRO': {
            // El objetivo por defecto es el vecino con quien cambiaría
            const paso = sala.sentidoTurnos === -1 ? -1 : 1;
            let targetIdx = (sala.turnoActualIndex + paso + sala.jugadores.length) % sala.jugadores.length;
            let intentos = 0;
            while (intentos < sala.jugadores.length && sala.jugadores[targetIdx]?.vidas <= 0) {
                targetIdx = (targetIdx + paso + sala.jugadores.length) % sala.jugadores.length;
                intentos++;
            }
            const victima = sala.jugadores[targetIdx];
            if (victima && victima.vidas > 0 && sala.mazo && sala.mazo.length > 0) {
                const cartaVieja = victima.cartaActual;
                victima.cartaActual = sala.mazo.pop();
                if (helpers.enviarCarta) helpers.enviarCarta(sala, victima);
                mensajeGlobal = `⚡ ¡${jugador.nombre} desterró la carta de ${victima.nombre} al mazo! ${victima.nombre} roba una carta misteriosa.`;
                detalle = { victimaId: victima.id, victimaNombre: victima.nombre };
            } else {
                mensajeGlobal = `⚡ ¡${jugador.nombre} lanzó Rayo de Destierro hacia el mazo real!`;
            }
            break;
        }

        case 'TRANSMUTACION': {
            const objetivoId = params.objetivoId;
            const objetivo = sala.jugadores.find(j => j.id === objetivoId && j.vidas > 0 && j.id !== jugador.id);
            if (objetivo) {
                jugador.arcana.objetivoTeletransporte = objetivo.id;
                mensajeGlobal = `🧲 ¡${jugador.nombre} abrió un Portal de Transmutación hacia ${objetivo.nombre}!`;
                detalle = { objetivoId: objetivo.id, objetivoNombre: objetivo.nombre };
            } else {
                mensajeGlobal = `🧲 ¡${jugador.nombre} preparó un Portal de Transmutación para su cambio!`;
            }
            break;
        }

        case 'CRONORUPTURA': {
            jugador.arcana.cronorrupturaActiva = true;
            // Desactiva escudos del vecino inmediato para garantizar el cambio
            const paso = sala.sentidoTurnos === -1 ? -1 : 1;
            let targetIdx = (sala.turnoActualIndex + paso + sala.jugadores.length) % sala.jugadores.length;
            let intentos = 0;
            while (intentos < sala.jugadores.length && sala.jugadores[targetIdx]?.vidas <= 0) {
                targetIdx = (targetIdx + paso + sala.jugadores.length) % sala.jugadores.length;
                intentos++;
            }
            const vecino = sala.jugadores[targetIdx];
            if (vecino && sala.escudos) {
                sala.escudos = sala.escudos.filter(n => n !== vecino.nombre);
            }
            mensajeGlobal = `⏳ ¡${jugador.nombre} activa Cronorruptura! Rompe cualquier bloqueo o escudo de su vecino.`;
            detalle = { cronorrupturaActiva: true };
            break;
        }
    }

    sala.arcanaEventosRonda.push({
        lanzador: jugador.nombre,
        hechizoId,
        mensaje: mensajeGlobal,
        detalle
    });

    return {
        ok: true,
        hechizo: def,
        mensajeGlobal,
        detalle,
        grimorioRestante: jugador.arcana.grimorio
    };
}

// Limpia efectos de ronda y procesa la absorción de daño del Velo de Sombras
function resolverFinRondaArcana(sala, resultadoRonda) {
    if (!sala || sala.config.modoJuego !== 'GUERRA_ARCANA') return [];

    const eventos = [];
    sala.jugadores.forEach(j => {
        if (!j.arcana) return;

        // Velo de Sombras: si estaba en la lista de perdedores, absorbe el daño
        if (j.arcana.veloActivo && resultadoRonda.perdedores.includes(j.id)) {
            // Eliminar de los perdedores y devolver la vida que resolverCartas le restó
            const indexP = resultadoRonda.perdedores.indexOf(j.id);
            if (indexP !== -1) {
                resultadoRonda.perdedores.splice(indexP, 1);
                // Si ya se le restaron vidas en resolverCartas, se le devuelven
                const vidasRestadas = sala.evento === 'DOBLE_CASTIGO' ? 2 : 1;
                j.vidas = Math.min((sala.config.vidas || 3), j.vidas + vidasRestadas);
                const msg = `🌑 ¡El Velo de Sombras de ${j.nombre} absorbió el golpe mortal! No pierde vida.`;
                eventos.push({ tipo: 'VELO_ABSORCION', jugador: j.nombre, mensaje: msg });
            }
        }

        // Limpiar efectos de ronda temporales
        j.arcana.veloActivo = false;
        j.arcana.ilusionActiva = false;
        j.arcana.cronorrupturaActiva = false;
        j.arcana.objetivoTeletransporte = null;
        delete j.cartaEfectiva;
    });

    // Reabastecimiento de hechizos: quienes perdieron vida y sobreviven reciben 1 pergamino
    resultadoRonda.perdedores.forEach(pId => {
        const jPerdio = sala.jugadores.find(j => j.id === pId);
        if (jPerdio && jPerdio.vidas > 0) {
            const nuevo = reabastecerGrimorio(jPerdio);
            if (nuevo) {
                eventos.push({
                    tipo: 'REABASTECIMIENTO',
                    jugador: jPerdio.nombre,
                    jugadorId: jPerdio.id,
                    hechizo: nuevo,
                    mensaje: `✨ El dolor de la derrota nutre el poder arcano de ${jPerdio.nombre}: recibe ${nuevo.runa} ${nuevo.nombre}.`
                });
            }
        }
    });

    // Resetear sentido al inicio de cada ronda
    sala.sentidoTurnos = 1;
    sala.arcanaEventosRonda = [];

    return eventos;
}

module.exports = {
    HECHIZOS,
    IDS_HECHIZOS,
    repartirGrimorios,
    reabastecerGrimorio,
    puedeLanzarHechizo,
    ejecutarHechizo,
    resolverFinRondaArcana
};
