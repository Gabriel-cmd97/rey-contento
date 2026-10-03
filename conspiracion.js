// conspiracion.js — Modo "Conspiración en la Corte"
// En este modo, cada jugador recibe al inicio de la partida un Rol Secreto
// de la Corte sellado en cera roja. Cada rol tiene una facción, una misión
// clandestina y una habilidad táctica de un solo uso por partida.

const ROLES = {
    CAMPEON: {
        id: 'CAMPEON',
        titulo: 'Campeón de la Corona',
        faccion: 'LEALES',
        icono: 'escudo',
        color: '#f1c40f',
        lema: 'La Corona jamás caerá',
        descripcion: 'Protege a la Corona y al Rey. Asegúrate de que los leales triunfen sobre la traición.',
        mision: 'Gana la partida o asegura que el líder con más vidas sobreviva.',
        habilidad: {
            id: 'INTERVENCION',
            nombre: 'Intervención Real',
            icono: 'escudo',
            descripcion: 'En tu turno: cambia tu carta con tu vecino ignorando bloqueos del Rey o escudos.'
        }
    },
    ASESINO: {
        id: 'ASESINO',
        titulo: 'Asesino de las Sombras',
        faccion: 'CONSPIRADORES',
        icono: 'espadas',
        color: '#e74c3c',
        lema: 'La sangre pagará la corona',
        descripcion: 'Un puñal en la oscuridad. Tu objetivo es derrocar al soberano y humillar a los poderosos.',
        mision: 'Logra que el jugador con más vidas o el dealer pierda vidas.',
        habilidad: {
            id: 'DAGA_ENVENENADA',
            nombre: 'Daga Envenenada',
            icono: 'espadas',
            descripcion: 'En tu turno: al cambiar tu carta, impregnas la que entregas con veneno (si el receptor pierde la ronda, pierde 1 vida adicional).'
        }
    },
    BUFON: {
        id: 'BUFON',
        titulo: 'Bufón de la Corte',
        faccion: 'CAOS',
        icono: 'mascara',
        color: '#9b59b6',
        lema: 'El mundo arde entre risas',
        descripcion: 'Ni leal ni traidor: siembras la anarquía palaciega buscando la humillación ajena.',
        mision: 'Sobrevive a una ronda conservando un 0 o provoca un empate total.',
        habilidad: {
            id: 'TRUCO_ESPEJO',
            nombre: 'Truco del Espejo',
            icono: 'mascara',
            descripcion: 'En tu turno: invierte el valor de tu carta por el resto de la ronda (un 1 cuenta como un 8, un 0 como un 9).'
        }
    },
    INQUISIDOR: {
        id: 'INQUISIDOR',
        titulo: 'Gran Inquisidor',
        faccion: 'LA LEY',
        icono: 'ojo',
        color: '#3498db',
        lema: 'Ningún secreto escapa a la hoguera',
        descripcion: 'El guardián de los registros prohibidos. Interroga y purga a los conspiradores de la corte.',
        mision: 'Identifica y presencia la caída de un Asesino o Usurpador de la mesa.',
        habilidad: {
            id: 'INTERROGATORIO',
            nombre: 'Juicio del Inquisidor',
            icono: 'ojo',
            descripcion: 'En tu turno: revela en secreto para ti el Rol de la Corte de cualquier jugador de la mesa.'
        }
    },
    USURPADOR: {
        id: 'USURPADOR',
        titulo: 'Duque Usurpador',
        faccion: 'CONSPIRADORES',
        icono: 'corona',
        color: '#e67e22',
        lema: 'El trono pertenece al más astuto',
        descripcion: 'Noble ambicioso que codicia el poder supremo sin importar el costo.',
        mision: 'Llega al duelo final o finaliza una ronda en posesión del Rey (9).',
        habilidad: {
            id: 'GOLPE_ESTADO',
            nombre: 'Golpe de Estado',
            icono: 'corona',
            descripcion: 'En tu turno: roba de inmediato la carta superior del mazo saltándote la carta de tu vecino.'
        }
    }
};

const IDS_ROLES = Object.keys(ROLES);

// Asigna un rol balanceado y secreto a cada jugador al comenzar la partida
function asignarRoles(jugadores, azar = Math.random) {
    const n = jugadores.length;
    let mazoRoles = [];

    if (n <= 3) {
        mazoRoles = ['CAMPEON', 'ASESINO', 'BUFON'];
    } else if (n === 4) {
        mazoRoles = ['CAMPEON', 'ASESINO', 'BUFON', 'INQUISIDOR'];
    } else if (n === 5) {
        mazoRoles = ['CAMPEON', 'ASESINO', 'BUFON', 'INQUISIDOR', 'USURPADOR'];
    } else if (n === 6) {
        mazoRoles = ['CAMPEON', 'CAMPEON', 'ASESINO', 'BUFON', 'INQUISIDOR', 'USURPADOR'];
    } else {
        // 7-8 jugadores: balance de leales, asesinos y caos
        mazoRoles = ['CAMPEON', 'CAMPEON', 'ASESINO', 'ASESINO', 'BUFON', 'INQUISIDOR', 'USURPADOR', 'CAMPEON'].slice(0, n);
    }

    // Barajar roles (Fisher-Yates)
    for (let i = mazoRoles.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [mazoRoles[i], mazoRoles[j]] = [mazoRoles[j], mazoRoles[i]];
    }

    jugadores.forEach((jugador, i) => {
        const rolId = mazoRoles[i % mazoRoles.length];
        jugador.conspiracion = {
            id: rolId,
            rol: ROLES[rolId],
            habilidadUsada: false,
            misionCumplida: false,
            venenoActivo: false,
            espejoActivo: false,
            interrogados: []
        };
    });
}

// Verifica si un jugador puede usar su habilidad de rol
function puedeUsarHabilidad(jugador, sala, accion) {
    if (!jugador.conspiracion || jugador.conspiracion.habilidadUsada || jugador.vidas <= 0) return false;
    const rol = jugador.conspiracion.id;
    const esSuTurno = sala.turnoActualIndex !== undefined && sala.jugadores[sala.turnoActualIndex]?.id === jugador.id;
    if (rol === 'INQUISIDOR' || rol === 'INTERROGATORIO') return esSuTurno;
    if (rol === 'CAMPEON' || rol === 'INTERVENCION') return esSuTurno;
    if (rol === 'ASESINO' || rol === 'DAGA_ENVENENADA') return esSuTurno && accion === 'CAMBIAR';
    if (rol === 'BUFON' || rol === 'TRUCO_ESPEJO') return esSuTurno;
    if (rol === 'USURPADOR' || rol === 'GOLPE_ESTADO') return esSuTurno;
    return false;
}

// Aplica la habilidad de rol
function ejecutarHabilidad(sala, jugador, objetivoId) {
    if (!jugador.conspiracion || jugador.conspiracion.habilidadUsada) return null;
    const rol = jugador.conspiracion.id;
    jugador.conspiracion.habilidadUsada = true;

    if (rol === 'INQUISIDOR') {
        const objetivo = sala.jugadores.find(j => j.id === objetivoId);
        if (!objetivo || !objetivo.conspiracion) return null;
        jugador.conspiracion.interrogados.push(objetivo.id);
        return {
            tipo: 'INQUISICION',
            jugador: jugador.nombre,
            objetivo: objetivo.nombre,
            rolRevelado: objetivo.conspiracion.rol,
            mensajePublico: `⚖️ ¡El Gran Inquisidor ha sometido a juicio a ${objetivo.nombre}!`,
            mensajePrivado: `📜 Archivo del Inquisidor: ${objetivo.nombre} pertenece a la facción ${objetivo.conspiracion.rol.faccion} como "${objetivo.conspiracion.rol.titulo}".`
        };
    }

    if (rol === 'CAMPEON') {
        jugador.conspiracion.fuerzaIntercambio = true;
        return {
            tipo: 'INTERVENCION',
            jugador: jugador.nombre,
            mensajePublico: `🛡️ ¡${jugador.nombre} invoca la Intervención Real! Su cambio ignorará cualquier bloqueo o escudo.`
        };
    }

    if (rol === 'ASESINO') {
        jugador.conspiracion.envenenarCambio = true;
        return {
            tipo: 'VENENO',
            jugador: jugador.nombre,
            mensajePublico: `🗡️ ¡Se percibe el brillo acerado de una hoja en la mesa! Una carta ha sido impregnada con veneno.`
        };
    }

    if (rol === 'BUFON') {
        jugador.conspiracion.espejoActivo = true;
        // Invertir valor relativo en la ronda
        const valorViejo = jugador.cartaActual;
        jugador.cartaEfectiva = 9 - valorViejo;
        return {
            tipo: 'ESPEJO',
            jugador: jugador.nombre,
            mensajePublico: `🎭 ¡${jugador.nombre} realiza el Truco del Espejo! Las apariencias engañan en esta ronda.`
        };
    }

    if (rol === 'USURPADOR') {
        // Roba del mazo directamente
        if (!sala.mazo || sala.mazo.length === 0) return null;
        const cartaRobada = sala.mazo.pop();
        const cartaVieja = jugador.cartaActual;
        jugador.cartaActual = cartaRobada;
        sala.descarte.push(cartaVieja);
        return {
            tipo: 'GOLPE_ESTADO',
            jugador: jugador.nombre,
            cartaRobada,
            mensajePublico: `👑 ¡${jugador.nombre} perpetra un Golpe de Estado y roba directo del mazo real!`
        };
    }

    return null;
}

// Evalúa si algún jugador cumplió misiones de conspiración al final de la ronda
function evaluarRonda(sala) {
    if (!sala.jugadores) return [];
    const eventos = [];
    const vivos = sala.jugadores.filter(j => j.vidas > 0);

    sala.jugadores.forEach(j => {
        if (!j.conspiracion) return;
        const c = j.conspiracion;

        // BUFÓN: si sobrevive con 0 o hubo empate total
        if (c.id === 'BUFON' && !c.misionCumplida && j.vidas > 0) {
            const empateTotal = vivos.length > 1 && vivos.every(v => v.cartaActual === vivos[0].cartaActual);
            if (j.cartaActual === 0 || empateTotal) {
                c.misionCumplida = true;
                c.recompensaBlis = 50;
                eventos.push({
                    jugador: j.nombre,
                    rol: c.rol.titulo,
                    mensaje: `🎭 ¡El Bufón (${j.nombre}) triunfa en el caos! Misión de conspiración cumplida (+50 Blis).`
                });
            }
        }

        // USURPADOR: si tiene el Rey 9
        if (c.id === 'USURPADOR' && !c.misionCumplida && j.vidas > 0 && j.cartaActual === 9) {
            c.misionCumplida = true;
            c.recompensaBlis = 50;
            eventos.push({
                jugador: j.nombre,
                rol: c.rol.titulo,
                mensaje: `👑 ¡El Usurpador (${j.nombre}) sujeta la Corona del Rey! Misión de conspiración cumplida (+50 Blis).`
            });
        }
    });

    return eventos;
}

// Evalúa misiones al final de la partida completa
function evaluarFinPartida(sala, ganador) {
    const revelaciones = [];
    if (!sala.jugadores) return revelaciones;

    sala.jugadores.forEach(j => {
        if (!j.conspiracion) return;
        const c = j.conspiracion;
        const esGanador = ganador && (ganador.id === j.id || (ganador.integrantes && ganador.integrantes.includes(j.nombre)));

        if (c.id === 'CAMPEON' && esGanador) {
            c.misionCumplida = true;
            c.recompensaBlis = (c.recompensaBlis || 0) + 75;
        } else if (c.id === 'ASESINO' && !esGanador && ganador && !ganador.esBot) {
            // Si el Asesino logró que el jugador de más vidas cayera antes del final
            c.misionCumplida = true;
            c.recompensaBlis = (c.recompensaBlis || 0) + 60;
        } else if (c.id === 'INQUISIDOR' && c.interrogados.length > 0) {
            c.misionCumplida = true;
            c.recompensaBlis = (c.recompensaBlis || 0) + 50;
        }

        revelaciones.push({
            id: j.id,
            nombre: j.nombre,
            rol: c.rol,
            misionCumplida: c.misionCumplida,
            recompensaBlis: c.recompensaBlis || 0
        });
    });

    return revelaciones;
}

module.exports = {
    ROLES,
    IDS_ROLES,
    asignarRoles,
    puedeUsarHabilidad,
    ejecutarHabilidad,
    evaluarRonda,
    evaluarFinPartida
};
