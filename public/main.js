// ==========================================
// DETECCIÓN DE SALA POR URL
// ==========================================
const salaEnUrl = new URLSearchParams(window.location.search).get('sala');
if (salaEnUrl) {
    sessionStorage.setItem('salaPendienteUrl', salaEnUrl.toUpperCase());
}

// ==========================================
// VARIABLES GLOBALES
// ==========================================
const URL_SERVIDOR = window.location.origin;

let miToken = "", miNombreUsuario = "", miSalaActual = "", soyElHost = false;
let socket, intervaloVisual;
let listaJugadoresGlobal = [];
let turnoActualId = "";
let mostrandoRevelacion = false;
let perdedoresActuales = [];
let cartasRepartidas = false;
let modoEspectador = false;
let _cartaPendiente = null;

// Generación de render: cada socket event que cambia el estado visual del
// turno/ronda bumpea este contador. Los setTimeout encadenados (vuelo de carta
// 600ms, delay inicial 200ms) capturan su generación al iniciarse y la
// verifican antes de mutar el DOM — si otra cosa pasó, abortan sin pisar.
let _renderGen = 0;
let modoReyActual = "SORPRESA";
let cartasDescartadas = [];
let pilaRenderizadaCount = 0;
let campanaRingerId = null;
let _tweenCarta = null; // POC TWEEN.js: tween de vuelo de carta en curso (para cancelarlo)

// ==========================================
// MOTOR DE AUDIO Y HÁPTICA (Game Feel)
// ==========================================
function vibrar(patron) {
    if ('vibrate' in navigator) {
        try { navigator.vibrate(patron); } catch (e) {}
    }
}

const Sonidos = (function() {
    let ctx = null;
    let habilitado = localStorage.getItem('reySonido') !== 'false';

    function getCtx() {
        if (!ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) ctx = new AudioCtx();
        }
        if (ctx && ctx.state === 'suspended') {
            ctx.resume();
        }
        return ctx;
    }

    const desbloquearAudio = () => {
        getCtx();
        window.removeEventListener('pointerdown', desbloquearAudio);
        window.removeEventListener('keydown', desbloquearAudio);
    };
    window.addEventListener('pointerdown', desbloquearAudio, { passive: true });
    window.addEventListener('keydown', desbloquearAudio, { passive: true });

    function tono(freq, duracion, tipo = 'sine', gainVal = 0.15, decay = true) {
        if (!habilitado) return;
        const c = getCtx();
        if (!c) return;
        try {
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = tipo;
            osc.frequency.setValueAtTime(freq, c.currentTime);
            gain.gain.setValueAtTime(gainVal, c.currentTime);
            if (decay) {
                gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duracion);
            }
            osc.connect(gain);
            gain.connect(c.destination);
            osc.start();
            osc.stop(c.currentTime + duracion);
        } catch (e) {}
    }

    return {
        estaHabilitado: () => habilitado,
        toggle: () => {
            habilitado = !habilitado;
            localStorage.setItem('reySonido', habilitado ? 'true' : 'false');
            return habilitado;
        },
        turno: () => {
            if (!habilitado) return;
            const notas = [523.25, 659.25, 783.99]; // Acorde C5 - E5 - G5
            notas.forEach((n, i) => {
                setTimeout(() => tono(n, 0.3, 'sine', 0.14), i * 80);
            });
        },
        carta: () => {
            if (!habilitado) return;
            const c = getCtx();
            if (!c) return;
            try {
                const bufferSize = Math.floor(c.sampleRate * 0.08);
                const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
                }
                const noise = c.createBufferSource();
                noise.buffer = buffer;
                const filter = c.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1500, c.currentTime);
                filter.Q.setValueAtTime(2, c.currentTime);
                const gain = c.createGain();
                gain.gain.setValueAtTime(0.18, c.currentTime);
                noise.connect(filter);
                filter.connect(gain);
                gain.connect(c.destination);
                noise.start();
            } catch (e) {
                tono(440, 0.07, 'triangle', 0.08);
            }
        },
        campana: () => {
            if (!habilitado) return;
            const parciales = [587.33, 1174.66, 1762, 2349];
            const ganancias = [0.24, 0.14, 0.07, 0.03];
            parciales.forEach((f, i) => {
                tono(f, 1.8, 'sine', ganancias[i]);
            });
        },
        danio: () => {
            if (!habilitado) return;
            const c = getCtx();
            if (!c) return;
            try {
                const osc = c.createOscillator();
                const gain = c.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(150, c.currentTime);
                osc.frequency.exponentialRampToValueAtTime(35, c.currentTime + 0.28);
                gain.gain.setValueAtTime(0.3, c.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.28);
                osc.connect(gain);
                gain.connect(c.destination);
                osc.start();
                osc.stop(c.currentTime + 0.28);
            } catch (e) {}
        },
        tick: () => {
            if (!habilitado) return;
            tono(950, 0.035, 'square', 0.05);
        },
        victoria: () => {
            if (!habilitado) return;
            const arpegio = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
            arpegio.forEach((f, i) => {
                setTimeout(() => tono(f, 0.45, 'triangle', 0.16), i * 110);
            });
        },
        pop: () => {
            if (!habilitado) return;
            tono(680, 0.05, 'sine', 0.1);
        },
        boton: () => {
            if (!habilitado) return;
            tono(400, 0.035, 'sine', 0.06);
        }
    };
})();

const nombresCartas = {
    0: "El Mendigo", 1: "La Rata", 2: "El Campesino", 3: "El Trovador",
    4: "El Guardia", 5: "El Verdugo", 6: "La Duquesa", 7: "El Mago",
    8: "El General", 9: "El Rey Contento"
};

// Figura de cada carta: SVG medieval (set game-icons, CC-BY 3.0). Se descargaron
// a /iconos para no depender de un CDN externo en runtime y verse igual en todo
// dispositivo (a diferencia de los emojis, que cada SO dibuja distinto).
const figurasCartas = {
    0: "/iconos/0.svg", 1: "/iconos/1.svg", 2: "/iconos/2.svg", 3: "/iconos/3.svg",
    4: "/iconos/4.svg", 5: "/iconos/5.svg", 6: "/iconos/6.svg", 7: "/iconos/7.svg",
    8: "/iconos/8.svg", 9: "/iconos/9.svg"
};
// <img> de la figura de una carta al tamaño dado (px). '' si no hay.
function figuraIMG(n, px) {
    const src = figurasCartas[n];
    return src ? `<img src="${src}" alt="" width="${px}" height="${px}" draggable="false" style="vertical-align:middle;">` : '';
}

// Pinta el frente de la carta principal (#miCarta): número, figura + nombre, y la
// clase de color (carta-0 / carta-9). Centraliza lo que antes se repetía en cada
// evento de revelado (juegoIniciado, cambioDeTurno, rondaTerminada, reconexión).
function pintarCartaPrincipal(carta) {
    document.getElementById('numeroCarta').innerText = carta;
    document.getElementById('figuraCarta').innerHTML = figuraIMG(carta, 34);
    document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
    document.getElementById('cartaFrente').className = "face front-character " +
        (carta === 0 ? "carta-0" : carta === 9 ? "carta-9" : "");
}

// ==========================================
// TOASTS
// ==========================================
// Escapa caracteres HTML en un string para interpolarlo seguro en innerHTML.
// Hoy los usernames nuevos están validados con regex restrictiva, pero pueden
// existir cuentas viejas (pre-validación) con caracteres peligrosos, y los
// mensajes del server concatenan nombres ⇒ defensa en profundidad.
function escapeHTML(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function mostrarToast(mensaje, tipo = '', duracion = 2500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-mensaje' + (tipo ? ' toast-' + tipo : '');
    // textContent en lugar de innerHTML: los toasts solo muestran texto plano
    // (con emojis, que son chars unicode no HTML). Bloquea XSS si un mensaje
    // del server incluye un username con HTML inyectado.
    toast.textContent = mensaje;
    container.appendChild(toast);
    while (container.children.length > 2) container.removeChild(container.firstChild);
    setTimeout(() => {
        toast.style.animation = 'toastSalir 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, duracion);
}

// ==========================================
// MINI-FEED Y BITÁCORA DE JUGADAS
// ==========================================
let historialJugadasRonda = [];

function registrarJugadaFeed(evento) {
    if (!evento) return;
    const ahora = new Date();
    const horaFormateada = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const item = {
        tipo: evento.tipo || 'INFO',
        icono: evento.icono || '📜',
        jugador: evento.jugador || '',
        objetivo: evento.objetivo || '',
        texto: evento.texto || '',
        hora: horaFormateada
    };

    historialJugadasRonda.push(item);
    renderizarMiniFeedHUD();
    renderizarModalBitacora();
}

function renderizarMiniFeedHUD() {
    const contenedor = document.getElementById('miniFeedJugadas');
    const lista = document.getElementById('miniFeedItems');
    const contador = document.getElementById('miniFeedContador');
    if (!contenedor || !lista) return;

    if (historialJugadasRonda.length === 0) {
        lista.innerHTML = `
            <div class="mini-feed-item feed-reciente">
                <span class="feed-icono">⚔️</span>
                <span class="feed-texto">Esperando primera jugada...</span>
            </div>
        `;
        if (contador) contador.textContent = '';
        return;
    }

    const ultimos = historialJugadasRonda.slice(-3).reverse();
    const clases = ['feed-reciente', 'feed-anterior', 'feed-antiguo'];

    let html = '';
    ultimos.forEach((ev, idx) => {
        const claseOpacidad = clases[idx] || 'feed-antiguo';
        let textoHtml = '';

        if (ev.tipo === 'CAMBIO' && ev.jugador && ev.objetivo) {
            textoHtml = `<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> cambió con <strong class="feed-nombre">${escapeHTML(ev.objetivo)}</strong>`;
        } else if (ev.tipo === 'MANTENER' && ev.jugador) {
            textoHtml = `<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> se plantó`;
        } else if (ev.tipo === 'BLOQUEO' && ev.jugador) {
            textoHtml = `¡Rey frenó a <strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong>!`;
        } else if (ev.tipo === 'CAMPANA' && ev.jugador) {
            textoHtml = `¡<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> tocó campana!`;
        } else if (ev.tipo === 'MAZO' && ev.jugador) {
            textoHtml = `<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> cambió con mazo`;
        } else if (ev.tipo === 'TIMEOUT' && ev.jugador) {
            textoHtml = `<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> agotó tiempo`;
        } else {
            textoHtml = escapeHTML(ev.texto);
        }

        html += `
            <div class="mini-feed-item ${claseOpacidad}">
                <span class="feed-icono">${escapeHTML(ev.icono)}</span>
                <span class="feed-texto">${textoHtml}</span>
            </div>
        `;
    });

    lista.innerHTML = html;
    if (contador) contador.textContent = `(${historialJugadasRonda.length})`;
}

function renderizarModalBitacora() {
    const listaCompleta = document.getElementById('listaBitacoraCompleta');
    if (!listaCompleta) return;

    if (historialJugadasRonda.length === 0) {
        listaCompleta.innerHTML = '<div class="bitacora-vacia" style="text-align:center; color:var(--texto-suave); font-size:12px; padding:15px;">Aún no hay jugadas registradas en esta ronda.</div>';
        return;
    }

    const items = [...historialJugadasRonda].reverse();
    let html = '';
    items.forEach(ev => {
        let textoHtml = '';
        if (ev.tipo === 'CAMBIO' && ev.jugador && ev.objetivo) {
            textoHtml = `<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> intercambió carta con <strong class="feed-nombre">${escapeHTML(ev.objetivo)}</strong>`;
        } else if (ev.tipo === 'MANTENER' && ev.jugador) {
            textoHtml = `<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> decidió mantener (se plantó)`;
        } else if (ev.tipo === 'BLOQUEO' && ev.jugador) {
            textoHtml = `🛡️ ¡Rey ${ev.objetivo ? 'de ' + escapeHTML(ev.objetivo) + ' ' : ''}bloqueó a <strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong>!`;
        } else if (ev.tipo === 'CAMPANA' && ev.jugador) {
            textoHtml = `🔔 ¡<strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> tocó la campana! Última vuelta`;
        } else if (ev.tipo === 'MAZO' && ev.jugador) {
            textoHtml = `🃏 <strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> cambió carta con el mazo`;
        } else if (ev.tipo === 'TIMEOUT' && ev.jugador) {
            textoHtml = `⏰ Tiempo agotado para <strong class="feed-nombre">${escapeHTML(ev.jugador)}</strong> (mantiene auto)`;
        } else {
            textoHtml = escapeHTML(ev.texto);
        }

        html += `
            <div class="bitacora-fila">
                <span class="bitacora-fila-icono">${escapeHTML(ev.icono)}</span>
                <span style="flex:1;">${textoHtml}</span>
                <span class="bitacora-fila-hora">${escapeHTML(ev.hora)}</span>
            </div>
        `;
    });

    listaCompleta.innerHTML = html;
}

function abrirModalBitacora() {
    const modal = document.getElementById('modalBitacora');
    const badge = document.getElementById('bitacoraRondaBadge');
    if (badge) {
        const numRonda = document.getElementById('numRonda')?.innerText || '1';
        badge.innerText = `Ronda ${numRonda}`;
    }
    renderizarModalBitacora();
    if (modal) modal.classList.remove('hidden');
}

function cerrarModalBitacora() {
    const modal = document.getElementById('modalBitacora');
    if (modal) modal.classList.add('hidden');
}

function reiniciarHistorialRonda(numRonda = 1) {
    historialJugadasRonda = [];
    const feed = document.getElementById('miniFeedJugadas');
    if (feed) feed.classList.remove('hidden');
    registrarJugadaFeed({
        tipo: 'RONDA',
        icono: '⚔️',
        texto: `¡Comienza la Ronda ${numRonda}!`
    });
}

// ==========================================
// PILA DE DESCARTE
// ==========================================
const _rotsPila = [2, -8, 5, -3, 7, -6, 4, -9, 1, -5];

function renderizarPila() {
    const pila     = document.getElementById('pilaCentro');
    const stack    = document.getElementById('cartasPila');
    const contador = document.getElementById('contadorPila');
    if (!pila || !stack) return;

    const total = cartasDescartadas.length;
    if (total === 0) {
        pila.classList.add('hidden');
        pilaRenderizadaCount = 0;
        return;
    }
    pila.classList.remove('hidden');

    const MAX_VIS = 6;
    const recientes = cartasDescartadas.slice(-MAX_VIS);
    const offsetBase = total - recientes.length; // índice global del primer visible

    stack.innerHTML = '';
    recientes.forEach((carta, i) => {
        const idxGlobal = offsetBase + i;
        const esNuevo   = idxGlobal >= pilaRenderizadaCount;
        const rot       = _rotsPila[i % _rotsPila.length];
        const extra     = carta === 9 ? 'rey-pila' : carta === 0 ? 'cero-pila' : '';
        const el = document.createElement('div');
        el.className = `carta-en-pila ${extra}`;
        el.style.cssText = `--rot:${rot}deg; transform:rotate(${rot}deg); z-index:${i}; top:${i * 0.7}px; left:${i * 0.4}px;`;
        if (esNuevo) el.style.animation = 'cartaLlegaPila 0.4s ease forwards';
        // Número + figura oscura (/iconos/N.svg) sobre el fondo pergamino de la pila.
        el.innerHTML = `<span class="pila-num">${carta}</span><img src="/iconos/${carta}.svg" alt="" draggable="false" class="pila-fig">`;
        stack.appendChild(el);
    });

    if (contador) contador.textContent = `${total} jugadas`;
    pilaRenderizadaCount = total;
}

function agregarCartasAPila(jugadores) {
    jugadores.forEach(j => {
        if (j.cartaActual !== undefined && j.cartaActual !== null) {
            cartasDescartadas.push(j.cartaActual);
        }
    });
    renderizarPila();
}

function limpiarPila() {
    cartasDescartadas = [];
    pilaRenderizadaCount = 0;
    renderizarPila();
}

function lanzarCoronasVictoria() {
    const simbolos = ['👑','⚔️','🏆','✨','👑','🌟','👑'];
    const total = 28;
    for (let i = 0; i < total; i++) {
        (lanzarCoronasVictoria._timers ||= []).push(setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'corona-victoria';
            el.textContent = simbolos[Math.floor(Math.random() * simbolos.length)];
            const duracion = 2200 + Math.random() * 2200;
            const giro = (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 360);
            el.style.cssText = `
                left: ${Math.random() * 100}vw;
                bottom: -30px;
                font-size: ${14 + Math.random() * 22}px;
                --giro: ${giro}deg;
                animation-duration: ${duracion}ms;
                animation-delay: 0ms;
            `;
            document.body.appendChild(el);
            setTimeout(() => el.remove(), duracion + 100);
        }, i * 120));
    }
}

function actualizarBotonesTurno(esMio, esCampana, campanaTocada) {
    const btnCambiar = document.getElementById('btnCambiar');
    btnCambiar.innerText = 'CAMBIAR';
    actualizarGuiaTurno(esMio, esCampana, campanaTocada);

    if (!esMio || !esCampana || !campanaTocada || !campanaRingerId) return;

    // Verificar si mi vecino derecho es quien tocó la campana
    if (vecinoDerechoLocal()?.id === campanaRingerId) {
        btnCambiar.innerText = '🃏 ROBAR';
        mostrarToast('🔔 No puedes cambiar con quien tocó la campana — si cambias, robarás del mazo.', 'rey', 4000);
    }
}

// Ícono del set propio (sprite SVG en index.html, símbolos "i-<nombre>").
// Se usan en la interfaz fija en lugar de emojis, que cada celular dibuja distinto.
function icono(nombre) {
    return `<svg class="icono" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;
}

// ==========================================
// GUÍAS PARA QUIEN EMPIEZA
// ==========================================
// Ayudas dentro de la ronda: flecha hacia con quién cambias (o al mazo si
// eres dealer), recordatorio del objetivo al iniciar la ronda, texto bajo los
// botones y explicación de por qué perdiste o te salvaste. Salen solas en las
// primeras PARTIDAS_CON_GUIAS partidas; el botón 💡 las prende o apaga a mano.
// Nunca dicen si conviene cambiar o mantener: eso es el juego.
const PARTIDAS_CON_GUIAS = 3;
let modoJuegoActual = 'CLASICO';

function leerLS(clave) { try { return localStorage.getItem(clave); } catch { return null; } }
function escribirLS(clave, valor) { try { localStorage.setItem(clave, valor); } catch { /* sin storage: guías por defecto */ } }

function partidasConGuia() { return parseInt(leerLS('reyPartidasGuia') || '0', 10) || 0; }

function guiasActivas() {
    if (_practica) return true;
    const pref = leerLS('reyGuias');
    if (pref === 'on') return true;
    if (pref === 'off') return false;
    return partidasConGuia() < PARTIDAS_CON_GUIAS;
}

function pintarBotonGuias() {
    const b = document.getElementById('btnToggleGuias');
    if (!b) return;
    const on = guiasActivas();
    b.style.opacity = on ? '1' : '0.4';
    b.title = on ? 'Guías activadas (toca para apagarlas)' : 'Guías apagadas (toca para prenderlas)';
}

function contarPartidaParaGuias() {
    const antes = guiasActivas();
    escribirLS('reyPartidasGuia', String(partidasConGuia() + 1));
    if (antes && !guiasActivas()) {
        mostrarToast('💡 Ya le agarraste la onda: apagamos las guías. Puedes prenderlas con 💡.', 'rey', 5000);
    }
    pintarBotonGuias();
}

// Siguiente jugador vivo a mi derecha (con quien cambiaría), o null.
function vecinoDerechoLocal() {
    const miIndex = listaJugadoresGlobal.findIndex(j => j.id === socket.id);
    if (miIndex === -1) return null;
    let i = miIndex;
    let intentos = 0;
    do {
        i = (i + 1) % listaJugadoresGlobal.length;
        intentos++;
    } while (listaJugadoresGlobal[i]?.vidas <= 0 && intentos < listaJugadoresGlobal.length);
    return i === miIndex ? null : listaJugadoresGlobal[i];
}

function ocultarGuiaTurno() {
    document.getElementById('flechaGuia')?.classList.add('hidden');
    document.getElementById('guiaAcciones')?.classList.add('hidden');
    document.body.classList.remove('con-guia');
}

// Flecha curva de tu carta al destino (asiento del vecino o el mazo), dibujada
// en un SVG que cubre el tapete.
function dibujarFlechaGuia(origenEl, destinoEl) {
    const tapete = document.getElementById('tapeteVistas');
    const svg = document.getElementById('flechaGuia');
    if (!tapete || !svg || !origenEl || !destinoEl) return;
    const t = tapete.getBoundingClientRect();
    const a = origenEl.getBoundingClientRect();
    const b = destinoEl.getBoundingClientRect();
    if (!b.width || !a.width) return;

    const x1 = a.left + a.width / 2 - t.left;
    const y1 = a.top - t.top;
    let x2 = b.left + b.width / 2 - t.left;
    let y2 = b.top + b.height / 2 - t.top;
    // Acortar la punta para no tapar la carta de destino.
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
    const recorte = Math.min(36, d * 0.25);
    x2 -= dx / d * recorte;
    y2 -= dy / d * recorte;
    // Curva jalada hacia el centro del tapete: se lee como "a través de la mesa".
    const cx = (x1 + x2) / 4 + t.width / 4;
    const cy = (y1 + y2) / 4 + t.height * 0.22;

    svg.setAttribute('viewBox', `0 0 ${t.width} ${t.height}`);
    svg.querySelector('.trazo-flecha').setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
    svg.classList.remove('hidden');
}

// Texto bajo los botones + flecha, solo en mi turno y con las guías prendidas.
function actualizarGuiaTurno(esMio, esCampana, campanaTocada) {
    ocultarGuiaTurno();
    if (!esMio || mostrandoRevelacion || !guiasActivas()) return;

    const yo = listaJugadoresGlobal.find(j => j.id === socket.id);
    const vecino = vecinoDerechoLocal();
    const mazo = document.getElementById('mazoFlotante');
    let destino = null;
    let textoCambiar = '🔄 Cambias tu carta';

    if (eventoActual?.id === 'MERCADO') {
        destino = mazo;
        textoCambiar = '🃏 Mercado: si cambias, robas del mazo';
    } else if (yo?.dealer) {
        destino = mazo;
        textoCambiar = '🔄 Eres el dealer: cambias tu carta por una del mazo';
    } else if (vecino && esCampana && campanaTocada && vecino.id === campanaRingerId) {
        destino = mazo;
        textoCambiar = '🃏 Robas del mazo (no puedes cambiar con quien tocó la campana)';
    } else if (vecino) {
        destino = document.querySelector(`.silla:not(.hidden)[data-jugador-id="${CSS.escape(vecino.id)}"]`);
        const reyALaVista = !esCampana && eventoActual?.id !== 'MUNDO_AL_REVES' && vecino.cartaRevelada && vecino.cartaActual === 9;
        textoCambiar = reyALaVista
            ? `👑 ${vecino.nombre} tiene al Rey: si cambias, se bloquea`
            : `🔄 Cambias tu carta con ${vecino.nombre}`;
    }

    const lineas = ['✋ Te quedas con tu carta', textoCambiar];
    if (eventoActual?.id === 'NIEBLA') lineas.push('🌫️ Niebla: decides sin ver tu carta');
    if (eventoActual?.id === 'MUNDO_AL_REVES') lineas.push('🔄 Mundo al revés: esta ronda pierde la carta más alta');
    if (esCampana && !campanaTocada) lineas.push('🔔 Cierra la ronda: tócala si crees tener la carta más baja');
    lineas.push('👆 También con tu carta: deslízala a la derecha para cambiar, tócala dos veces para mantener');
    amagarCarta();

    const guia = document.getElementById('guiaAcciones');
    if (guia) {
        guia.innerHTML = lineas.map(l => `<div>${escapeHTML(l)}</div>`).join('');
        guia.classList.remove('hidden');
        document.body.classList.add('con-guia'); // sube los avisos para no taparla
    }
    if (destino) dibujarFlechaGuia(document.getElementById('miCarta'), destino);
}

// La carta hace un amago hacia la derecha para invitar a arrastrarla.
function amagarCarta() {
    if (menosMovimiento()) return;
    const carta = document.getElementById('miCarta');
    if (!carta || carta.classList.contains('arrastrando')) return;
    carta.animate([
        { transform: 'translateX(0) rotate(0deg)' },
        { transform: 'translateX(22px) rotate(5deg)', offset: 0.3 },
        { transform: 'translateX(0) rotate(0deg)', offset: 0.55 },
        { transform: 'translateX(14px) rotate(3deg)', offset: 0.75 },
        { transform: 'translateX(0) rotate(0deg)' },
    ], { duration: 1100, delay: 500, easing: 'ease-in-out', composite: 'add' });
}

// Recordatorio del objetivo al empezar cada ronda.
function mostrarObjetivoRonda() {
    const banner = document.getElementById('bannerObjetivo');
    if (!banner || !guiasActivas() || _practica || eventoActual) return;
    banner.textContent = modoJuegoActual === 'CAMPANA'
        ? '🔔 Pierde la carta MÁS ALTA — quieres cartas bajas'
        : '⚔️ Pierde la carta MÁS BAJA — quieres cartas altas';
    banner.classList.remove('hidden');
    clearTimeout(mostrarObjetivoRonda._t);
    mostrarObjetivoRonda._t = setTimeout(() => banner.classList.add('hidden'), 4500);
}

// Por qué perdiste o te salvaste, para el resumen de la ronda.
function explicacionRonda(datos) {
    const yo = datos.jugadores.find(j => j.id === socket.id);
    const pierdo = datos.perdedores.includes(socket.id);
    if (!yo || yo.cartaActual === undefined || (yo.vidas <= 0 && !pierdo)) return '';

    const extremo = (modoJuegoActual === 'CAMPANA' || eventoActual?.id === 'MUNDO_AL_REVES') ? 'más alta' : 'más baja';
    if (eventoActual?.id === 'AMNISTIA') {
        const tenia = yo.cartaActual === datos.cartaMortal;
        return tenia ? `🕊️ Amnistía: no pierdes vida, pero tu ${yo.cartaActual} era la más baja y pierdes tu próximo turno.`
                     : `🕊️ Amnistía: nadie pierde vida esta ronda. La más baja fue el ${datos.cartaMortal}.`;
    }
    const enJuego = datos.jugadores.filter(j =>
        j.cartaActual !== undefined && (j.vidas > 0 || datos.perdedores.includes(j.id)));
    if (enJuego.length > 1 && enJuego.every(j => j.cartaActual === datos.cartaMortal)) {
        return '🤝 Empate total: todos tenían la misma carta, nadie pierde.';
    }
    const toqueCampana = datos.campana && datos.campana.tocadorId === socket.id;
    if (pierdo) {
        let t = `💔 Perdiste${eventoActual?.id === 'DOBLE_CASTIGO' ? ' 2 vidas (doble castigo)' : ''}: tu ${yo.cartaActual} era la carta ${extremo}.`;
        if (toqueCampana && !datos.campana.acertada) t += ' Y tocaste la campana con ella: una vida extra.';
        return t;
    }
    let t = `✅ Te salvaste: la carta ${extremo} fue el ${datos.cartaMortal} y tú tenías ${yo.cartaActual}.`;
    if (toqueCampana) t += ' ¡Y acertaste la campana!';
    return t;
}

// ==========================================
// ANIMACIONES DE LA MESA
// ==========================================
// Revelación con suspenso, cambios visibles entre asientos y corazón que se
// rompe. Son adorno: no cambian reglas ni tiempos del servidor, y con
// "reducir movimiento" se saltan.
const PASO_REVELAR_MS = 180;   // entre carta y carta al revelar
let _inicioRevelacion = 0;     // performance.now() del fin de ronda

function menosMovimiento() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// Retrasos de la revelación, calculados contra el reloj: si la mesa se
// vuelve a dibujar a media revelación, cada carta sigue donde iba.
function estiloRevelar(jugadorId) {
    const pasado = performance.now() - _inicioRevelacion;
    const retraso = ordenRevelacion(jugadorId) * PASO_REVELAR_MS - pasado;
    return `--retraso-revelar:${Math.round(retraso)}ms;--retraso-danio:${Math.round(duracionRevelacion() - pasado)}ms`;
}

// Orden en que se voltea la carta de un jugador: el mismo en que jugó
// (empieza a la derecha del dealer y el dealer va al final).
function ordenRevelacion(jugadorId) {
    const n = listaJugadoresGlobal.length;
    const dealer = listaJugadoresGlobal.findIndex(j => j.dealer);
    const idx = listaJugadoresGlobal.findIndex(j => j.id === jugadorId);
    if (dealer < 0 || idx < 0) return 0;
    return (idx - dealer - 1 + n) % n;
}

// Milisegundos desde el fin de ronda hasta que termina la última carta.
function duracionRevelacion() {
    return listaJugadoresGlobal.length * PASO_REVELAR_MS + 350;
}

// Elemento de la carta de un jugador en la mesa (tu carta o el reverso del asiento).
function cartaEnMesa(nombre) {
    if (nombre === miNombreUsuario) return document.getElementById('miCarta');
    const j = listaJugadoresGlobal.find(x => x.nombre === nombre);
    if (!j) return null;
    const silla = document.querySelector(`.silla:not(.hidden)[data-jugador-id="${CSS.escape(j.id)}"]`);
    return silla?.querySelector('.perfil-carta-reverso, .mini-carta-frente') || silla;
}

// Carta boca abajo que vuela entre dos rectángulos de pantalla. `arco` curva
// la trayectoria (px, perpendicular a la línea); `rebote` la regresa desde el
// punto `rebote` (0–1) del camino, como si chocara.
function volarFantasma(desde, hacia, { arco = 0, duracion = 620, rebote = 0 } = {}) {
    const g = document.createElement('div');
    g.className = 'perfil-carta-reverso carta-fantasma-cambio';
    const w = Math.min(desde.width || 40, 46), h = w * 1.5;
    g.style.width = w + 'px'; g.style.height = h + 'px';
    g.style.left = (desde.left + desde.width / 2 - w / 2) + 'px';
    g.style.top = (desde.top + desde.height / 2 - h / 2) + 'px';
    document.body.appendChild(g);
    const dx = (hacia.left + hacia.width / 2) - (desde.left + desde.width / 2);
    const dy = (hacia.top + hacia.height / 2) - (desde.top + desde.height / 2);
    const largo = Math.hypot(dx, dy) || 1;
    const px = -dy / largo * arco, py = dx / largo * arco;
    const cuadros = rebote
        ? [
            { transform: 'translate(0,0) rotate(0deg)' },
            { transform: `translate(${dx * rebote}px, ${dy * rebote}px) rotate(8deg) scale(1.1)`, offset: 0.45 },
            { transform: `translate(${dx * rebote * 0.8}px, ${dy * rebote * 0.8}px) rotate(-10deg) scale(0.95)`, offset: 0.55 },
            { transform: 'translate(0,0) rotate(0deg)' },
          ]
        : [
            { transform: 'translate(0,0) rotate(0deg) scale(1)' },
            { transform: `translate(${dx / 2 + px}px, ${dy / 2 + py}px) rotate(${arco >= 0 ? 12 : -12}deg) scale(1.15)`, offset: 0.5 },
            { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(1)` },
          ];
    const anim = g.animate(cuadros, { duration: duracion, easing: 'cubic-bezier(.45,.05,.35,1)' });
    anim.onfinish = () => g.remove();
    return anim;
}

// Dos cartas boca abajo que cruzan la mesa entre quienes cambiaron.
function animarCambioEntre(nombreA, nombreB) {
    if (menosMovimiento()) return;
    const a = cartaEnMesa(nombreA), b = cartaEnMesa(nombreB);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) return;
    volarFantasma(ra, rb, { arco: 28 });
    volarFantasma(rb, ra, { arco: -28 });
    Sonidos.carta();
}

// Bloqueo del Rey: la carta sale hacia el Rey, choca a medio camino y rebota;
// la carta del Rey destella en dorado.
function animarBloqueoRey(nombreActor, nombreRey) {
    if (menosMovimiento()) return;
    const a = cartaEnMesa(nombreActor), r = cartaEnMesa(nombreRey);
    if (!a || !r) return;
    const ra = a.getBoundingClientRect(), rr = r.getBoundingClientRect();
    if (!ra.width || !rr.width) return;
    volarFantasma(ra, rr, { rebote: 0.55, duracion: 760 });
    destelloRey(rr, 280);
}

// Corona dorada que destella sobre un rectángulo de pantalla (la carta del Rey).
function destelloRey(rect, retraso = 0) {
    const destello = document.createElement('div');
    destello.className = 'destello-rey';
    destello.style.left = (rect.left + rect.width / 2) + 'px';
    destello.style.top = (rect.top + rect.height / 2) + 'px';
    destello.innerHTML = icono('corona');
    document.body.appendChild(destello);
    destello.animate([
        { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.35 },
        { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
    ], { duration: 900, delay: retraso, easing: 'ease-out', fill: 'both' }).onfinish = () => destello.remove();
}

// DECLARADO: el Rey llega boca abajo con el reparto y se voltea a los
// MS_REVELAR_REY (mismo tiempo que el aviso del servidor).
const MS_REVELAR_REY = 2000;
let _reyOcultoHasta = 0;

function programarRevelacionRey(jugadores, introMs = 0) {
    const reyes = (jugadores || []).filter(j => j.cartaRevelada && j.cartaActual === 9);
    if (!reyes.length) { _reyOcultoHasta = 0; return; }
    _reyOcultoHasta = performance.now() + introMs + MS_REVELAR_REY;
    setTimeout(() => {
        _reyOcultoHasta = 0;
        dibujarMesaCircular();
        if (menosMovimiento()) return;
        reyes.forEach(rey => {
            const carta = rey.id === socket.id ? document.getElementById('miCarta') : cartaEnMesa(rey.nombre);
            const r = carta?.getBoundingClientRect();
            if (r && r.width) destelloRey(r);
        });
        Sonidos.carta();
    }, introMs + MS_REVELAR_REY);
}

// Campana: se balancea sobre quien la tocó y una onda dorada cruza el tapete.
function animarCampana(jugadorId) {
    if (menosMovimiento()) return;
    const origen = jugadorId === socket.id
        ? document.getElementById('miCarta')
        : document.querySelector(`.silla:not(.hidden)[data-jugador-id="${CSS.escape(jugadorId)}"]`);
    const tapete = document.getElementById('tapeteVistas');
    if (!origen || !tapete) return;
    const ro = origen.getBoundingClientRect(), rt = tapete.getBoundingClientRect();
    const cx = ro.left + ro.width / 2, cy = ro.top + ro.height / 2;

    const campana = document.createElement('div');
    campana.className = 'campana-balanceo';
    campana.innerHTML = icono('campana');
    campana.style.left = cx + 'px'; campana.style.top = (ro.top - 6) + 'px';
    document.body.appendChild(campana);
    campana.animate([
        { transform: 'translate(-50%,-100%) rotate(0deg) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%,-100%) rotate(-24deg) scale(1.1)', opacity: 1, offset: 0.15 },
        { transform: 'translate(-50%,-100%) rotate(20deg)', offset: 0.35 },
        { transform: 'translate(-50%,-100%) rotate(-14deg)', offset: 0.55 },
        { transform: 'translate(-50%,-100%) rotate(8deg)', offset: 0.75 },
        { transform: 'translate(-50%,-100%) rotate(0deg)', opacity: 1, offset: 0.9 },
        { transform: 'translate(-50%,-100%) rotate(0deg)', opacity: 0 },
    ], { duration: 1500, easing: 'ease-in-out' }).onfinish = () => campana.remove();

    // Onda: un anillo que crece hasta cubrir el tapete desde el asiento.
    const alcance = Math.hypot(Math.max(cx - rt.left, rt.right - cx), Math.max(cy - rt.top, rt.bottom - cy)) * 2;
    [0, 260].forEach(retraso => {
        const onda = document.createElement('div');
        onda.className = 'onda-campana';
        onda.style.left = cx + 'px'; onda.style.top = cy + 'px';
        document.body.appendChild(onda);
        onda.animate([
            { width: '20px', height: '20px', opacity: 0.9 },
            { width: alcance + 'px', height: alcance + 'px', opacity: 0 },
        ], { duration: 1300, delay: retraso, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' }).onfinish = () => onda.remove();
    });
}

// Robo del mazo: una carta vuela del mazo al jugador y la vieja cae a la pila.
function animarRoboMazo(nombre) {
    if (menosMovimiento()) return;
    const mazo = document.getElementById('mazoFlotante');
    const carta = cartaEnMesa(nombre);
    if (!mazo || !carta) return;
    const rm = mazo.getBoundingClientRect(), rc = carta.getBoundingClientRect();
    if (!rm.width || !rc.width) return;
    const pila = document.getElementById('cartasPila');
    const rp = pila && pila.getBoundingClientRect().width ? pila.getBoundingClientRect()
        : document.getElementById('tapeteVistas').getBoundingClientRect();
    const centroPila = { left: rp.left + rp.width / 2 - 20, top: rp.top + rp.height / 2 - 30, width: 40, height: 60 };
    volarFantasma(rc, centroPila, { arco: -18, duracion: 520 });
    setTimeout(() => volarFantasma(rm, rc, { arco: 22, duracion: 600 }), 180);
    Sonidos.carta();
}

// Corazón que se parte en dos sobre las vidas de quien perdió; si quedó
// eliminado, sello de calavera sobre su asiento.
function animarPerdidaVida(jugador) {
    if (menosMovimiento()) return;
    const esYo = jugador.id === socket.id;
    const silla = esYo ? document.getElementById('miPerfil')
        : document.querySelector(`.silla:not(.hidden)[data-jugador-id="${CSS.escape(jugador.id)}"]`);
    if (!silla) return;
    const ancla = (esYo ? document.getElementById('misVidasMesa') : silla.querySelector('.vidas-destacadas')) || silla;
    const r = ancla.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;

    const capa = document.createElement('div');
    capa.className = 'corazon-roto-capa';
    capa.style.left = cx + 'px'; capa.style.top = cy + 'px';
    capa.innerHTML = `<span class="mitad izq">${icono('corazon')}</span><span class="mitad der">${icono('corazon')}</span>`;
    document.body.appendChild(capa);
    capa.animate([{ transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0 },
                  { transform: 'translate(-50%,-90%) scale(1.25)', opacity: 1, offset: 0.35 },
                  { transform: 'translate(-50%,-90%) scale(1.2)', opacity: 1 }],
                 { duration: 380, easing: 'ease-out', fill: 'forwards' });
    const [izq, der] = capa.querySelectorAll('.mitad');
    const caer = (el, lado) => el.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: `translate(${lado * 16}px, 38px) rotate(${lado * 35}deg)`, opacity: 0 },
    ], { duration: 650, delay: 420, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' });
    caer(izq, -1);
    caer(der, 1).onfinish = () => capa.remove();

    if (jugador.vidas <= 0) {
        const rs = silla.getBoundingClientRect();
        const sello = document.createElement('div');
        sello.className = 'sello-eliminado';
        sello.innerHTML = icono('calavera');
        sello.style.left = (rs.left + rs.width / 2) + 'px';
        sello.style.top = (rs.top + rs.height / 2) + 'px';
        document.body.appendChild(sello);
        sello.animate([
            { transform: 'translate(-50%,-50%) scale(2.4) rotate(-18deg)', opacity: 0 },
            { transform: 'translate(-50%,-50%) scale(0.95) rotate(-12deg)', opacity: 1, offset: 0.45 },
            { transform: 'translate(-50%,-50%) scale(1) rotate(-12deg)', opacity: 1, offset: 0.8 },
            { transform: 'translate(-50%,-50%) scale(1) rotate(-12deg)', opacity: 0 },
        ], { duration: 1800, delay: 500, easing: 'ease-out', fill: 'both' }).onfinish = () => sello.remove();
    }
}

// ==========================================
// FRASES RÁPIDAS
// ==========================================
// Por la red viaja solo el número (el servidor valida el rango con
// TOTAL_FRASES); si agregas o quitas frases, actualiza también el servidor.
const FRASES_RAPIDAS = [
    '¡Buena jugada!',
    '¡Cámbiame esa carta!',
    'Ni lo pienses',
    'Suerte, la vas a necesitar',
    '¡Uy! Casi',
    'El Rey es mío',
    '¿Seguro que mantienes?',
    'Buena partida',
];
const _globosFrase = {}; // jugadorId → globo visible (uno por jugador)

// Globo de diálogo sobre el asiento de quien habló.
function mostrarFrase(jugadorId, indice) {
    const texto = FRASES_RAPIDAS[indice];
    if (!texto) return;
    const asiento = jugadorId === socket.id
        ? document.getElementById('miPerfil')
        : document.querySelector(`.silla:not(.hidden)[data-jugador-id="${CSS.escape(jugadorId)}"] .perfil-oponente`);
    if (!asiento) return;
    _globosFrase[jugadorId]?.remove();
    const r = asiento.getBoundingClientRect();
    const globo = document.createElement('div');
    globo.className = 'globo-frase';
    globo.textContent = texto;
    document.body.appendChild(globo);
    // Arriba del asiento, sin salirse de la pantalla por los lados.
    const ancho = globo.offsetWidth;
    const x = Math.min(Math.max(r.left + r.width / 2, ancho / 2 + 8), window.innerWidth - ancho / 2 - 8);
    globo.style.left = x + 'px';
    globo.style.top = (r.top - 8) + 'px';
    globo.style.setProperty('--cola-x', `${Math.round(r.left + r.width / 2 - (x - ancho / 2))}px`);
    _globosFrase[jugadorId] = globo;
    Sonidos.pop();
    setTimeout(() => {
        globo.classList.add('saliendo');
        setTimeout(() => { globo.remove(); if (_globosFrase[jugadorId] === globo) delete _globosFrase[jugadorId]; }, 300);
    }, 3000);
}

function cerrarPanelFrases() {
    document.getElementById('panelFrases')?.classList.add('hidden');
    document.getElementById('btnFrases')?.setAttribute('aria-expanded', 'false');
}

// ==========================================
// ESCANEAR QR PARA UNIRSE
// ==========================================
// El QR de la sala lleva linkDeSala() (…/sala/CÓDIGO). Con HTTPS se usa la
// cámara en vivo; sin él (hoy el juego va por HTTP y el navegador bloquea la
// cámara) se toma una foto y se lee de la imagen. jsQR se carga al usarlo.
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

function cargarJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((ok, mal) => {
        const s = document.createElement('script');
        s.src = JSQR_URL;
        s.onload = ok;
        s.onerror = () => mal(new Error('No se pudo cargar el lector de QR. Revisa tu conexión e inténtalo de nuevo.'));
        document.head.appendChild(s);
    });
}

// Código de sala dentro del texto del QR: enlace …/sala/ABCDE, ?sala=ABCDE o solo el código.
function codigoDesdeQR(texto) {
    const m = String(texto).match(/\/sala\/([A-Z0-9]{5})(?![A-Z0-9])/i)
        || String(texto).match(/[?&]sala=([A-Z0-9]{5})(?![A-Z0-9])/i)
        || String(texto).trim().match(/^([A-Z0-9]{5})$/i);
    return m ? m[1].toUpperCase() : null;
}

function unirseConCodigoQR(texto) {
    const codigo = codigoDesdeQR(texto);
    if (!codigo) {
        mostrarToast('Ese QR no es de una sala de Rey Contento.', 'danio', 3500);
        return false;
    }
    document.getElementById('inputCodigo').value = codigo;
    mostrarToast(`Sala ${codigo} encontrada`, 'rey', 2000);
    document.getElementById('btnUnirseSala').click();
    return true;
}

// Lee un QR de una foto. Reduce la imagen a ~1200 px para que sea rápido.
async function leerQRDeFoto(archivo) {
    await cargarJsQR();
    const img = await createImageBitmap(archivo);
    const escala = Math.min(1, 1200 / Math.max(img.width, img.height));
    const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    return r ? r.data : null;
}

let _escaner = null; // { stream, raf }

async function abrirEscanerEnVivo() {
    await cargarJsQR();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.getElementById('videoEscaner');
    video.srcObject = stream;
    await video.play();
    document.getElementById('escanerQR').classList.remove('hidden');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    _escaner = { stream, raf: 0, ultimo: 0 };
    const leer = (t) => {
        if (!_escaner) return;
        _escaner.raf = requestAnimationFrame(leer);
        if (t - _escaner.ultimo < 200 || video.readyState < 2) return; // ~5 lecturas por segundo
        _escaner.ultimo = t;
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        const r = window.jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (r && codigoDesdeQR(r.data)) { cerrarEscaner(); unirseConCodigoQR(r.data); }
    };
    _escaner.raf = requestAnimationFrame(leer);
}

function cerrarEscaner() {
    if (_escaner) {
        cancelAnimationFrame(_escaner.raf);
        _escaner.stream.getTracks().forEach(t => t.stop());
        _escaner = null;
    }
    document.getElementById('escanerQR')?.classList.add('hidden');
}

document.getElementById('btnEscanearQR')?.addEventListener('click', async () => {
    const enVivo = window.isSecureContext && navigator.mediaDevices?.getUserMedia;
    if (enVivo) {
        try { await abrirEscanerEnVivo(); return; }
        catch (e) { cerrarEscaner(); /* sin permiso de cámara: seguir con la foto */ }
    }
    document.getElementById('inputFotoQR').click();
});
document.getElementById('inputFotoQR')?.addEventListener('change', async (e) => {
    const archivo = e.target.files && e.target.files[0];
    e.target.value = ''; // permitir elegir la misma foto otra vez
    if (!archivo) return;
    try {
        const texto = await leerQRDeFoto(archivo);
        if (texto) unirseConCodigoQR(texto);
        else mostrarToast('No encontré un QR en la foto. Acércate un poco más y que se vea completo.', 'danio', 4000);
    } catch (err) {
        mostrarToast(err.message || 'No se pudo leer la foto.', 'danio', 4000);
    }
});
document.getElementById('btnCerrarEscaner')?.addEventListener('click', cerrarEscaner);

// ==========================================
// MESAS ABIERTAS (pestaña Unirse)
// ==========================================
// Mientras la pestaña Unirse está a la vista se pide la lista cada 4 s.
let _sondeoSalas = null;

function unirseVisible() {
    const panel = document.getElementById('panelUnirse');
    return panel && !panel.classList.contains('hidden')
        && !document.getElementById('seccion-lobby')?.classList.contains('hidden')
        && document.getElementById('pantallaJuego') && !document.getElementById('pantallaJuego').classList.contains('hidden')
        && document.visibilityState === 'visible';
}

function pedirSalasAbiertas() {
    if (!unirseVisible()) { clearInterval(_sondeoSalas); _sondeoSalas = null; return; }
    if (socket?.connected) socket.emit('listarSalas');
}

window.alAbrirUnirse = () => {
    pedirSalasAbiertas();
    clearInterval(_sondeoSalas);
    _sondeoSalas = setInterval(pedirSalasAbiertas, 4000);
};

const NOMBRE_MODO_JUEGO = { CLASICO: 'Clásico', CAMPANA: 'Campana' };

function pintarSalasAbiertas(salas) {
    const lista = document.getElementById('listaSalasAbiertas');
    if (!lista) return;
    if (!salas.length) {
        lista.innerHTML = '<li class="salas-vacio">No hay mesas esperando ahora. Prueba la <strong>partida rápida</strong> en la pestaña Crear.</li>';
        return;
    }
    lista.innerHTML = salas.map(s => {
        const titulo = s.rapida ? 'Partida rápida' : `Mesa de ${escapeHTML(s.anfitrion)}`;
        const detalle = [`${s.vidas} ${s.vidas === 1 ? 'vida' : 'vidas'}`, NOMBRE_MODO_JUEGO[s.modoJuego] || '',
            s.modoRey === 'DECLARADO' ? 'Rey declarado' : 'Rey sorpresa'].filter(Boolean).join(' · ');
        const extra = s.rapida && s.faltanMs != null ? ` · empieza en ${Math.ceil(s.faltanMs / 1000)} s` : '';
        return `<li class="sala-abierta">
            <span class="sala-abierta-info">
                <strong>${titulo}</strong>
                <span>${icono('grupo')} ${s.jugadores}/${s.max} · ${detalle}${extra}</span>
            </span>
            <button class="boton-oro sala-abierta-entrar" data-sala="${escapeHTML(s.idSala)}">Entrar</button>
        </li>`;
    }).join('');
    lista.querySelectorAll('.sala-abierta-entrar').forEach(b => {
        b.onclick = () => {
            document.getElementById('inputCodigo').value = b.dataset.sala;
            document.getElementById('btnUnirseSala').click();
        };
    });
}

// ==========================================
// PARTIDA RÁPIDA
// ==========================================
// El servidor te sienta en una mesa pública de 4 y la arranca sola: al llenarse
// o a los 20 s, completando con bots. Aquí solo se muestra la espera.
let _rapida = null; // { fin: ms epoch, intervalo } mientras esperas

function empezarRapida() {
    socket.emit('partidaRapida');
}

function pintarEsperaRapida() {
    const el = document.getElementById('rapidaEspera');
    if (!el || !_rapida) return;
    const seg = Math.max(0, Math.ceil((_rapida.fin - Date.now()) / 1000));
    const humanos = listaJugadoresGlobal.filter(j => !j.esBot).length;
    const otros = humanos > 1 ? `${humanos - 1} ${humanos - 1 === 1 ? 'jugador más' : 'jugadores más'} en la mesa` : 'Esperando a otros jugadores';
    el.innerHTML = seg > 0
        ? `${icono('reloj')} La partida empieza en <strong>${seg} s</strong><br><span>${otros} · los lugares vacíos se llenan con bots</span>`
        : `${icono('espadas')} ¡Empieza la partida!`;
}

function terminarEsperaRapida() {
    if (_rapida?.intervalo) clearInterval(_rapida.intervalo);
    _rapida = null;
    document.getElementById('rapidaEspera')?.classList.add('hidden');
    document.getElementById('resumenConfig')?.classList.remove('hidden');
}

// ==========================================
// PRÁCTICA GUIADA
// ==========================================
// Partida de 3 rondas contra 2 bots con cartas preparadas (practica.js en el
// servidor). Un globo sobre la mesa explica cada momento. Los textos suponen
// ese guion: si cambias las cartas allá, revisa los textos aquí.
let _practica = null; // { nombreA, nombreB, dichos: Set } mientras dura

function empezarPractica() {
    _practica = { nombreA: 'A', nombreB: 'B', dichos: new Set() };
    socket.emit('crearSala', { configuracion: { practica: true } });
}

function mostrarCoach(html, { boton = null, alPulsar = null } = {}) {
    const coach = document.getElementById('coachPractica');
    if (!coach) return;
    document.getElementById('coachTexto').innerHTML = html;
    const b = document.getElementById('coachBoton');
    b.classList.toggle('hidden', !boton);
    if (boton) { b.textContent = boton; b.onclick = alPulsar; }
    coach.classList.remove('hidden');
    coach.animate?.([{ opacity: 0, transform: 'translate(-50%, -6px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }],
        { duration: menosMovimiento() ? 0 : 280, easing: 'ease-out' });
}

function terminarPractica() {
    if (miSalaActual) socket.emit('abandonarSala', miSalaActual);
    _practica = null;
    escribirLS('reyPracticaHecha', '1');
    document.getElementById('coachPractica')?.classList.add('hidden');
    mostrarLobbyLimpio();
    pintarBotonPractica();
}

function pintarBotonPractica() {
    const b = document.getElementById('btnPractica');
    if (!b) return;
    // La acción principal del lobby es la partida rápida (oro); la práctica va
    // en madera y avisa si todavía no la haces.
    b.className = 'boton-madera boton-lobby full-width';
    b.classList.toggle('practica-nueva', !leerLS('reyPracticaHecha'));
}

// Un paso del guion solo se dice una vez.
function decirUnaVez(clave, html, opciones) {
    if (!_practica || _practica.dichos.has(clave)) return;
    _practica.dichos.add(clave);
    mostrarCoach(html, opciones);
}

function practicaEvento(tipo, datos) {
    if (!_practica) return;
    const A = `<strong>${escapeHTML(_practica.nombreA)}</strong>`;
    const B = `<strong>${escapeHTML(_practica.nombreB)}</strong>`;
    const ronda = parseInt(document.getElementById('numRonda')?.innerText || '0', 10);
    const miCarta = document.getElementById('numeroCarta')?.innerText;

    if (tipo === 'ronda') {
        const js = datos.jugadores || [];
        if (js[1]) _practica.nombreA = js[1].nombre;
        if (js[2]) _practica.nombreB = js[2].nombre;
        const A2 = `<strong>${escapeHTML(_practica.nombreA)}</strong>`;
        if (datos.ronda === 2) decirUnaVez('r2', `Ronda 2. Ahora <b>tú eres el dealer</b> (la corona está en tu asiento): juegas al final.`);
        if (datos.ronda === 3) decirUnaVez('r3', `Última ronda, en <b>modo declarado</b>: a los pocos segundos del reparto, la carta del <b>Rey (el 9)</b> se voltea y todos saben quién lo tiene. Fíjate en la carta de ${A2}…`);
        return;
    }
    if (tipo === 'turno') {
        const esMio = datos.id === socket.id;
        if (ronda === 1 && esMio) decirUnaVez('r1-tu', `<b>¡Bienvenido a la práctica!</b> Cada jugador tiene una carta y al final de la ronda <b>pierde una vida quien tenga la más baja</b>.<br>Te tocó el <b>1, La Rata</b>: con ella casi seguro pierdes. Cámbiala con ${A}, tu vecino de la derecha: <b>desliza tu carta a la derecha</b> o toca <b>CAMBIAR</b>.`);
        if (ronda === 1 && datos.nombre === _practica.nombreA) decirUnaVez('r1-a', miCarta === '7'
            ? `¡Bien! Ahora tienes el <b>7</b> de ${A} y él se quedó con tu 1. Mira qué hace con esa carta…`
            : `Te quedaste con el 1. Mira qué hacen los demás…`);
        if (ronda === 1 && datos.nombre === _practica.nombreB) decirUnaVez('r1-b', `${A} le pasó el 1 a ${B}. Ahora ${B} es el <b>dealer</b> (la corona): juega al final y, si cambia, no cambia con nadie: <b>roba del mazo</b>.`);
        if (ronda === 2 && esMio) decirUnaVez('r2-tu', `Tienes un <b>2</b>, muy baja. Como eres el dealer, si cambias <b>robas del mazo</b>: desliza tu carta a la derecha o toca <b>CAMBIAR</b>. (Para quedarte con tu carta, la tocarías dos veces.)`);
        return;
    }
    if (tipo === 'saltado' && datos === socket.id && ronda === 3) {
        decirUnaVez('r3-salto', `${A}, a tu derecha, tiene al Rey: <b>nadie puede quitárselo</b>, así que tu turno se salta solo. En modo sorpresa no lo sabrías hasta chocar con él.`);
        return;
    }
    if (tipo === 'fin') {
        const perdedores = datos.jugadores.filter(j => datos.perdedores.includes(j.id)).map(j => `<strong>${escapeHTML(j.nombre)}</strong>`).join(' y ') || 'nadie';
        if (ronda === 1) decirUnaVez('f1', `Se voltean todas las cartas. La más baja fue el <b>${datos.cartaMortal}</b>: ${perdedores} pierde una vida. ¿Viste? Tu 1 pasó de mano en mano. La siguiente ronda empieza sola.`);
        if (ronda === 2) decirUnaVez('f2', (miCarta === '7' ? `Robaste un <b>7</b> del mazo y te salvaste. ` : `La más baja fue el <b>${datos.cartaMortal}</b>. `)
            + `Como eres el dealer, <b>tú decides cuándo seguir</b>: toca <b>SIGUIENTE RONDA</b>.`);
        if (ronda >= 3) decirUnaVez('f3', `<b>¡Ya sabes jugar!</b> Pierde la carta más baja · cambias con quien está a tu derecha · el dealer roba del mazo · al Rey no se le quita la carta. Para mantener tu carta, tócala dos veces. El modo campana está explicado en <b>¿Cómo se juega?</b>`,
            { boton: 'Terminar práctica', alPulsar: terminarPractica });
    }
}

// ==========================================
// EVENTOS DE RONDA Y DUELO FINAL
// ==========================================
// El servidor decide (eventos.js) y lo manda en datosMesa: evento, duelo,
// anunciarDuelo, duelistas e introMs (lo que duran las presentaciones antes
// del primer turno). Aquí solo se muestran.
let eventoActual = null; // { id, titulo, descripcion, icono } o null
let enDuelo = false;

function pintarChipEvento() {
    const chip = document.getElementById('chipEvento');
    if (!chip) return;
    chip.innerHTML = eventoActual ? `${icono(eventoActual.icono)} ${escapeHTML(eventoActual.titulo)}` : '';
    chip.title = eventoActual ? eventoActual.descripcion : '';
    chip.classList.toggle('hidden', !eventoActual);
}

// Carta grande al centro; al terminar se encoge a la etiqueta de arriba.
function mostrarCartaEvento(evento, retraso = 0) {
    const carta = document.getElementById('cartaEvento');
    if (!carta) return;
    setTimeout(() => {
        if (eventoActual !== evento) return;
        document.getElementById('cartaEventoIcono').innerHTML = icono(evento.icono);
        document.getElementById('cartaEventoTitulo').textContent = evento.titulo;
        document.getElementById('cartaEventoTexto').textContent = evento.descripcion;
        carta.classList.remove('hidden', 'saliendo');
        Sonidos.campana();
        vibrar([40, 30, 40]);
        setTimeout(() => {
            carta.classList.add('saliendo');
            setTimeout(() => { carta.classList.add('hidden'); pintarChipEvento(); }, 350);
        }, 2200);
    }, retraso);
}

function ocultarEvento() {
    document.getElementById('cartaEvento')?.classList.add('hidden');
    document.getElementById('chipEvento')?.classList.add('hidden');
}

function mostrarPresentacionDuelo(duelistas) {
    const capa = document.getElementById('presentacionDuelo');
    if (!capa || !duelistas || duelistas.length < 2) return;
    document.getElementById('duelistaIzq').textContent = duelistas[0];
    document.getElementById('duelistaDer').textContent = duelistas[1];
    capa.classList.remove('hidden', 'saliendo');
    Sonidos.turno();
    vibrar([120, 80, 120, 80, 200]);
    setTimeout(() => {
        capa.classList.add('saliendo');
        setTimeout(() => capa.classList.add('hidden'), 400);
    }, 2400);
}

function marcarDuelo(activo) {
    enDuelo = !!activo;
    document.getElementById('tapeteVistas')?.classList.toggle('modo-duelo', enDuelo);
}

// Duelo: las dos cartas salen de sus asientos, chocan al centro con chispas
// y la perdedora tiembla en rojo.
function animarChoqueDuelo(datos) {
    if (menosMovimiento()) return;
    const tapete = document.getElementById('tapeteVistas');
    const duelistas = datos.jugadores.filter(j => j.cartaActual !== undefined && (j.vidas > 0 || datos.perdedores.includes(j.id)));
    if (!tapete || duelistas.length !== 2) return;
    const rt = tapete.getBoundingClientRect();
    const cx = rt.left + rt.width / 2, cy = rt.top + rt.height * 0.45;
    duelistas.forEach((j, i) => {
        const origen = j.id === socket.id ? document.getElementById('miCarta') : cartaEnMesa(j.nombre);
        const ro = origen?.getBoundingClientRect();
        if (!ro || !ro.width) return;
        const c = document.createElement('div');
        const extra = j.cartaActual === 9 ? ' carta-9' : j.cartaActual === 0 ? ' carta-0' : '';
        c.className = 'carta-duelo' + extra;
        c.innerHTML = `<b>${j.cartaActual}</b>${figuraIMG(j.cartaActual, 30)}<small>${escapeHTML(nombresCartas[j.cartaActual] || '')}</small>`;
        c.style.left = (ro.left + ro.width / 2) + 'px';
        c.style.top = (ro.top + ro.height / 2) + 'px';
        document.body.appendChild(c);
        const lado = i === 0 ? -1 : 1;
        const dx = cx - (ro.left + ro.width / 2), dy = cy - (ro.top + ro.height / 2);
        const pierde = datos.perdedores.includes(j.id);
        c.animate([
            { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
            { transform: `translate(calc(-50% + ${dx + lado * 70}px), calc(-50% + ${dy}px)) scale(1)`, opacity: 1, offset: 0.35 },
            { transform: `translate(calc(-50% + ${dx + lado * 22}px), calc(-50% + ${dy}px)) rotate(${lado * -8}deg) scale(1.05)`, offset: 0.5 },
            { transform: `translate(calc(-50% + ${dx + lado * 60}px), calc(-50% + ${dy}px)) rotate(${lado * 6}deg) scale(1)`, offset: 0.62 },
            pierde
                ? { transform: `translate(calc(-50% + ${dx + lado * 60}px), calc(-50% + ${dy + 18}px)) rotate(${lado * 14}deg) scale(0.9)`, opacity: 1, offset: 0.9 }
                : { transform: `translate(calc(-50% + ${dx + lado * 60}px), calc(-50% + ${dy - 8}px)) scale(1.12)`, opacity: 1, offset: 0.9 },
            { transform: `translate(calc(-50% + ${dx + lado * 60}px), calc(-50% + ${dy}px)) scale(1)`, opacity: 0 },
        ], { duration: 2000, easing: 'cubic-bezier(.4,.1,.3,1)', fill: 'forwards' }).onfinish = () => c.remove();
        if (pierde) setTimeout(() => c.classList.add('pierde'), 1250);
    });
    // Chispas en el choque
    setTimeout(() => {
        Sonidos.danio();
        vibrar(60);
        for (let k = 0; k < 16; k++) {
            const ch = document.createElement('span');
            ch.className = 'chispa-duelo';
            ch.style.left = cx + 'px'; ch.style.top = cy + 'px';
            document.body.appendChild(ch);
            const ang = Math.random() * Math.PI * 2, dist = 40 + Math.random() * 70;
            ch.animate([
                { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
                { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0.3)`, opacity: 0 },
            ], { duration: 500 + Math.random() * 300, easing: 'ease-out' }).onfinish = () => ch.remove();
        }
    }, 1000);
}

// ==========================================
// PANTALLA DE VICTORIA — tabla final
// ==========================================
// El servidor solo manda al ganador, así que el orden de caída se anota aquí
// ronda por ronda: quien cae al último queda 2.º, y así hacia atrás.
let _caidasPartida = [];

function registrarCaidas(datos) {
    const ronda = parseInt(document.getElementById('numRonda')?.innerText || '0', 10) || 0;
    datos.jugadores.forEach(j => {
        if (j.vidas <= 0 && datos.perdedores.includes(j.id) && !_caidasPartida.some(c => c.nombre === j.nombre)) {
            _caidasPartida.push({ id: j.id, nombre: j.nombre, ronda, esBot: !!j.esBot });
        }
    });
}

function pintarFinalPartida(ganador) {
    const rondas = parseInt(document.getElementById('numRonda')?.innerText || '0', 10) || 0;
    const hayGanador = !!ganador.id;
    const gane = hayGanador && ganador.id === socket.id;

    document.getElementById('victoriaResumen').textContent =
        rondas ? `Fin de la partida · ${rondas} ${rondas === 1 ? 'ronda' : 'rondas'}` : 'Fin de la partida';
    document.getElementById('victoriaTitulo').textContent = !hayGanador
        ? 'Nadie se queda con la corona'
        : gane ? '¡Eres el Rey Contento!' : '¡Tenemos un Rey!';
    document.getElementById('pantallaVictoria').classList.toggle('victoria-propia', gane);

    // Tabla: ganador arriba y luego del último en caer al primero.
    const filas = [];
    if (hayGanador) {
        const vidas = ganador.vidas > 0 ? `${ganador.vidas} ${ganador.vidas === 1 ? 'vida' : 'vidas'} en pie` : '';
        filas.push({ lugar: 1, nombre: ganador.nombre, detalle: vidas, esYo: gane });
    }
    // Quienes cayeron en la misma ronda comparten lugar.
    [..._caidasPartida].reverse().forEach((c, i, caidas) => {
        const anterior = filas[filas.length - 1];
        const mismaRonda = i > 0 && caidas[i - 1].ronda === c.ronda;
        const lugar = mismaRonda ? anterior.lugar : filas.length + 1;
        filas.push({ lugar, nombre: c.nombre, detalle: `cayó en la ronda ${c.ronda}`, esYo: c.id === socket.id || c.nombre === miNombreUsuario });
    });

    const tabla = document.getElementById('tablaFinal');
    tabla.innerHTML = filas.map(f => `
        <li class="tabla-final-fila${f.lugar === 1 ? ' es-rey' : ''}${f.esYo ? ' es-yo' : ''}">
            <span class="tabla-final-lugar">${f.lugar}.º</span>
            <span class="tabla-final-nombre">${escapeHTML(f.nombre)}${f.esYo ? ' <em>(tú)</em>' : ''}</span>
            <span class="tabla-final-detalle">${escapeHTML(f.detalle)}</span>
        </li>`).join('');
    tabla.classList.toggle('hidden', filas.length < 2);

    const miLugar = document.getElementById('victoriaMiLugar');
    const mia = filas.find(f => f.esYo);
    miLugar.textContent = mia && !gane ? `Quedaste en ${mia.lugar}.º lugar` : '';
    miLugar.classList.toggle('hidden', !(mia && !gane));

    _caidasPartida = []; // la revancha empieza de cero
}

// ==========================================
// REACCIÓN FLOTANTE
// ==========================================
function mostrarReaccion(jugadorId, emoji) {
    const sillaEl = jugadorId === socket.id
        ? document.getElementById('miSilla')
        : document.querySelector(`[data-jugador-id="${jugadorId}"]`);
    if (!sillaEl) return;

    const rect = sillaEl.getBoundingClientRect();
    const origenX = rect.left + rect.width  / 2;
    const origenY = rect.top  + rect.height / 2;

    // Destino: centro visual del tapete (ligeramente por encima del centro de pantalla)
    const destinoX = window.innerWidth  / 2;
    const destinoY = window.innerHeight * 0.42;

    // Vector hacia el centro, 45% del camino para que no llegue demasiado lejos
    const dx = Math.round((destinoX - origenX) * 0.45);
    const dy = Math.round((destinoY - origenY) * 0.45);

    const el = document.createElement('div');
    el.className = 'reaccion-flotante';
    el.textContent = emoji;
    el.style.left = origenX + 'px';
    el.style.top  = origenY + 'px';
    el.style.setProperty('--dx', dx + 'px');
    el.style.setProperty('--dy', dy + 'px');

    document.body.appendChild(el);
    Sonidos.pop();
    setTimeout(() => el.remove(), 2700);
}

// ==========================================
// RESUMEN DE RONDA
// ==========================================
function mostrarResumenRonda(datos) {
    const panel  = document.getElementById('panelResumenRonda');
    const grid   = document.getElementById('resumenCartas');
    const mortal = document.getElementById('resumenCartaMortal');
    if (!panel) return;

    mortal.textContent = datos.cartaMortal;
    grid.innerHTML = '';

    datos.jugadores.forEach(j => {
        if (j.cartaActual === undefined || j.vidas === undefined) return;
        const pierde = datos.perdedores.includes(j.id);
        // Ocultar jugadores ya eliminados antes de esta ronda
        // (los que perdieron esta ronda sí aparecen: pierde=true, vidas puede ser 0)
        if (j.vidas <= 0 && !pierde) return;
        const num    = j.cartaActual;
        const color  = num === 9 ? 'var(--oro)' : num === 0 ? '#85c1e9' : 'var(--pergamino)';

        const item = document.createElement('div');
        item.className = 'resumen-carta-item';
        item.innerHTML = `
            <div class="resumen-carta-cara ${pierde ? 'pierde' : 'sobrevive'}">
                <div style="font-size:22px;font-weight:bold;color:${color};line-height:1;">${num}</div>
                <div style="line-height:1;margin-top:1px;">${figuraIMG(num, 16)}</div>
                <div style="font-size:7px;color:rgba(255,255,255,0.45);margin-top:2px;padding:0 2px;line-height:1.1;">${nombresCartas[num]}</div>
            </div>
            <div class="resumen-carta-nombre">${escapeHTML(j.nombre)}</div>
            <div style="font-size:11px;">${pierde ? icono('corazon-roto') : icono('check')} ${j.vidas > 0 ? icono('corazon').repeat(j.vidas) : icono('calavera')}</div>
        `;
        grid.appendChild(item);
    });

    const explicacion = document.getElementById('resumenExplicacion');
    if (explicacion) {
        const texto = guiasActivas() ? explicacionRonda(datos) : '';
        explicacion.textContent = texto;
        explicacion.classList.toggle('hidden', !texto);
    }

    const btnSig = document.getElementById('btnSiguienteRondaResumen');
    btnSig.classList.toggle('hidden', datos.juegoTerminado || socket.id !== datos.dealerId);
    // La cuenta se mide desde que el servidor resolvió la ronda, no desde que
    // aparece el resumen (sale ~1–2 s después, tras la revelación).
    const msRestantes = datos.autoSiguienteMs ? datos.autoSiguienteMs - (Date.now() - (datos._recibido || Date.now())) : 0;
    if (msRestantes > 0) iniciarCuentaResumen(msRestantes, socket.id === datos.dealerId);
    else detenerCuentaResumen();

    panel.classList.remove('hidden');
}

// Cuenta regresiva del resumen: cuánto falta para que la siguiente ronda
// empiece sola (el servidor manda autoSiguienteMs en rondaTerminada).
let _cuentaResumen = null; // { fin, total, intervalo }

function iniciarCuentaResumen(ms, soyDealer) {
    detenerCuentaResumen();
    const caja = document.getElementById('resumenCuenta');
    if (!caja || !ms) return;
    _cuentaResumen = { fin: Date.now() + ms, total: ms };
    const barra = document.getElementById('resumenCuentaBarra');
    const pintar = () => {
        if (!_cuentaResumen) return;
        const resta = Math.max(0, _cuentaResumen.fin - Date.now());
        const seg = Math.ceil(resta / 1000);
        document.getElementById('resumenCuentaTexto').innerHTML = seg > 0
            ? `${icono('reloj')} Siguiente ronda en <strong>${seg} s</strong>${soyDealer ? ' · o tócala ya' : ''}`
            : `${icono('espadas')} ¡Empieza la siguiente ronda!`;
        barra.style.width = (resta / _cuentaResumen.total * 100) + '%';
        caja.classList.toggle('urgente', seg <= 3);
    };
    pintar();
    _cuentaResumen.intervalo = setInterval(pintar, 250);
    caja.classList.remove('hidden');
}

function detenerCuentaResumen() {
    if (_cuentaResumen?.intervalo) clearInterval(_cuentaResumen.intervalo);
    _cuentaResumen = null;
    document.getElementById('resumenCuenta')?.classList.add('hidden');
}

function ocultarResumenRonda() {
    detenerCuentaResumen();
    document.getElementById('panelResumenRonda')?.classList.add('hidden');
}

// ==========================================
// MODO ESPECTADOR
// ==========================================
function activarModoEspectador() {
    modoEspectador = true;
    document.getElementById('bannerEspectador').classList.remove('hidden');
    document.getElementById('panelAccionesPartida').classList.add('hidden');
    document.getElementById('btnMantener').style.display = "none";
    document.getElementById('btnCambiar').style.display = "none";
    document.getElementById('btnSiguienteRonda').classList.add('hidden');
    document.getElementById('btnSiguienteRonda').style.display = "none";
    document.getElementById('mesaDeJuego').classList.add('mesa-espectador');
    document.getElementById('mensajeTurno').style.color = 'var(--texto-suave)';
}

function desactivarModoEspectador() {
    modoEspectador = false;
    document.getElementById('bannerEspectador').classList.add('hidden');
    document.getElementById('mesaDeJuego').classList.remove('mesa-espectador');
    document.getElementById('mensajeTurno').style.color = "var(--verde)";
}

// Resetea TODO el estado relacionado con una sala/partida. Llamar al salir de
// una sala, ser expulsado, ganar/perder y volver al lobby, o ser reemplazado
// por otra sesión. Sin este helper, cada call site reseteaba un subconjunto
// distinto de variables → bugs por estado stale al reentrar a otra sala.
// Deja la pantalla en el lobby sin rastro de la partida anterior (mesa,
// footer, victoria, resumen, QR). La usan "Volver al lobby" y el regreso
// forzado cuando la sala ya no existe (p. ej. tras reiniciar el servidor).
function mostrarLobbyLimpio() {
    desactivarModoEspectador();
    document.getElementById('pantallaVictoria').classList.add('hidden');
    // Volver al lobby oculta explícitamente mesa y footer: así nunca quedan
    // visibles junto al lobby (ambos son hermanos dentro de pantallaJuego).
    document.getElementById('mesaDeJuego').classList.add('hidden');
    document.getElementById('panelAccionesPartida').classList.add('hidden');
    document.getElementById('seccion-lobby').classList.remove('hidden');
    document.getElementById('lobbyTabs')?.classList.remove('hidden');
    document.getElementById('panelConfiguracion').classList.remove('hidden');
    document.getElementById('panelUnirse').classList.add('hidden');
    document.getElementById('panelJugadores').classList.add('hidden');
    if (typeof switchTab === 'function') switchTab('crear');
    document.getElementById('mostrarCodigo').classList.add('hidden');
    document.getElementById('mostrarCodigo').style.display = "";
    document.getElementById('codigoDisplay').innerText = "...";
    document.getElementById('btnEmpezar').classList.add('hidden');
    document.getElementById('infoRonda').classList.add('hidden');
    document.getElementById('infoDealer').classList.add('hidden');
    document.getElementById('infoModo').classList.add('hidden');
    document.getElementById('btnEmpezar').style.display = "";

    resetEstadoSala();

    document.getElementById('listaJugadores').innerHTML = "";
    dibujarMesaCircular();
    ocultarResumenRonda();
    ocultarVistaQR();
    ocultarGuiaTurno();
    document.getElementById('coachPractica')?.classList.add('hidden');
    terminarEsperaRapida();
    cerrarPanelFrases();
    // Las coronas de la victoria no deben seguir cayendo sobre el lobby.
    (lanzarCoronasVictoria._timers || []).forEach(clearTimeout);
    lanzarCoronasVictoria._timers = [];
    document.querySelectorAll('.corona-victoria').forEach(el => el.remove());
    cerrarEscaner();
    eventoActual = null; ocultarEvento(); marcarDuelo(false);
    document.getElementById('presentacionDuelo')?.classList.add('hidden');
}

function resetEstadoSala() {
    miSalaActual = "";
    soyElHost = false;
    listaJugadoresGlobal = [];
    turnoActualId = "";
    _cartaPendiente = null;
    mostrandoRevelacion = false;
    perdedoresActuales = [];
    cartasRepartidas = false;
    cartasDescartadas = [];
    pilaRenderizadaCount = 0;
    campanaRingerId = null;
    historialJugadasRonda = [];
    const feed = document.getElementById('miniFeedJugadas');
    if (feed) feed.classList.add('hidden');
    cerrarModalBitacora();
    ++_renderGen; // invalidar cualquier animación pendiente
    desactivarModoEspectador();
}

// ==========================================
// LEADERBOARD
// ==========================================
async function cargarLeaderboard() {
    try {
        const res = await fetch(`${URL_SERVIDOR}/leaderboard`);
        const data = await res.json();
        const medallas = ['🥇','🥈','🥉'];
        const clasesFila = ['fila-oro','fila-plata','fila-bronce'];

        document.getElementById('cuerpoLeaderboard').innerHTML = data.map((j, i) => {
            const winrate = j.partidas_jugadas > 0
                ? Math.round((j.victorias / j.partidas_jugadas) * 100)
                : 0;
            const esTuNombre = j.username === miNombreUsuario;
            const medalla = medallas[i] || `${i+1}.`;
            const claseExtra = clasesFila[i] || '';
            const clasePropio = esTuNombre ? 'fila-propia' : '';
            const rachaHTML = j.racha_actual > 1
                ? `<span class="racha-badge">🔥${j.racha_actual}</span>` : '';
            const rachaMaxHTML = j.racha_maxima > 0
                ? `<span class="racha-max">⚡${j.racha_maxima}</span>` : '';

            return `
            <tr class="fila-leaderboard ${claseExtra} ${clasePropio}" style="animation-delay:${i*80}ms">
                <td class="td-pos">${medalla}</td>
                <td class="td-nombre">${esTuNombre ? '<span class="nombre-propio">'+escapeHTML(j.username)+'</span>' : escapeHTML(j.username)} ${rachaHTML}</td>
                <td class="td-stat">${j.victorias}</td>
                <td class="td-stat">${j.partidas_jugadas}</td>
                <td class="td-stat">${winrate}%</td>
                <td class="td-stat">${rachaMaxHTML || j.racha_maxima}</td>
            </tr>`;
        }).join('');
    } catch (e) { console.error("Error leaderboard"); }
}
cargarLeaderboard();

// Restaurar sesión si hay token guardado y no ha expirado
// restaurarSesion() se llama al final del archivo (ver ahí por qué).


// ==========================================
// PERFIL PERSONAL
// ==========================================
// "hace 5 min", "hace 3 h", "ayer", "12 sep"
function haceCuanto(fecha) {
    const d = new Date(fecha);
    const seg = (Date.now() - d.getTime()) / 1000;
    if (seg < 60) return 'hace un momento';
    if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
    if (seg < 172800) return 'ayer';
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function pintarLogrosPerfil(catalogo, ganados) {
    const conseguidos = new Map(ganados.map(g => [g.logro, g.fecha]));
    document.getElementById('pLogrosCuenta').textContent = `${conseguidos.size} de ${catalogo.length}`;
    document.getElementById('pLogros').innerHTML = catalogo.map(l => {
        const fecha = conseguidos.get(l.id);
        return `<li class="logro${fecha ? ' ganado' : ''}" title="${escapeHTML(l.descripcion)}">
            <span class="logro-icono">${icono(fecha ? l.icono : 'candado')}</span>
            <span class="logro-titulo">${escapeHTML(l.titulo)}</span>
            <span class="logro-desc">${escapeHTML(l.descripcion)}</span>
        </li>`;
    }).join('');
}

const NOMBRE_MODO = { CLASICO: 'Clásico', CAMPANA: 'Campana', RAPIDA: 'Rápida' };

function pintarHistorialPerfil(historial) {
    const lista = document.getElementById('pHistorial');
    if (!historial.length) {
        lista.innerHTML = '<li class="perfil-vacio">Todavía no terminas ninguna partida.</li>';
        return;
    }
    lista.innerHTML = historial.map(h => {
        const gano = h.lugar === 1;
        const detalle = gano ? `${h.rondas} ${h.rondas === 1 ? 'ronda' : 'rondas'}`
            : h.cayo_ronda ? `caíste en la ronda ${h.cayo_ronda}` : 'saliste antes del final';
        return `<li class="${gano ? 'gano' : ''}">
            <span class="hist-lugar">${gano ? icono('corona') : ''}${h.lugar}.º<small> de ${h.jugadores}</small></span>
            <span class="hist-detalle">${escapeHTML(detalle)} · ${NOMBRE_MODO[h.modo] || escapeHTML(h.modo)}</span>
            <span class="hist-fecha">${haceCuanto(h.fecha)}</span>
        </li>`;
    }).join('');
}

async function cargarMiPerfil() {
    const modal = document.getElementById('modalPerfil');
    modal.classList.remove('hidden');
    try {
        const res  = await fetch(`${URL_SERVIDOR}/mis-stats/${encodeURIComponent(miNombreUsuario)}`);
        const data = await res.json();
        document.getElementById('pVictorias').textContent   = data.victorias ?? '—';
        document.getElementById('pPartidas').textContent    = data.partidas_jugadas ?? '—';
        document.getElementById('pWinrate').textContent     = data.winrate != null ? data.winrate + '%' : '—';
        document.getElementById('pRachaActual').textContent = data.racha_actual ?? '—';
        document.getElementById('pRachaMax').textContent    = data.racha_maxima ?? '—';
        pintarLogrosPerfil(data.catalogoLogros || [], data.logros || []);
        pintarHistorialPerfil(data.historial || []);
    } catch { /* sin conexión, los valores quedan en — */ }
}
document.getElementById('btnMiPerfil').addEventListener('click', cargarMiPerfil);
document.getElementById('btnCerrarPerfil').addEventListener('click', () => {
    document.getElementById('modalPerfil').classList.add('hidden');
});

// Event listeners de Bitácora / Mini-feed
const miniFeedEl = document.getElementById('miniFeedJugadas');
if (miniFeedEl) miniFeedEl.addEventListener('click', abrirModalBitacora);

const btnCerrarBit = document.getElementById('btnCerrarBitacora');
if (btnCerrarBit) btnCerrarBit.addEventListener('click', cerrarModalBitacora);

const modalBit = document.getElementById('modalBitacora');
if (modalBit) {
    modalBit.addEventListener('click', (e) => {
        if (e.target === modalBit) cerrarModalBitacora();
    });
}

// Atajos de teclado en la mesa: M mantener, C cambiar, B campana. Hacen lo
// mismo que tocar el botón (que ya ignora el clic si no es tu turno).
const ATAJOS_MESA = { m: 'btnMantener', c: 'btnCambiar', b: 'btnCampana' };

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarModalBitacora();
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const id = ATAJOS_MESA[e.key.toLowerCase()];
    if (!id || document.getElementById('mesaDeJuego')?.classList.contains('hidden')) return;
    const btn = document.getElementById(id);
    if (btn && !btn.disabled && !btn.classList.contains('hidden') && btn.style.display !== 'none') {
        e.preventDefault();
        btn.click();
    }
});

// ==========================================
// AUTH
// ==========================================
async function peticionAuth(ruta) {
    // trim del usuario: en celular el teclado/autocompletar suele agregar un espacio
    // al final, que rompía el login. El password NO se trimea (podría ser válido).
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!username || !password) return alert("Completa los datos.");
    try {
        const res = await fetch(`${URL_SERVIDOR}${ruta}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            if (ruta === '/login') {
                miToken = data.token;
                miNombreUsuario = data.username;
                localStorage.setItem('reyToken', data.token);
                localStorage.setItem('reyUsername', data.username);
                document.getElementById('displayUsername').innerText = miNombreUsuario;
                document.getElementById('seccion-inicio').classList.add('hidden');
                document.getElementById('pantallaJuego').classList.remove('hidden');
                conectarSocket();
            } else if (data.codigoRecuperacion) {
                mostrarCodigoRecuperacion(data.codigoRecuperacion, data.mensaje);
            } else alert(data.mensaje);
        } else alert(data.error);
    } catch (e) { alert("Error de servidor"); }
}

// ==========================================
// CÓDIGO DE RECUPERACIÓN
// ==========================================
function mostrarCodigoRecuperacion(codigo, mensaje = '') {
    document.getElementById('codigoValor').textContent = codigo;
    const m = document.getElementById('codigoMensaje');
    m.textContent = mensaje;
    m.classList.toggle('hidden', !mensaje);
    document.getElementById('modalCodigo').classList.remove('hidden');
}
document.getElementById('btnCodigoGuardado').addEventListener('click', () => document.getElementById('modalCodigo').classList.add('hidden'));
document.getElementById('btnCopiarCodigo').addEventListener('click', async () => {
    const codigo = document.getElementById('codigoValor').textContent;
    try { await navigator.clipboard.writeText(codigo); mostrarToast('Código copiado', 'rey', 1500); }
    catch { mostrarToast('No se pudo copiar: toma una captura de pantalla.', 'danio', 3000); }
});

document.getElementById('btnOlvide').addEventListener('click', () => {
    document.getElementById('recUsuario').value = document.getElementById('authUsername').value.trim();
    document.getElementById('recError').classList.add('hidden');
    document.getElementById('modalRecuperar').classList.remove('hidden');
});
document.getElementById('btnCancelarRecuperar').addEventListener('click', () => document.getElementById('modalRecuperar').classList.add('hidden'));
document.getElementById('btnRecuperar').addEventListener('click', async () => {
    const err = document.getElementById('recError');
    const cuerpo = {
        username: document.getElementById('recUsuario').value.trim(),
        codigo: document.getElementById('recCodigo').value,
        password: document.getElementById('recPassword').value,
    };
    if (!cuerpo.username || !cuerpo.codigo || !cuerpo.password) {
        err.textContent = 'Completa los tres campos.'; err.classList.remove('hidden'); return;
    }
    try {
        const res = await fetch(`${URL_SERVIDOR}/recuperar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
        const data = await res.json();
        if (!res.ok) { err.textContent = data.error || 'No se pudo cambiar la contraseña.'; err.classList.remove('hidden'); return; }
        document.getElementById('modalRecuperar').classList.add('hidden');
        document.getElementById('recCodigo').value = ''; document.getElementById('recPassword').value = '';
        document.getElementById('authUsername').value = data.username;
        document.getElementById('authPassword').value = '';
        // El código usado ya no sirve: se muestra el nuevo.
        mostrarCodigoRecuperacion(data.codigoRecuperacion, data.mensaje + ' Este es tu código nuevo; el anterior ya no sirve.');
    } catch {
        err.textContent = 'Sin conexión con el servidor. Inténtalo de nuevo.'; err.classList.remove('hidden');
    }
});

document.getElementById('btnNuevoCodigo').addEventListener('click', async () => {
    try {
        const res = await fetch(`${URL_SERVIDOR}/codigo-recuperacion`, { method: 'POST', headers: { Authorization: `Bearer ${miToken}` } });
        const data = await res.json();
        if (!res.ok) return mostrarToast(data.error || 'No se pudo generar el código.', 'danio', 3500);
        mostrarCodigoRecuperacion(data.codigoRecuperacion, 'Código nuevo generado. El anterior ya no sirve.');
    } catch { mostrarToast('Sin conexión con el servidor.', 'danio', 3000); }
});

document.getElementById('btnLogin').addEventListener('click', () => peticionAuth('/login'));
document.getElementById('btnRegistro').addEventListener('click', () => peticionAuth('/registro'));
document.getElementById('btnVerReglas').addEventListener('click', () => document.getElementById('modalReglas').classList.remove('hidden'));
document.getElementById('btnCerrarReglas').addEventListener('click', () => document.getElementById('modalReglas').classList.add('hidden'));

const btnSonido = document.getElementById('btnToggleSonido');
if (btnSonido) {
    btnSonido.innerHTML = icono(Sonidos.estaHabilitado() ? 'altavoz' : 'silencio');
    btnSonido.onclick = () => {
        const activo = Sonidos.toggle();
        btnSonido.innerHTML = icono(activo ? 'altavoz' : 'silencio');
        mostrarToast(activo ? '🔊 Sonido activado' : '🔇 Sonido silenciado', 'rey', 1500);
        if (activo) Sonidos.pop();
    };
}

const btnRapida = document.getElementById('btnRapida');
if (btnRapida) btnRapida.onclick = () => { if (socket?.connected) empezarRapida(); };

const btnPractica = document.getElementById('btnPractica');
if (btnPractica) {
    pintarBotonPractica();
    btnPractica.onclick = () => { if (socket?.connected) empezarPractica(); };
}
document.getElementById('coachSalir')?.addEventListener('click', terminarPractica);

const btnGuias = document.getElementById('btnToggleGuias');
if (btnGuias) {
    pintarBotonGuias();
    btnGuias.onclick = () => {
        const prender = !guiasActivas();
        escribirLS('reyGuias', prender ? 'on' : 'off');
        pintarBotonGuias();
        mostrarToast(prender ? '💡 Guías activadas' : '💡 Guías apagadas', 'rey', 1500);
        if (!prender) {
            ocultarGuiaTurno();
            document.getElementById('bannerObjetivo')?.classList.add('hidden');
        }
    };
}

// ==========================================
// GESTOS TÁCTILES EN LA CARTA (Swipe & Drag)
// ==========================================
let _gestosInicializados = false;
function inicializarGestosCarta(onMantener, onCambiar) {
    if (_gestosInicializados) return;
    _gestosInicializados = true;

    const carta = document.getElementById('miCarta');
    if (!carta) return;

    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    let isDragging = false;
    let umbralSonado = false;
    let ultimoToque = 0; // para el doble toque = MANTENER

    function sePuedeJugar() {
        const btnCambiar = document.getElementById('btnCambiar');
        return turnoActualId === socket?.id && btnCambiar && !btnCambiar.disabled && btnCambiar.style.display !== 'none';
    }

    carta.addEventListener('pointerdown', (e) => {
        if (!sePuedeJugar()) return;
        if (e.button !== 0) return; // solo click o touch principal
        isDragging = true;
        umbralSonado = false;
        startX = e.clientX;
        startY = e.clientY;
        currentX = startX;
        currentY = startY;
        try { carta.setPointerCapture(e.pointerId); } catch (err) {}
        carta.classList.remove('soltando', 'lanzada-derecha', 'mantenida-tap');
        carta.classList.add('arrastrando');
    });

    carta.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        currentX = e.clientX;
        currentY = e.clientY;
        const dx = currentX - startX;
        const dy = currentY - startY;

        // Limitar rotación para feel natural de naipe físico
        const rot = Math.max(-12, Math.min(22, dx * 0.12));
        carta.style.transform = `translate(${dx}px, ${dy * 0.35}px) rotate(${rot}deg) scale(1.05)`;

        // Feedback háptico/sonoro cuando cruza el umbral de 70px hacia la derecha
        if (dx >= 70 && !umbralSonado) {
            umbralSonado = true;
            vibrar(25);
            Sonidos.pop();
            carta.style.filter = 'drop-shadow(0 0 16px rgba(241,196,15,0.95))';
        } else if (dx < 70 && umbralSonado) {
            umbralSonado = false;
            carta.style.filter = '';
        }
    });

    const finalizarArrastre = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try { carta.releasePointerCapture(e.pointerId); } catch (err) {}
        carta.classList.remove('arrastrando');
        carta.style.filter = '';

        const dx = currentX - startX;
        const dy = currentY - startY;

        if (dx >= 70 && sePuedeJugar()) {
            // Gesto CAMBIAR: lanzar hacia la derecha
            carta.classList.add('lanzada-derecha');
            if (typeof onCambiar === 'function') onCambiar();
            setTimeout(() => {
                carta.classList.remove('lanzada-derecha');
                carta.style.transform = '';
            }, 360);
        } else if (dy >= 55 && Math.abs(dx) < 35 && sePuedeJugar()) {
            // Gesto hacia abajo: MANTENER
            carta.style.transform = '';
            if (typeof onMantener === 'function') onMantener();
        } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
            // Un toque sin arrastrar. Dos toques seguidos (< 350 ms) = MANTENER.
            carta.classList.add('soltando');
            carta.style.transform = '';
            setTimeout(() => { carta.classList.remove('soltando'); }, 260);
            const ahora = Date.now();
            if (ahora - ultimoToque < 350 && sePuedeJugar()) {
                ultimoToque = 0;
                if (typeof onMantener === 'function') onMantener();
            } else {
                ultimoToque = ahora;
            }
        } else {
            // Regresar elásticamente a su posición original
            carta.classList.add('soltando');
            carta.style.transform = '';
            setTimeout(() => { carta.classList.remove('soltando'); }, 260);
        }
    };

    carta.addEventListener('pointerup', finalizarArrastre);
    carta.addEventListener('pointercancel', finalizarArrastre);
}

// ==========================================
// COMPARTIR SALA (link + QR)
// ==========================================
// Link de invitación: IP pública fija (no window.location.origin) para que el QR
// sirva aunque el host haya entrado por localhost. /sala/:id redirige a /?sala=:id.
function linkDeSala() {
    return `http://34.204.215.13:4000/sala/${miSalaActual}`;
}

// Renderiza el QR del link de sala y abre el overlay. qrcodejs es `async`: si aún
// no cargó (o falló), mostramos un fallback y el usuario usa "Copiar link".
function mostrarVistaQR() {
    const cont = document.getElementById('qrContenedor');
    document.getElementById('qrCodigo').innerText = miSalaActual || '-----';
    cont.innerHTML = ''; // qrcodejs no limpia el contenedor por sí mismo
    if (typeof QRCode !== 'undefined') {
        new QRCode(cont, {
            text: linkDeSala(),
            width: 220, height: 220,
            colorDark: '#1a1212', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    } else {
        cont.innerHTML = '<div style="font-size:12px;color:#7f8c8d;padding:24px;">No se pudo cargar el generador de QR.<br>Usa el botón "Copiar enlace".</div>';
    }
    // "Empezar" desde el QR solo si soy el host.
    document.getElementById('btnEmpezarQR').classList.toggle('hidden', !soyElHost);
    document.getElementById('vistaQR').classList.remove('hidden');
}

function ocultarVistaQR() {
    document.getElementById('vistaQR')?.classList.add('hidden');
}

// ==========================================
// RELOJ VISUAL
// ==========================================
function gestionarRelojVisual(idEnTurno, tiempoSegundos) {
    if (intervaloVisual) clearInterval(intervaloVisual);
    const cont = document.getElementById('contenedorReloj');
    const barra = document.getElementById('barraReloj');
    const foco = document.getElementById('focoTurno');
    foco?.classList.remove('reloj-urgente');
    const tiempoTotal = tiempoSegundos || 10;
    let t = tiempoTotal;
    cont.style.display = 'inline-block';
    document.getElementById('segundosReloj').innerText = t;
    barra.style.width = '100%';
    barra.style.background = '#e67e22';
    intervaloVisual = setInterval(() => {
        t--;
        document.getElementById('segundosReloj').innerText = t;
        const pct = (t / tiempoTotal) * 100;
        barra.style.width = pct + '%';
        if (t <= 3) {
            barra.style.background = '#e74c3c';
            document.getElementById('segundosReloj').style.color = '#ff8a7a';
            if (idEnTurno === socket?.id && t > 0) {
                foco?.classList.add('reloj-urgente');
                Sonidos.tick();
                vibrar(35);
            }
        } else {
            barra.style.background = '#e67e22';
            document.getElementById('segundosReloj').style.color = '#ffb36b';
            foco?.classList.remove('reloj-urgente');
        }
        if (t <= 0) {
            clearInterval(intervaloVisual);
            cont.style.display = 'none';
            foco?.classList.remove('reloj-urgente');
        }
    }, 1000);
}

// ==========================================
// POC TWEEN.js — VUELO DE CARTA
// ==========================================
// Ticker global: TWEEN necesita que algo llame a TWEEN.update() en cada frame.
// El loop corre SIEMPRE y consulta TWEEN adentro: como el script de TWEEN es
// `async`, puede no estar definido cuando main.js carga; así, en cuanto aparece,
// el ticker ya está corriendo y lo empieza a actualizar. Barato cuando no hay
// tweens (update recorre 0). Si TWEEN nunca carga, el loop no hace nada.
(function tickTween(t) {
    if (typeof TWEEN !== 'undefined') TWEEN.update(t);
    requestAnimationFrame(tickTween);
})();

// Anima la entrada (vuelo) de la carta propia con TWEEN.js y, al terminar, ejecuta
// `onComplete` (revelar número + flip + reloj). Reemplaza el keyframe CSS `volarAbajo`
// + `setTimeout(600)`. Respeta el guard `_renderGen`: si llega otro evento de turno,
// `_renderGen` cambia y abortamos sin pisar el DOM. Degrada al comportamiento previo
// si la librería no cargó (CDN bloqueado).
function animarVueloCartaTween(el, gen, onComplete) {
    if (typeof TWEEN === 'undefined') {
        void el.offsetWidth; // forzar reflow para reiniciar el keyframe CSS
        el.classList.add('volar-desde-centro-bottom');
        setTimeout(() => { if (gen === _renderGen) onComplete(); }, 600);
        return;
    }
    if (_tweenCarta) { _tweenCarta.stop(); _tweenCarta = null; }
    // No mezclar con el keyframe CSS: manejamos transform por estilo inline.
    el.classList.remove('volar-desde-centro-bottom');

    // Vuelo limpio: deslizar desde arriba + escalar con rebote, SIN rotación en Z.
    // El spin competía con el flip (rotateY de .flipper al revelar) y se percibía
    // como un "doble reparto". Esto replica el feel del keyframe volarAbajo, pero
    // movido por TWEEN (que habilita encadenar/escalonar el reparto a futuro).
    const estado = { y: -250, scale: 0.2, opacity: 0 };
    const aplicar = () => {
        el.style.opacity = estado.opacity;
        el.style.transform = `translateY(${estado.y}px) scale(${estado.scale})`;
    };
    aplicar();

    Sonidos.carta();
    _tweenCarta = new TWEEN.Tween(estado)
        .to({ y: 0, scale: 1, opacity: 1 }, 600)
        .easing(TWEEN.Easing.Back.Out) // rebote suave al aterrizar, como el cubic-bezier original
        .onUpdate(() => { if (gen === _renderGen) aplicar(); })
        .onComplete(() => {
            _tweenCarta = null;
            if (gen !== _renderGen) return;
            // Limpiar transform inline: el flip vive en .flipper (hijo), no acá.
            el.style.transform = '';
            el.style.opacity = '';
            onComplete();
        })
        .start();
}

// Reparto escalonado: cartas "fantasma" (overlay position:fixed) vuelan desde el
// mazo hacia cada asiento de oponente, una por una. Es ADITIVO — no toca el DOM
// de dibujarMesaCircular. Cada carta real boca-abajo (.perfil-carta-reverso) se
// oculta hasta que su fantasma aterriza, así se ve "dealing" en vez de aparecer.
// Reemplaza el vuelo CSS simultáneo de oponentes (volar-desde-centro-*), por eso
// ese se desactiva en dibujarMesaCircular. Fire-and-forget: si la ronda cambia,
// los fantasmas igual completan y se autoeliminan (referencian nodos viejos, sin
// efecto sobre el render nuevo).
const STAGGER_REPARTO_MS = 130;
// IDs de jugadores cuya carta está "en vuelo" durante el reparto. dibujarMesaCircular
// consulta este set: si re-renderiza un asiento mientras su fantasma aún vuela (p.ej.
// el dibujo de juegoIniciado ~700ms después de datosMesa), pinta el reverso oculto
// (opacity:0). Sin esto, el reverso real reaparecía encimado al fantasma en vuelo.
let _repartiendo = new Set();

// Devuelve el reverso boca-abajo VIGENTE de un jugador (re-consultando el DOM, porque
// el asiento pudo re-renderizarse desde que arrancó el reparto). null si no existe.
function _reversoActualDe(jugadorId) {
    const silla = Array.from(document.querySelectorAll('.silla:not(.hidden)'))
        .find(s => s.dataset.jugadorId === jugadorId);
    return silla ? silla.querySelector('.perfil-carta-reverso') : null;
}

function repartirCartasEscalonado() {
    if (typeof TWEEN === 'undefined') return; // sin librería: cartas ya visibles
    const mazo = document.getElementById('mazoFlotante');
    if (!mazo || mazo.classList.contains('hidden')) return;
    const origen = mazo.getBoundingClientRect();

    // Orden de reparto: EMPIEZA por el dealer y va alrededor de la mesa. El mazo
    // se para sobre el asiento del dealer, así que su carta "sale de arriba del
    // mazo" primero (viaje corto, natural) y la secuencia termina en un oponente
    // lejano con un vuelo largo y vistoso — en vez de terminar en el dealer, donde
    // los dorsos del mazo ya están y el reparto a sí mismo casi no se movía (se veía
    // estático). Cada asiento expone su jugador en dataset.jugadorId.
    const jugadores = listaJugadoresGlobal || [];
    const n = jugadores.length;
    const dealerIdx = jugadores.findIndex(j => j.dealer);
    const inicio = (dealerIdx === -1 ? 0 : dealerIdx);
    const porId = new Map(
        Array.from(document.querySelectorAll('.silla:not(.hidden)'))
            .map(s => [s.dataset.jugadorId, s])
    );
    const orden = [];
    for (let k = 0; k < n; k++) {
        const jug = jugadores[(inicio + k) % n];
        if (!jug || jug.id === socket.id) continue; // mi carta la maneja juegoIniciado
        const silla = porId.get(jug.id);
        if (silla) orden.push({ jug, silla });
    }

    orden.forEach(({ jug, silla }, i) => {
        const reverso = silla.querySelector('.perfil-carta-reverso');
        if (!reverso) return; // oponente revelado o muerto: sin carta boca-abajo
        const destino = reverso.getBoundingClientRect();
        _repartiendo.add(jug.id);     // re-renders mantienen el reverso oculto
        reverso.style.opacity = '0';  // ocultar la real hasta que aterrice el fantasma

        const ghost = document.createElement('div');
        ghost.className = 'perfil-carta-reverso';
        // z-index 40: por encima de la mesa (sillas ≤20) para que la carta "vuele"
        // sobre los asientos, pero por debajo del chrome (paneles/toasts/modales ≥50).
        // opacity:0 + transform inicial: el fantasma queda OCULTO durante su delay de
        // stagger. Sin esto, todos los fantasmas se creaban a la vez y quedaban
        // visibles parados sobre el mazo esperando su turno —y con el tamaño del
        // asiento destino, no del mazo, así que se notaba la diferencia. onStart lo
        // hace visible recién cuando arranca su vuelo.
        ghost.style.cssText =
            `position:fixed;left:${origen.left}px;top:${origen.top}px;` +
            `width:${destino.width}px;height:${destino.height}px;` +
            `margin:0;z-index:40;pointer-events:none;opacity:0;` +
            `transform:translate(0,0) scale(0.6);`;
        document.body.appendChild(ghost);

        const dx = destino.left - origen.left;
        const dy = destino.top - origen.top;
        const estado = { p: 0, scale: 0.6 };
        new TWEEN.Tween(estado)
            .to({ p: 1, scale: 1 }, 360)
            .delay(i * STAGGER_REPARTO_MS)
            .easing(TWEEN.Easing.Quadratic.Out)
            .onStart(() => {
                ghost.style.opacity = '1';
                Sonidos.carta();
            }) // visible al arrancar su vuelo
            .onUpdate(() => {
                ghost.style.transform =
                    `translate(${dx * estado.p}px, ${dy * estado.p}px) scale(${estado.scale})`;
            })
            .onComplete(() => {
                ghost.remove();
                _repartiendo.delete(jug.id);
                // Revelar el reverso VIGENTE (el asiento pudo re-renderizarse).
                const rev = _reversoActualDe(jug.id);
                if (rev) rev.style.opacity = '';
            })
            .start();
    });
}

// ==========================================
// MOTOR VISUAL DE LA MESA
// ==========================================
function dibujarMesaCircular() {
    if (!listaJugadoresGlobal || listaJugadoresGlobal.length === 0) return;

    // Limpiar TODAS las sillas posibles, no solo las 3 cardinales. Sin esto,
    // las sillas diagonales conservan el render previo cuando el número de
    // oponentes baja (p.ej. 7 → 3, las 4 esquinas quedan visibles con basura).
    const TODAS_LAS_SILLAS = [
        'silla-top', 'silla-left', 'silla-right',
        'silla-top-left', 'silla-top-right',
        'silla-bottom-left', 'silla-bottom-right'
    ];
    TODAS_LAS_SILLAS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.innerHTML = ""; el.classList.add('hidden'); }
    });

    let miIndex = listaJugadoresGlobal.findIndex(j => j.id === socket.id);
    if (miIndex === -1) miIndex = 0;

    let miJugador = listaJugadoresGlobal[miIndex];
    let miSilla = document.getElementById('miSilla');
    let miCarta = document.getElementById('miCarta');
    let miPerfil = document.getElementById('miPerfil');
    // Si falta el HTML local del jugador, abortar — no tiene sentido seguir.
    if (!miSilla || !miCarta || !miPerfil) return;

    const nombreMesa = document.getElementById('miNombreMesa');
    const vidasMesa = document.getElementById('misVidasMesa');
    if (nombreMesa) nombreMesa.innerHTML = icono(miJugador.dealer ? 'corona' : 'persona') + ' ' + escapeHTML(miJugador.nombre);
    if (vidasMesa) vidasMesa.innerHTML = miJugador.vidas > 0 ? icono('corazon') + ' ' + miJugador.vidas : icono('calavera') + ' 0';

    if (miJugador.vidas <= 0) {
        miSilla.classList.add('jugador-eliminado');
        miPerfil.classList.add('jugador-eliminado');
        if (modoEspectador) {
            miCarta.style.display = "block";
            miCarta.classList.add('flipped');
        } else {
            miCarta.style.display = "none";
        }
    } else {
        miSilla.classList.remove('jugador-eliminado');
        miPerfil.classList.remove('jugador-eliminado');
        miCarta.style.display = "block";
    }

    miSilla.classList.remove('turno-activo', 'jugador-opaco', 'vida-critica');
    if (!mostrandoRevelacion) miCarta.classList.remove('danio-recibido');
    if (miJugador.vidas === 1) miSilla.classList.add('vida-critica');
    if (miJugador.vidas > 0 && turnoActualId !== "") {
        if (turnoActualId === socket.id) {
            miSilla.classList.add('turno-activo');
            if (!mostrandoRevelacion) miCarta.classList.add('arrastrable');
        } else {
            miSilla.classList.add('jugador-opaco');
            miCarta.classList.remove('arrastrable');
        }
    } else {
        miCarta.classList.remove('arrastrable');
    }

    if (turnoActualId === socket.id && miJugador.vidas > 0) {
        miPerfil.style.borderColor = 'var(--oro)';
        miPerfil.style.boxShadow = '0 0 0 2px #fff, 0 0 0 3px var(--oro), 0 0 15px rgba(241,196,15,1), 0 0 30px rgba(241,196,15,0.7)';
    } else {
        miPerfil.style.borderColor = '';
        miPerfil.style.boxShadow = '';
    }

    // ← Mazo junto al dealer si soy yo

    let oponentes = [];
    for (let i = 1; i < listaJugadoresGlobal.length; i++) {
        oponentes.push(listaJugadoresGlobal[(miIndex + i) % listaJugadoresGlobal.length]);
    }

    let numOp = oponentes.length;

    // Tamaño adaptable de las cartas boca-abajo: más grandes con pocos oponentes,
    // se achican cuando la mesa se llena para que entren sin encimarse. Se aplica
    // como variables CSS en :root, así las usan tanto los asientos como el mazo
    // (que hereda .perfil-carta-reverso) y siguen coincidiendo entre sí.
    const esCelular = window.innerWidth <= 768;
    let reversoW;
    if (numOp <= 2)       reversoW = esCelular ? 38 : 52;
    else if (numOp <= 4)  reversoW = esCelular ? 32 : 46;
    else if (numOp === 5) reversoW = esCelular ? 28 : 42;
    else                  reversoW = esCelular ? 24 : 36; // 6-7 oponentes
    const reversoH = Math.round(reversoW * 1.5); // relación 2:3 (0.667)
    const root = document.documentElement.style;
    root.setProperty('--reverso-w', reversoW + 'px');
    root.setProperty('--reverso-h', reversoH + 'px');

    // Mismo criterio para TU carta principal (#miCarta) y las reveladas de oponentes
    // (.mini-carta-frente): con pocos jugadores se agrandan y aprovechan el espacio;
    // con la mesa llena se achican. El número y la figura escalan con la carta.
    let cartaW, miniW;
    if (numOp <= 2)       { cartaW = esCelular ? 96 : 104; miniW = esCelular ? 58 : 64; }
    else if (numOp <= 4)  { cartaW = esCelular ? 84 : 92;  miniW = esCelular ? 52 : 58; }
    else if (numOp === 5) { cartaW = esCelular ? 76 : 84;  miniW = esCelular ? 48 : 54; }
    else                  { cartaW = esCelular ? 68 : 76;  miniW = esCelular ? 44 : 50; } // 6-7
    root.setProperty('--carta-w', cartaW + 'px');
    root.setProperty('--carta-h', Math.round(cartaW * 1.46) + 'px');
    root.setProperty('--carta-num', Math.round(cartaW * 0.52) + 'px'); // número
    root.setProperty('--carta-fig', Math.round(cartaW * 0.60) + 'px'); // figura
    root.setProperty('--mini-w', miniW + 'px');
    root.setProperty('--mini-h', Math.round(miniW * 1.5) + 'px');

    // Pila central de descarte: adapta a pantalla Y cantidad de jugadores (más
    // grande con pocos —hay más espacio libre al centro— y más chica con la mesa llena).
    let pilaW;
    if (numOp <= 2)       pilaW = esCelular ? 42 : 52;
    else if (numOp <= 4)  pilaW = esCelular ? 37 : 46;
    else if (numOp === 5) pilaW = esCelular ? 33 : 42;
    else                  pilaW = esCelular ? 30 : 38; // 6-7
    root.setProperty('--pila-w', pilaW + 'px');
    root.setProperty('--pila-h', Math.round(pilaW * 1.42) + 'px');

    let idsSillas = [];
    if (numOp === 1) idsSillas = ['silla-top'];
    else if (numOp === 2) idsSillas = ['silla-left', 'silla-right'];
    else if (numOp === 3) idsSillas = ['silla-left', 'silla-top', 'silla-right'];
    else if (numOp === 4) idsSillas = ['silla-left', 'silla-top-left', 'silla-top-right', 'silla-right'];
    else if (numOp === 5) idsSillas = ['silla-left', 'silla-top-left', 'silla-top', 'silla-top-right', 'silla-right'];
    else if (numOp === 6) idsSillas = ['silla-bottom-left', 'silla-left', 'silla-top-left', 'silla-top-right', 'silla-right', 'silla-bottom-right'];
    else if (numOp === 7) idsSillas = ['silla-bottom-left', 'silla-left', 'silla-top-left', 'silla-top', 'silla-top-right', 'silla-right', 'silla-bottom-right'];

    // Calcular a quién le cambiaría yo si es mi turno (vecino derecho activo)
    let idObjetivoDerecha = null;
    const esMiTurno = (turnoActualId === socket.id && miJugador.vidas > 0 && !mostrandoRevelacion);
    if (esMiTurno && !miJugador.dealer) {
        let derIdx = miIndex;
        let intentos = 0;
        do {
            derIdx = (derIdx + 1) % listaJugadoresGlobal.length;
            intentos++;
        } while (listaJugadoresGlobal[derIdx]?.vidas <= 0 && intentos < listaJugadoresGlobal.length);
        if (listaJugadoresGlobal[derIdx] && listaJugadoresGlobal[derIdx].id !== campanaRingerId) {
            idObjetivoDerecha = listaJugadoresGlobal[derIdx].id;
        }
    }

    oponentes.forEach((op, i) => {
        // Guard: si idsSillas[i] es undefined (numOp fuera de rango soportado)
        // o el elemento HTML no existe, saltar este oponente en vez de crashear.
        const idSilla = idsSillas[i];
        if (!idSilla) return;
        let divSilla = document.getElementById(idSilla);
        if (!divSilla) return;
        divSilla.classList.remove('hidden');

        let esSuTurno = (turnoActualId === op.id);
        let estaMuerto = (op.vidas <= 0);
        let claseDanio = (mostrandoRevelacion && perdedoresActuales.includes(op.id)) ? 'danio-recibido' : '';
        let animReparto = cartasRepartidas ? '' : 'animacion-reparto';
        // El vuelo de entrada de oponentes lo maneja repartirCartasEscalonado()
        // (fantasmas TWEEN desde el mazo). Se desactiva el vuelo CSS simultáneo
        // para no duplicar la animación.
        let claseVuelo = '';

        const esObjetivo = (idObjetivoDerecha !== null && op.id === idObjetivoDerecha);
        const claseObjetivo = esObjetivo ? 'objetivo-intercambio' : '';
        const claseVidaCritica = (op.vidas === 1 && !estaMuerto) ? 'vida-critica' : '';
        divSilla.className = `silla ${idSilla.replace('silla-', '')} ${esSuTurno ? 'turno-activo' : ''} ${claseVidaCritica} ${claseObjetivo}`.trim();
        divSilla.dataset.jugadorId = op.id;

        let cartaHTML = '';
        if (op.vidas > 0 || (mostrandoRevelacion && perdedoresActuales.includes(op.id))) {
            if (mostrandoRevelacion && op.cartaActual !== undefined) {
                let extra = (op.cartaActual === 0) ? 'mini-carta-0' : (op.cartaActual === 9) ? 'mini-carta-9' : '';
                cartaHTML = `
                    <div class="mini-carta-frente ${extra} ${claseDanio} efecto-revelar" style="${estiloRevelar(op.id)}">
                        <div style="font-size:34px;font-weight:bold;line-height:1;">${op.cartaActual}</div>
                        <div style="line-height:1;margin-top:2px;">${figuraIMG(op.cartaActual, 22)}</div>
                        <div style="font-size:11px;text-align:center;line-height:1.1;margin-top:4px;">${nombresCartas[op.cartaActual]}</div>
                    </div>`;
            } else if (op.vidas > 0) {
                const debeRevelar = ((op.cartaRevelada === true) || (modoReyActual === 'DECLARADO' && op.cartaActual === 9))
                    && performance.now() >= _reyOcultoHasta; // en DECLARADO se voltea a los 2 s del reparto
                if (debeRevelar && op.cartaActual !== undefined) {
                    let extra = op.cartaActual === 9 ? 'mini-carta-9' : op.cartaActual === 0 ? 'mini-carta-0' : '';
                    cartaHTML = `
                        <div class="mini-carta-frente ${extra}" style="border:2px solid var(--oro);box-shadow:0 0 15px rgba(241,196,15,0.8);">
                            <div style="font-size:34px;font-weight:bold;line-height:1;">${op.cartaActual}</div>
                            <div style="line-height:1;margin-top:2px;">${figuraIMG(op.cartaActual, 22)}</div>
                            <div style="font-size:11px;text-align:center;line-height:1.1;margin-top:4px;">${nombresCartas[op.cartaActual]}</div>
                        </div>`;
                } else {
                    // Si la carta está en vuelo (reparto escalonado), pintar el
                    // reverso oculto para que no aparezca encimado al fantasma.
                    const estiloReparto = _repartiendo.has(op.id) ? ' style="opacity:0"' : '';
                    cartaHTML = `<div class="perfil-carta-reverso ${claseVuelo}"${estiloReparto}></div>`;
                }
            }
        }

        const iconoAsiento = op.dealer ? icono('corona') : (esSuTurno ? icono('espadas') : (op.esBot ? icono('bot') : icono('persona')));
        let claseEstado = estaMuerto ? 'jugador-eliminado' : '';

        divSilla.innerHTML = `
            <div class="perfil-oponente ${claseEstado} ${animReparto} ${claseDanio}">
                <div style="font-size:13px;font-weight:bold;line-height:1.2;word-wrap:break-word;">${iconoAsiento} ${escapeHTML(op.nombre)}</div>
                <span class="vidas-destacadas">${estaMuerto ? icono('calavera') + ' 0' : icono('corazon') + ' ' + op.vidas}</span>
            </div>
            ${cartaHTML}
        `;
    });

    // Posicionar mazoFlotante junto al dealer (independiente de las sillas, no hereda opacidad)
    const mazoFlotante = document.getElementById('mazoFlotante');
    const mesaDeJuego = document.getElementById('mesaDeJuego');
    if (mazoFlotante) {
        const dealer = listaJugadoresGlobal.find(j => j.dealer);
        const juegoActivo = mesaDeJuego && !mesaDeJuego.classList.contains('hidden');
        if (dealer && juegoActivo) {
            // Quitar clases de posición anteriores
            mazoFlotante.className = mazoFlotante.className.replace(/pos-\S+/g, '').replace('objetivo-mazo', '').trim();
            if (dealer.id === socket.id) {
                mazoFlotante.classList.add('pos-bottom');
                if (esMiTurno) mazoFlotante.classList.add('objetivo-mazo');
            } else {
                const idx = oponentes.findIndex(o => o.id === dealer.id);
                if (idx !== -1 && idsSillas[idx]) {
                    const pos = idsSillas[idx].replace('silla-', '');
                    mazoFlotante.classList.add(`pos-${pos}`);
                }
            }
            mazoFlotante.classList.remove('hidden');
        } else {
            mazoFlotante.classList.add('hidden');
        }
    }

    if (mesaDeJuego && !mesaDeJuego.classList.contains('hidden')) {
        cartasRepartidas = true;
    }
}

// ==========================================
// SOCKETS
// ==========================================
// Reconectar cuando el teléfono se desbloquea o la pestaña vuelve a ser visible
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && unirseVisible()) window.alAbrirUnirse();
    if (document.visibilityState === 'visible' && miToken && socket && !socket.connected) {
        socket.connect();
    }
});

// Recalcular mesa circular al redimensionar pantalla o girar el teléfono
let _resizeTimer = null;
window.addEventListener('resize', () => {
    // La flecha guía se calcula con posiciones en pantalla: al girar el
    // celular quedaría apuntando a un lugar viejo, así que se esconde.
    document.getElementById('flechaGuia')?.classList.add('hidden');
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
        const mesa = document.getElementById('mesaDeJuego');
        if (mesa && !mesa.classList.contains('hidden') && listaJugadoresGlobal && listaJugadoresGlobal.length > 0) {
            dibujarMesaCircular();
        }
    }, 150);
});
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        const mesa = document.getElementById('mesaDeJuego');
        if (mesa && !mesa.classList.contains('hidden') && listaJugadoresGlobal && listaJugadoresGlobal.length > 0) {
            dibujarMesaCircular();
        }
    }, 250);
});

function conectarSocket() {
    // Si ya existía un socket (re-login después de connect_error o sesionReemplazada)
    // limpiarle todos los listeners y desconectarlo. Sin esto, los handlers viejos
    // quedan colgados emitiendo eventos contra DOM que ya no representa su sesión.
    if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
    }

    socket = io(URL_SERVIDOR, {
        auth: { token: miToken },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1500,
        reconnectionDelayMax: 8000,
        timeout: 20000
    });

    socket.on('connect_error', (err) => {
        // Token inválido o expirado — limpiar sesión y mostrar login
        if (err.message?.includes('Token') || err.message?.includes('Acceso')) {
            localStorage.removeItem('reyToken');
            localStorage.removeItem('reyUsername');
            miToken = '';
            miNombreUsuario = '';
            document.getElementById('pantallaJuego').classList.add('hidden');
            document.getElementById('seccion-inicio').classList.remove('hidden');
        }
    });

    // El servidor está bajando para shutdown/restart. Avisamos al usuario con
    // un toast no bloqueante; Socket.io reconecta solo cuando vuelva el server.
    socket.on('servidorReiniciando', (mensaje) => {
        window._servidorReinicio = true;
        mostrarToast('⏳ El servidor se está reiniciando. Espera unos segundos…', 'rey', 5000);
    });

    // El servidor cerró esta sesión porque la cuenta inició desde otra pestaña
    // o dispositivo. Desactivar reconexión automática y volver al lobby inicial.
    socket.on('sesionReemplazada', (mensaje) => {
        socket.io.opts.reconnection = false;
        resetEstadoSala();

        document.getElementById('mesaDeJuego')?.classList.add('hidden');
        document.getElementById('pantallaVictoria')?.classList.add('hidden');
        document.getElementById('seccion-lobby')?.classList.remove('hidden');
        // Reset paneles internos del lobby — sin esto, el usuario queda viendo
        // panelJugadores (lista de la sala) en lugar de la pantalla de crear/unirse.
        document.getElementById('panelJugadores')?.classList.add('hidden');
        document.getElementById('panelUnirse')?.classList.add('hidden');
        document.getElementById('mostrarCodigo')?.classList.add('hidden');
        document.getElementById('lobbyTabs')?.classList.remove('hidden');
        document.getElementById('panelConfiguracion')?.classList.remove('hidden');
        const listaJug = document.getElementById('listaJugadores');
        if (listaJug) listaJug.innerHTML = '';
        if (typeof switchTab === 'function') switchTab('crear');

        alert(mensaje || 'Tu sesión fue reemplazada por otra conexión.');
    });

    socket.on('connect', () => {
        document.getElementById('btnCrearSala').disabled = false;
        // Al reconectar (celular desbloqueado, red caída, reinicio del servidor)
        // volver a la sala si había una. Va en 'connect' porque en Socket.io v4
        // el evento 'reconnect' ya no se emite en el socket, solo en socket.io.
        if (miSalaActual) {
            window._reingresando = true;
            socket.emit('unirseSala', { idSala: miSalaActual });
        }
        const salaPorUrl = sessionStorage.getItem('salaPendienteUrl');
        if (salaPorUrl) {
            sessionStorage.removeItem('salaPendienteUrl');
            setTimeout(() => {
                miSalaActual = salaPorUrl;
                window._joinAutomatico = true;
                socket.emit('unirseSala', { idSala: salaPorUrl });
            }, 500);
        }
    });

    socket.on('partidaPendiente', (idSala) => {
        if (idSala === miSalaActual) return; // ya se está reingresando sola
        const modal = document.createElement('div');
        modal.id = "modalReconexion";
        modal.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;justify-content:center;align-items:center;">
                <div style="background:var(--pergamino);color:var(--texto);padding:30px;border-radius:15px;border:6px solid var(--oro-oscuro);text-align:center;max-width:90%;width:350px;box-shadow:0 0 40px #000;">
                    <h2 class="medieval-font" style="color:var(--rojo-rey);font-size:28px;margin-top:0;">Batalla Inconclusa!</h2>
                    <p style="font-size:18px;font-weight:bold;">Tus tropas te esperan en sala <span style="color:#e67e22;font-size:22px;">${idSala}</span>.</p>
                    <div style="margin-top:25px;display:flex;flex-direction:column;gap:10px;">
                        <button id="btnSiRegresar" style="background:#2ecc71;color:white;font-size:18px;width:100%;">Regresar a la Mesa</button>
                        <button id="btnNoRegresar" style="background:#7f8c8d;color:white;font-size:16px;width:100%;">Huir (Rendirse)</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
        document.getElementById('btnSiRegresar').onclick = () => {
            miSalaActual = idSala;
            socket.emit('unirseSala', { idSala });
            document.body.removeChild(modal);
        };
        document.getElementById('btnNoRegresar').onclick = () => {
            socket.emit('abandonarSala', idSala);
            document.body.removeChild(modal);
        };
    });

    // --- LOBBY ---
    document.getElementById('btnCrearSala').onclick = () => {
        socket.emit('crearSala', {
            configuracion: {
                modoRey: document.getElementById('selectModo').value,
                frecuenciaReyes: document.getElementById('selectReyes').value,
                vidas: parseInt(document.getElementById('selectVidas').value),
                maxJugadores: parseInt(document.getElementById('selectJugadores').value),
                numBots: parseInt(document.getElementById('selectBots').value),
                dificultadBots: document.getElementById('selectDificultadBots').value,
                tiempoTurno: parseInt(document.getElementById('selectTiempoTurno').value),
                eventos: document.getElementById('selectEventos').value !== 'NO',
                modoJuego: document.getElementById('selectModoJuego').value,
                password: document.getElementById('inputPasswordSala').value.trim()
            }
        });
    };

    socket.on('salasAbiertas', pintarSalasAbiertas);

    socket.on('rapidaUnido', ({ idSala, faltanMs }) => {
        miSalaActual = idSala; soyElHost = false;
        terminarEsperaRapida();
        _rapida = { fin: Date.now() + faltanMs };
        document.getElementById('btnEmpezar').classList.add('hidden');
        document.getElementById('lobbyTabs')?.classList.add('hidden');
        document.getElementById('panelConfiguracion').classList.add('hidden');
        document.getElementById('panelUnirse').classList.add('hidden');
        document.getElementById('panelJugadores').classList.remove('hidden');
        document.getElementById('rapidaEspera').classList.remove('hidden');
        // El resumen refleja los selectores del lobby, no la mesa rápida (4 jugadores).
        document.getElementById('resumenConfig')?.classList.add('hidden');
        document.getElementById('mostrarCodigo').classList.remove('hidden'); // para invitar a alguien a tu mesa
        document.getElementById('codigoDisplay').innerText = idSala;
        pintarEsperaRapida();
        _rapida.intervalo = setInterval(pintarEsperaRapida, 1000);
    });

    socket.on('salaCreada', (id) => {
        miSalaActual = id; soyElHost = true;
        if (_practica) { socket.emit('iniciarPartida', id); }
        document.getElementById('mostrarCodigo').classList.remove('hidden');
        document.getElementById('codigoDisplay').innerText = id;
        document.getElementById('btnEmpezar').classList.remove('hidden');
        document.getElementById('lobbyTabs')?.classList.add('hidden');
        document.getElementById('panelConfiguracion').classList.add('hidden');
        document.getElementById('panelUnirse').classList.add('hidden');
        document.getElementById('panelJugadores').classList.remove('hidden');
    });

    document.getElementById('inputCodigo').oninput = function () {
        this.value = this.value.toUpperCase();
    };

    document.getElementById('btnUnirseSala').onclick = () => {
        const codigoInput = document.getElementById('inputCodigo').value.toUpperCase();
        if (codigoInput === "") return alert("Escribe un código primero");
        miSalaActual = codigoInput;
        const pw = document.getElementById('inputPasswordUnirse')?.value.trim() || '';
        socket.emit('unirseSala', { idSala: miSalaActual, password: pw });
        document.getElementById('mostrarCodigo').classList.remove('hidden');
        document.getElementById('codigoDisplay').innerText = miSalaActual;
        document.getElementById('lobbyTabs')?.classList.add('hidden');
        document.getElementById('panelConfiguracion').classList.add('hidden');
        document.getElementById('panelUnirse').classList.add('hidden');
        document.getElementById('panelJugadores').classList.remove('hidden');
    };

    document.getElementById('btnSalirLobby').onclick = () => {
        if (miSalaActual) {
            socket.emit('abandonarSala', miSalaActual);
        }
        resetEstadoSala();
        document.getElementById('panelJugadores').classList.add('hidden');
        document.getElementById('mostrarCodigo').classList.add('hidden');
        document.getElementById('lobbyTabs')?.classList.remove('hidden');
        document.getElementById('panelConfiguracion').classList.remove('hidden');
        document.getElementById('panelUnirse').classList.add('hidden');
        document.getElementById('listaJugadores').innerHTML = '';
        if (typeof switchTab === 'function') switchTab('crear');
    };

    document.getElementById('btnMostrarQR').onclick = mostrarVistaQR;
    document.getElementById('btnVolverQR').onclick = ocultarVistaQR;
    document.getElementById('btnEmpezarQR').onclick = () => {
        ocultarVistaQR();
        socket.emit('iniciarPartida', miSalaActual);
    };

    document.getElementById('btnCopiarLink').onclick = () => {
        const link = linkDeSala();
        const btn = document.getElementById('btnCopiarLink');
        const exito = () => {
            btn.innerText = "¡Copiado!";
            setTimeout(() => { btn.innerText = "🔗 ENLACE"; }, 2000);
        };
        const error = () => {
            btn.innerText = "Error";
            setTimeout(() => { btn.innerText = "🔗 ENLACE"; }, 2000);
        };

        // navigator.clipboard solo existe en contexto seguro (HTTPS o localhost).
        // En HTTP plano caemos al fallback con execCommand.
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(link).then(exito).catch(error);
        } else {
            const ta = document.createElement('textarea');
            ta.value = link;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy') ? exito() : error();
            } catch {
                error();
            }
            document.body.removeChild(ta);
        }
    };

    socket.on('actualizarLobby', (datos) => {
        window._reingresando = false; window._servidorReinicio = false;
        const jugadores = Array.isArray(datos) ? datos : datos.jugadores;
        const maxJug = (datos && datos.maxJugadores) ? datos.maxJugadores : parseInt(document.getElementById('selectJugadores')?.value || 8);
        setTimeout(pintarEsperaRapida, 0);

        listaJugadoresGlobal = jugadores.map(j =>
            j.nombre === miNombreUsuario ? { ...j, id: socket.id } : j
        );

        // Re-evaluar host: jugadores[0] siempre es el host (el server splicea al
        // que abandona). Si yo soy ahora jugadores[0] aunque no haya creado la
        // sala, me toca empezar la partida. Sin esto, si el host abandona, la
        // sala queda sin nadie que pueda apretar "Empezar".
        const esHostAhora = !_rapida && jugadores.length > 0 && jugadores[0].nombre === miNombreUsuario;
        if (esHostAhora && !soyElHost) {
            mostrarToast('👑 Ahora eres el host de la sala.', 'rey', 3000);
        }
        soyElHost = esHostAhora;
        const btnEmpezar = document.getElementById('btnEmpezar');
        if (btnEmpezar) {
            btnEmpezar.classList.toggle('hidden', !soyElHost);
        }

        const colores = ['#c0392b','#2980b9','#27ae60','#8e44ad','#e67e22','#16a085','#d35400','#2c3e50'];
        document.getElementById('listaJugadores').innerHTML = jugadores.map((j, i) => {
            const inicial = j.nombre.charAt(0).toUpperCase();
            const esHost = i === 0 && !_rapida;
            const esBot = j.esBot;
            const color = colores[i % colores.length];
            const badge = esHost ? 'Host' : (esBot ? 'Bot' : 'Listo');
            const badgeStyle = esHost
                ? 'background:rgba(241,196,15,0.2);color:#ffe27a'
                : esBot
                    ? 'background:rgba(155,89,182,0.25);color:#e2cdf0'
                    : 'background:rgba(46,204,113,0.2);color:#7ee2a8';
            return `<li>
                <div class="jugador-avatar-lobby" style="background:${color};">${esBot ? icono('bot') : inicial}</div>
                <span class="jugador-nombre-lobby">${escapeHTML(j.nombre)}</span>
                <span class="jugador-badge-lobby" style="${badgeStyle}">${badge}</span>
            </li>`;
        }).join('');

        const slotsEl = document.getElementById('slotsVacios');
        if (slotsEl) {
            const vacios = Math.max(0, Math.min(3, maxJug - jugadores.length));
            slotsEl.innerHTML = Array(vacios).fill(0).map(() => `
                <div class="slot-vacio">
                    <div class="slot-icon">+</div>
                    <span class="slot-texto">Esperando jugador...</span>
                </div>`).join('');
        }

        if (typeof actualizarResumenConfig === 'function') actualizarResumenConfig();

        if (miSalaActual) {
            document.getElementById('mostrarCodigo').classList.remove('hidden');
            document.getElementById('codigoDisplay').innerText = miSalaActual;
            document.getElementById('lobbyTabs')?.classList.add('hidden');
            document.getElementById('panelConfiguracion').classList.add('hidden');
            document.getElementById('panelUnirse').classList.add('hidden');
            document.getElementById('panelJugadores').classList.remove('hidden');
        }
        dibujarMesaCircular();
    });

    socket.on('datosMesa', (datos) => {
        terminarEsperaRapida();
        eventoActual = datos.evento || null;
        ocultarEvento();
        marcarDuelo(datos.duelo);
        if (datos.anunciarDuelo) mostrarPresentacionDuelo(datos.duelistas);
        if (eventoActual) mostrarCartaEvento(eventoActual, datos.anunciarDuelo ? 2800 : 0);
        if (eventoActual?.id === 'NIEBLA') {
            // Tu carta se queda boca abajo hasta la revelación.
            _cartaPendiente = null;
            document.getElementById('miCarta')?.classList.remove('flipped');
        }
        programarRevelacionRey(datos.jugadores, datos.introMs || 0);
        setTimeout(() => practicaEvento('ronda', datos), 0);
        // Revelar la mesa ANTES de dibujar/repartir. En la ronda 1, datosMesa
        // llega antes que tuCarta (que es quien normalmente saca el lobby), así
        // que sin esto la mesa sigue oculta: #mazoFlotante y los asientos tienen
        // rects 0 y repartirCartasEscalonado() salía temprano → el reparto solo
        // se veía desde la ronda 2. Idempotente con tuCarta.
        document.getElementById('seccion-lobby').classList.add('hidden');
        document.getElementById('mesaDeJuego').classList.remove('hidden');
        document.getElementById('infoRonda').classList.remove('hidden');
        document.getElementById('infoDealer').classList.remove('hidden');
        ocultarVistaQR(); // por si quedó abierto cuando el host inició la partida

        document.getElementById('numRonda').innerText = datos.ronda;
        document.getElementById('nombreDealer').innerText = datos.dealer;
        reiniciarHistorialRonda(datos.ronda);

        // Actualizar modo inmediatamente
        if (datos.modoRey) {
            modoReyActual = datos.modoRey;
            const infoModo = document.getElementById('infoModo');
            if (infoModo) {
                infoModo.innerHTML = datos.modoRey === 'SORPRESA' ? icono('mascara') + ' SORPRESA' : icono('ojo') + ' DECLARADO';
                infoModo.style.color = datos.modoRey === 'SORPRESA' ? 'var(--oro)' : '#e74c3c';
                infoModo.classList.remove('hidden');
            }
        }

        // Actualizar conteo del mazo
        if (datos.cartasRestantes !== undefined) {
            const el = document.getElementById('mazoConteo');
            if (el) el.textContent = datos.cartasRestantes;
        }

        // Actualizar jugadores y redibujar mesa (mueve mazo al dealer correcto)
        if (datos.jugadores) {
            listaJugadoresGlobal = datos.jugadores;
            dibujarMesaCircular();
            // Reparto escalonado de las cartas de oponentes desde el mazo. Va
            // sincrónico tras dibujar (mismo frame) para no mostrar las cartas
            // reales antes de ocultarlas. datosMesa llega una vez por ronda.
            repartirCartasEscalonado();
        }
    });

    socket.on('actualizarMazo', (datos) => {
        const el = document.getElementById('mazoConteo');
        if (el) el.textContent = datos.cartasRestantes;
    });

    document.getElementById('btnEmpezar').onclick = () => socket.emit('iniciarPartida', miSalaActual);

    // --- MI CARTA ---
    socket.on('tuCarta', (carta) => {
        if (modoEspectador) return;

        document.getElementById('infoRonda').classList.remove('hidden');
        document.getElementById('infoDealer').classList.remove('hidden');
        document.getElementById('seccion-lobby').classList.add('hidden');
        document.getElementById('mesaDeJuego').classList.remove('hidden');
        document.getElementById('panelAccionesPartida').classList.remove('hidden');
        document.getElementById('barraReacciones')?.classList.remove('hidden');

        // Guardar la carta y dejar que el evento siguiente (juegoIniciado,
        // cambioDeTurno o rondaTerminada) la revele con su animación. NO revelar
        // acá el 9 de DECLARADO: tuCarta llega ~500ms antes de juegoIniciado, que
        // hace ++_renderGen e invalida el callback de revelado de esta animación
        // (race) → la carta quedaba mostrando el dorso. El revelado público del 9
        // en DECLARADO es responsabilidad del server (mensajeGlobal) y del render
        // de oponentes (cartaRevelada); la carta propia se anima como en SORPRESA.
        _cartaPendiente = carta;
    });

    // --- RECONEXIÓN ---
    socket.on('reconexionExitosa', (datos) => {
        eventoActual = datos.evento || null;
        pintarChipEvento();
        marcarDuelo(datos.duelo);
        if (window._servidorReinicio) mostrarToast('✅ Listo: el servidor volvió y tu partida sigue.', 'rey', 3500);
        window._reingresando = false; window._servidorReinicio = false;
        ++_renderGen;
        miSalaActual = datos.idSala;
        listaJugadoresGlobal = datos.jugadores.map(j =>
            j.nombre === miNombreUsuario ? { ...j, id: socket.id } : j
        );

        document.getElementById('seccion-inicio').classList.add('hidden');
        document.getElementById('seccion-lobby').classList.add('hidden');
        // Entrar a la mesa SIEMPRE oculta victoria/resumen/QR: si te reconectás
        // estando en esas pantallas, no deben quedar mezcladas sobre la mesa.
        document.getElementById('pantallaVictoria').classList.add('hidden');
        ocultarResumenRonda();
        ocultarVistaQR();
        document.getElementById('mesaDeJuego').classList.remove('hidden');
        document.getElementById('panelAccionesPartida').classList.remove('hidden');
        document.getElementById('numRonda').innerText = datos.ronda;
        document.getElementById('nombreDealer').innerText = datos.dealer;
        reiniciarHistorialRonda(datos.ronda);
        document.getElementById('infoRonda').classList.remove('hidden');
        document.getElementById('infoDealer').classList.remove('hidden');
        if (datos.modoRey) {
            modoReyActual = datos.modoRey;
            const infoModo = document.getElementById('infoModo');
            const esSorpresa = datos.modoRey === 'SORPRESA';
            infoModo.innerHTML = esSorpresa ? icono('mascara') + ' SORPRESA' : icono('ojo') + ' DECLARADO';
            infoModo.style.color = esSorpresa ? 'var(--oro)' : '#e74c3c';
            infoModo.classList.remove('hidden');
        }

        listaJugadoresGlobal = datos.jugadores;
        turnoActualId = datos.estado === "TURNOS_INTERCAMBIO" ? datos.turnoEnCurso : "";
        cartasRepartidas = true;
        dibujarMesaCircular();

        pintarCartaPrincipal(datos.carta);
        setTimeout(() => { document.getElementById('miCarta').classList.add('flipped'); }, 700);

        if (datos.estado === "REVELACION") {
            document.getElementById('mensajeTurno').innerText = "LA RONDA HA TERMINADO!";
            mostrandoRevelacion = true;
            dibujarMesaCircular();
            document.getElementById('btnMantener').style.display = "none";
            document.getElementById('btnCambiar').style.display = "none";
            document.getElementById('panelAccionesPartida').classList.add('hidden');
            if (datos.dealer === miNombreUsuario) {
                let btnSig = document.getElementById('btnSiguienteRonda');
                btnSig.classList.remove('hidden');
                btnSig.style.display = "inline-block";
            }
        } else {
            document.getElementById('mensajeTurno').innerText = "Reconectando a la batalla...";
            const esMio = (datos.turnoNombre === miNombreUsuario);
            document.getElementById('btnMantener').style.display = esMio ? "inline-block" : "none";
            document.getElementById('btnCambiar').style.display = esMio ? "inline-block" : "none";
            document.getElementById('btnMantener').disabled = !esMio;
            document.getElementById('btnCambiar').disabled = !esMio;
            document.getElementById('btnSiguienteRonda').classList.add('hidden');
            document.getElementById('btnSiguienteRonda').style.display = "none";
        }
        mostrarToast('Reconectado al reino!', 'rey', 3000);
    });

    // --- TURNOS ---
    socket.on('juegoIniciado', (datosTurno) => {
        setTimeout(() => practicaEvento('turno', datosTurno), 900);
        const gen = ++_renderGen;
        if (datosTurno.modoJuego) modoJuegoActual = datosTurno.modoJuego;
        mostrarObjetivoRonda();
        if (datosTurno.jugadores) listaJugadoresGlobal = datosTurno.jugadores;
        if (datosTurno.modoRey) modoReyActual = datosTurno.modoRey;
        turnoActualId = datosTurno.id;
        if (datosTurno.modoRey) modoReyActual = datosTurno.modoRey;

        const infoModo = document.getElementById('infoModo');
        if (infoModo && datosTurno.modoRey) {
            const esSorpresa = datosTurno.modoRey === 'SORPRESA';
            infoModo.innerHTML = esSorpresa ? icono('mascara') + ' SORPRESA' : icono('ojo') + ' DECLARADO';
            infoModo.style.color = esSorpresa ? 'var(--oro)' : '#e74c3c';
            infoModo.classList.remove('hidden');
        }

        const yoEstoyMuerto = listaJugadoresGlobal.find(j => j.id === socket.id && j.vidas <= 0);
        if (yoEstoyMuerto) {
            activarModoEspectador();
            document.getElementById('mensajeTurno').innerText = datosTurno.nombre;
            _cartaPendiente = null;
            dibujarMesaCircular();
            return;
        }

        const esMio = socket.id === datosTurno.id;
        const esCampana = datosTurno.modoJuego === 'CAMPANA';
        if (esMio) {
            Sonidos.turno();
            vibrar([80, 40, 80]);
        }
        document.getElementById('mensajeTurno').innerText = esMio ? "COMIENZAS TU!" : `Inicia ${datosTurno.nombre}...`;
        document.getElementById('btnMantener').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnCambiar').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnMantener').disabled = !esMio;
        document.getElementById('btnCambiar').disabled = !esMio;
        const btnCampana = document.getElementById('btnCampana');
        btnCampana.classList.toggle('hidden', !(esMio && esCampana && !datosTurno.campanaTocada));
        btnCampana.disabled = !(esMio && esCampana && !datosTurno.campanaTocada);
        document.getElementById('btnSiguienteRonda').classList.add('hidden');
        document.getElementById('btnSiguienteRonda').style.display = "none";

        setTimeout(() => {
            // Si otro evento (cambioDeTurno, rondaTerminada, etc.) ya bumpeó la
            // generación, abortar SIN consumir _cartaPendiente — el nuevo evento
            // la procesará.
            if (gen !== _renderGen) return;
            const carta = _cartaPendiente;
            _cartaPendiente = null;

            if (carta !== null && carta !== undefined) {
                const contenedorCarta = document.getElementById('miCarta');
                contenedorCarta.classList.remove('flipped', 'volar-desde-centro-bottom', 'danio-recibido');
                // POC TWEEN.js: el vuelo lo maneja animarVueloCartaTween; al terminar
                // (onComplete) se revela la carta, se gira y arranca el reloj —el reloj
                // inicia con la carta a la vista, igual que con el setTimeout previo.
                animarVueloCartaTween(contenedorCarta, gen, () => {
                    pintarCartaPrincipal(carta);
                    contenedorCarta.classList.add('flipped');
                    actualizarBotonesTurno(esMio, esCampana, datosTurno.campanaTocada);
                    gestionarRelojVisual(datosTurno.id, datosTurno.tiempo);
                });
            } else {
                // Sin carta que animar: iniciar reloj y revisar si es penultimo jugador
                actualizarBotonesTurno(esMio, esCampana, datosTurno.campanaTocada);
                gestionarRelojVisual(datosTurno.id, datosTurno.tiempo);
            }
            dibujarMesaCircular();
        }, 200);
    });

    socket.on('cambioDeTurno', (datosTurno) => {
        setTimeout(() => practicaEvento('turno', datosTurno), 300);
        ++_renderGen; // invalidar cadenas de juegoIniciado/tuCarta en vuelo
        if (datosTurno.modoJuego) modoJuegoActual = datosTurno.modoJuego;
        if (datosTurno.jugadores) listaJugadoresGlobal = datosTurno.jugadores;
        turnoActualId = datosTurno.id;
        if (datosTurno.modoRey) modoReyActual = datosTurno.modoRey;

        // Si llegó una carta pendiente por intercambio, mostrarla ahora
        if (_cartaPendiente !== null) {
            const carta = _cartaPendiente;
            _cartaPendiente = null;
            pintarCartaPrincipal(carta);
            const c = document.getElementById('miCarta');
            if (!c.classList.contains('flipped')) c.classList.add('flipped');
        }

        const yoEstoyMuerto = listaJugadoresGlobal.find(j => j.id === socket.id && j.vidas <= 0);
        if (yoEstoyMuerto) {
            activarModoEspectador();
            document.getElementById('mensajeTurno').innerText = datosTurno.nombre;
            dibujarMesaCircular();
            return;
        }

        dibujarMesaCircular();
        const esMio = socket.id === datosTurno.id;
        const esCampana = datosTurno.modoJuego === 'CAMPANA';
        if (esMio) {
            Sonidos.turno();
            vibrar([80, 40, 80]);
        }
        document.getElementById('mensajeTurno').innerText = esMio ? "ES TU TURNO!" : `Esperando a ${datosTurno.nombre}...`;
        document.getElementById('btnMantener').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnCambiar').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnMantener').disabled = !esMio;
        document.getElementById('btnCambiar').disabled = !esMio;
        const btnCampana = document.getElementById('btnCampana');
        btnCampana.classList.toggle('hidden', !(esMio && esCampana && !datosTurno.campanaTocada));
        btnCampana.disabled = !(esMio && esCampana && !datosTurno.campanaTocada);
        actualizarBotonesTurno(esMio, esCampana, datosTurno.campanaTocada);
        gestionarRelojVisual(datosTurno.id, datosTurno.tiempo);
    });

    function ejecutarAccionMantener() {
        const btn = document.getElementById('btnMantener');
        if (!btn || btn.disabled || btn.style.display === 'none') return;
        ocultarGuiaTurno();
        Sonidos.boton();
        vibrar(25);
        const c = document.getElementById('miCarta');
        if (c) {
            c.classList.add('mantenida-tap');
            setTimeout(() => c.classList.remove('mantenida-tap'), 350);
        }
        btn.disabled = true;
        const btnCambiar = document.getElementById('btnCambiar');
        if (btnCambiar) btnCambiar.disabled = true;
        const btnCampana = document.getElementById('btnCampana');
        if (btnCampana) btnCampana.disabled = true;
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'MANTENER' });
    }

    function ejecutarAccionCambiar() {
        const btn = document.getElementById('btnCambiar');
        if (!btn || btn.disabled || btn.style.display === 'none') return;
        ocultarGuiaTurno();
        Sonidos.boton();
        vibrar(35);
        const c = document.getElementById('miCarta');
        if (c) {
            c.classList.remove('volar-desde-centro-bottom');
            c.classList.add('efecto-intercambio');
            setTimeout(() => { c.classList.remove('efecto-intercambio'); }, 1000);
        }
        btn.disabled = true;
        const btnMantener = document.getElementById('btnMantener');
        if (btnMantener) btnMantener.disabled = true;
        const btnCampana = document.getElementById('btnCampana');
        if (btnCampana) btnCampana.disabled = true;
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'CAMBIAR' });
    }

    document.getElementById('btnMantener').onclick = ejecutarAccionMantener;
    document.getElementById('btnCambiar').onclick = ejecutarAccionCambiar;
    inicializarGestosCarta(ejecutarAccionMantener, ejecutarAccionCambiar);

    document.getElementById('btnCampana').onclick = () => {
        ocultarGuiaTurno();
        Sonidos.campana();
        vibrar([150, 80, 150]);
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'CAMPANA' });
        document.getElementById('btnCampana').disabled = true;
    };

    socket.on('campanaTocada', (datos) => {
        campanaRingerId = datos.jugadorId;
        document.getElementById('btnCampana').classList.add('hidden');
        document.getElementById('btnCampana').disabled = true;
        document.getElementById('bannerUltimaVuelta').classList.remove('hidden');
        Sonidos.campana();
        vibrar([160, 80, 160]);
        animarCampana(datos.jugadorId);
    });

    // --- ACCIONES EN MESA (MINI-FEED) ---
    socket.on('accionMesa', (datos) => {
        registrarJugadaFeed(datos);
        if (datos.tipo === 'CAMBIO' && datos.jugador && datos.objetivo) {
            animarCambioEntre(datos.jugador, datos.objetivo);
        } else if (datos.tipo === 'BLOQUEO' && datos.jugador && datos.objetivo) {
            animarBloqueoRey(datos.jugador, datos.objetivo);
        } else if (datos.tipo === 'MAZO' && datos.jugador) {
            animarRoboMazo(datos.jugador);
        }
    });

    // --- MENSAJES GLOBALES ---
    socket.on('mensajeGlobal', (m) => {
        let tipo = '';
        if (m.includes('BLOQUEO REAL')) tipo = 'bloqueo';
        else if (m.includes('Rey')) tipo = 'rey';
        else if (m.includes('eliminado')) tipo = 'danio';
        mostrarToast(m, tipo, 2500);

        // Si es un evento del sistema de la partida, registrarlo en la bitácora
        if (m.includes('ha sido eliminado') || m.includes('mezclada de nuevo') || m.includes('Empate total')) {
            registrarJugadaFeed({
                tipo: 'INFO',
                icono: m.includes('eliminado') ? '💀' : (m.includes('Empate') ? '🤝' : '🔀'),
                texto: m
            });
        }

        // Flash rojo solo en modo Sorpresa — en Declarado el 9 ya es conocido
        if (m.includes('BLOQUEO REAL') && modoReyActual !== 'DECLARADO') {
            const tapete = document.getElementById('tapeteVistas');
            tapete.style.transition = "background 0.2s";
            tapete.style.background = "rgba(231, 76, 60, 0.3)";
            setTimeout(() => { tapete.style.background = ""; }, 600);
        }
    });

    socket.on('turnoSaltadoVisual', (idJugador) => {
        practicaEvento('saltado', idJugador);
        ++_renderGen;
        turnoActualId = idJugador;
        dibujarMesaCircular();
        document.getElementById('btnMantener').style.display = "none";
        document.getElementById('btnCambiar').style.display = "none";
    });

    // --- FIN DE RONDA ---
    socket.on('rondaTerminada', (datos) => {
        datos._recibido = Date.now();
        setTimeout(() => practicaEvento('fin', datos), 1600);
        ocultarGuiaTurno();
        registrarCaidas(datos);
        if (enDuelo) animarChoqueDuelo(datos);
        const gen = ++_renderGen;
        // Niebla: tu carta se descubre recién ahora.
        if (eventoActual?.id === 'NIEBLA' && _cartaPendiente === null) {
            const yo = datos.jugadores.find(j => j.id === socket.id);
            if (yo && yo.cartaActual !== undefined) _cartaPendiente = yo.cartaActual;
        }
        // Si el dealer acaba de cambiar su carta, actualizar el display antes de revelar
        if (_cartaPendiente !== null) {
            const carta = _cartaPendiente;
            _cartaPendiente = null;
            pintarCartaPrincipal(carta);
            const c = document.getElementById('miCarta');
            if (!c.classList.contains('flipped')) c.classList.add('flipped');
        }
        mostrandoRevelacion = true;
        perdedoresActuales = datos.perdedores;
        turnoActualId = "";
        listaJugadoresGlobal = datos.jugadores;
        _inicioRevelacion = performance.now();
        const fin = menosMovimiento() ? 0 : duracionRevelacion();
        // La ronda ya terminó: el reloj de turno no debe seguir corriendo.
        if (intervaloVisual) clearInterval(intervaloVisual);
        document.getElementById('contenedorReloj').style.display = 'none';
        document.getElementById('focoTurno')?.classList.remove('reloj-urgente');

        registrarJugadaFeed({
            tipo: 'FIN_RONDA',
            icono: '💀',
            texto: `Fin de ronda · Carta mortal: ${datos.cartaMortal}`
        });

        // Un roce por cada carta que se voltea, en el orden de la mesa.
        if (fin) {
            datos.jugadores.forEach(j => {
                if (j.id === socket.id || j.cartaActual === undefined) return;
                if (j.vidas <= 0 && !datos.perdedores.includes(j.id)) return;
                setTimeout(() => { if (gen === _renderGen) Sonidos.carta(); }, ordenRevelacion(j.id) * PASO_REVELAR_MS);
            });
        }
        // El daño llega cuando ya se vio la última carta.
        setTimeout(() => {
            if (gen !== _renderGen) return;
            if (datos.perdedores.includes(socket.id)) {
                document.getElementById('miCarta').classList.add('danio-recibido');
                Sonidos.danio();
                vibrar([120, 60, 200]);
            }
            datos.jugadores.filter(j => datos.perdedores.includes(j.id)).forEach(animarPerdidaVida);
        }, fin);

        const yoMori = datos.jugadores.find(j => j.id === socket.id && j.vidas <= 0);
        if (yoMori) {
            activarModoEspectador();
            document.getElementById('mensajeTurno').innerText = "Eliminado";
            document.getElementById('miCarta').classList.add('flipped');
            document.getElementById('miCarta').style.display = "block";
        } else {
            document.getElementById('mensajeTurno').innerText = "LA RONDA HA TERMINADO!";
        }

        dibujarMesaCircular();
        agregarCartasAPila(datos.jugadores);
        document.getElementById('btnMantener').style.display = "none";
        document.getElementById('btnCambiar').style.display = "none";
        document.getElementById('btnCambiar').innerText = 'CAMBIAR';
        document.getElementById('btnCampana').classList.add('hidden');
        document.getElementById('btnCampana').disabled = true;

        // Mostrar el resumen tras un respiro: la carta nueva del dealer (y las
        // cartas reveladas en la mesa) ya se actualizaron arriba de forma síncrona,
        // así el jugador alcanza a ver qué carta le tocó al cambiar con el mazo
        // ANTES de que el pop-up de resultados la tape. Guard de gen por si llegó
        // otro evento en el ínterin.
        setTimeout(() => {
            if (gen !== _renderGen) return;
            mostrarResumenRonda(datos);
            if (datos.juegoTerminado) {
                mostrarToast('EL JUEGO HA TERMINADO!', 'rey', 5000);
            }
        }, Math.max(1400, fin + 1100) + (enDuelo && !menosMovimiento() ? 1800 : 0));
    });

    document.getElementById('btnSiguienteRonda').onclick = () => {
        socket.emit('siguienteRonda', miSalaActual);
        document.getElementById('btnSiguienteRonda').style.display = "none";
    };

    document.getElementById('btnSiguienteRondaResumen').onclick = () => {
        socket.emit('siguienteRonda', miSalaActual);
        ocultarResumenRonda();
    };

    // --- REACCIONES ---
    let _cooldownReaccion = false;
    document.querySelectorAll('.btn-reaccion').forEach(btn => {
        btn.onclick = () => {
            if (_cooldownReaccion) return;
            const emoji = btn.dataset.emoji;
            socket.emit('reaccion', { idSala: miSalaActual, emoji });
            mostrarReaccion(socket.id, emoji);
            _cooldownReaccion = true;
            btn.style.opacity = '0.35';
            setTimeout(() => {
                _cooldownReaccion = false;
                btn.style.opacity = '';
            }, 2500);
        };
    });

    // --- FRASES RÁPIDAS ---
    const panelFrases = document.getElementById('panelFrases');
    panelFrases.innerHTML = FRASES_RAPIDAS
        .map((f, i) => `<button class="chip-frase" role="menuitem" data-frase="${i}">${escapeHTML(f)}</button>`).join('');
    let _cooldownFrase = false;
    document.getElementById('btnFrases').onclick = () => {
        const abrir = panelFrases.classList.contains('hidden');
        panelFrases.classList.toggle('hidden', !abrir);
        document.getElementById('btnFrases').setAttribute('aria-expanded', String(abrir));
    };
    panelFrases.querySelectorAll('.chip-frase').forEach(chip => {
        chip.onclick = () => {
            cerrarPanelFrases();
            if (_cooldownFrase) return;
            const frase = Number(chip.dataset.frase);
            socket.emit('frase', { idSala: miSalaActual, frase });
            mostrarFrase(socket.id, frase);
            _cooldownFrase = true;
            document.getElementById('btnFrases').style.opacity = '0.35';
            setTimeout(() => { _cooldownFrase = false; document.getElementById('btnFrases').style.opacity = ''; }, 3000);
        };
    });
    socket.on('fraseJugador', (datos) => {
        if (datos.jugadorId !== socket.id) mostrarFrase(datos.jugadorId, datos.frase);
    });

    // --- LOGROS ---
    socket.on('logroDesbloqueado', (logro) => {
        const aviso = document.createElement('div');
        aviso.className = 'aviso-logro';
        aviso.setAttribute('role', 'status');
        aviso.innerHTML = `<span class="aviso-logro-icono">${icono(logro.icono || 'trofeo')}</span>
            <span><small>Logro desbloqueado</small><strong>${escapeHTML(logro.titulo)}</strong>${escapeHTML(logro.descripcion)}</span>`;
        document.body.appendChild(aviso);
        Sonidos.victoria();
        vibrar([60, 40, 120]);
        setTimeout(() => { aviso.classList.add('saliendo'); setTimeout(() => aviso.remove(), 400); }, 4500);
    });

    socket.on('reaccionJugador', (datos) => {
        if (datos.jugadorId !== socket.id) {
            mostrarReaccion(datos.jugadorId, datos.emoji);
        }
    });
    
    document.getElementById('btnRevancha').onclick = () => {
        socket.emit('quieroJugarOtraVez', miSalaActual);
        document.getElementById('btnRevancha').disabled = true;
        document.getElementById('btnRevancha').innerHTML = icono('check') + ' ¡Listo!';
    };

    socket.on('contadorRevancha', (datos) => {
        document.getElementById('contadorRevancha').innerText =
            `${datos.votos} de ${datos.total} quieren revancha`;
    });

    socket.on('revanchaIniciando', () => {
        ++_renderGen;
        desactivarModoEspectador();
        document.getElementById('pantallaVictoria').classList.add('hidden');
        document.getElementById('mesaDeJuego').classList.remove('hidden');
        document.getElementById('panelAccionesPartida').classList.remove('hidden');
        document.getElementById('panelJugadores').classList.remove('hidden');
        document.getElementById('btnRevancha').disabled = false;
        document.getElementById('btnRevancha').innerHTML = icono('espadas') + ' ¡Revancha!';
        cartasRepartidas = false;
        _cartaPendiente = null;
        mostrandoRevelacion = false;
        perdedoresActuales = [];
        turnoActualId = "";
        document.getElementById('bannerUltimaVuelta').classList.add('hidden');
        document.getElementById('btnCambiar').innerText = 'CAMBIAR';
        campanaRingerId = null;
        document.getElementById('miCarta').classList.remove('flipped', 'volar-desde-centro-bottom', 'danio-recibido');
        document.getElementById('miCarta').style.cssText = "";
        limpiarPila();
        document.getElementById('barraReacciones')?.classList.remove('hidden');
    });

    // --- NUEVA RONDA ---
    socket.on('nuevaRondaIniciada', (datos) => {
        ++_renderGen;
        desactivarModoEspectador();
        ocultarResumenRonda();
        document.getElementById('bannerUltimaVuelta').classList.add('hidden');
        document.getElementById('btnCambiar').innerText = 'CAMBIAR';
        campanaRingerId = null;
        mostrandoRevelacion = false;
        perdedoresActuales = [];
        cartasRepartidas = false;
        _cartaPendiente = null;
        turnoActualId = "";
        listaJugadoresGlobal = datos.jugadoresActualizados || listaJugadoresGlobal;

        document.getElementById('mensajeTurno').innerText = "Esperando...";
        document.getElementById('mensajeTurno').style.color = "var(--verde)";
        document.getElementById('miCarta').classList.remove('flipped', 'volar-desde-centro-bottom', 'danio-recibido');
        void document.getElementById('miCarta').offsetWidth;

        let btnSig = document.getElementById('btnSiguienteRonda');
        btnSig.classList.add('hidden');
        btnSig.style.display = "none";
    });

    // --- CARTA REVELADA (modo Sorpresa: bloqueo revela el 9) ---
    socket.on('cartaRevelada', (datos) => {
        listaJugadoresGlobal = datos.jugadores;
        dibujarMesaCircular();
    });

    // --- FIN DEL JUEGO ---
    socket.on('finDelJuego', (ganador) => {
        ocultarGuiaTurno();
        contarPartidaParaGuias();
        ++_renderGen;
        ocultarResumenRonda();
        ocultarVistaQR();
        lanzarCoronasVictoria();
        Sonidos.victoria();
        if (ganador.id === socket.id) {
            vibrar([100, 50, 100, 50, 250]);
        }
        document.getElementById('mesaDeJuego').classList.add('hidden');
        document.getElementById('panelJugadores').classList.add('hidden');
        document.getElementById('mostrarCodigo').classList.add('hidden');
        document.getElementById('panelAccionesPartida').classList.add('hidden');
        document.getElementById('pantallaVictoria').classList.remove('hidden');
        document.getElementById('nombreGanador').innerText = ganador.nombre;
        pintarFinalPartida(ganador);
        document.getElementById('contadorRevancha').innerText = '';
        document.getElementById('btnRevancha').disabled = false;
        document.getElementById('btnRevancha').innerHTML = icono('espadas') + ' ¡Revancha!';
        document.getElementById('barraReacciones')?.classList.add('hidden');
    });

    // --- VOLVER AL LOBBY ---
    document.getElementById('btnVolverLobby').onclick = () => {
        mostrarLobbyLimpio();
        socket.disconnect();
        setTimeout(() => { socket.connect(); }, 500);
    };

    // --- ERROR DE SALA ---
    socket.on('errorSala', (m) => {
        // Contraseña incorrecta — mostrar campo de password sin resetear sala
        if (m === 'WRONG_PASSWORD') {
            if (window._joinAutomatico) {
                // Vino de un link → mostrar modal de contraseña
                window._joinAutomatico = false;
                const modal = document.getElementById('modalPasswordSala');
                modal.classList.remove('hidden');
                document.getElementById('inputPasswordModal').value = '';
                document.getElementById('inputPasswordModal').focus();

                document.getElementById('btnConfirmarPasswordModal').onclick = () => {
                    const pw = document.getElementById('inputPasswordModal').value.trim();
                    modal.classList.add('hidden');
                    socket.emit('unirseSala', { idSala: miSalaActual, password: pw });
                };
                document.getElementById('btnCancelarPasswordModal').onclick = () => {
                    modal.classList.add('hidden');
                    miSalaActual = '';
                };
            } else {
                // Vino del panel unirse → mostrar el campo de password
                document.getElementById('bloquePasswordUnirse').classList.remove('hidden');
                document.getElementById('inputPasswordUnirse').focus();
                mostrarToast('🔐 Contraseña incorrecta. Inténtalo de nuevo.', 'danio', 3000);
            }
            return;
        }

        if (m === 'La sala no existe.' && window._reingresando) {
            window._reingresando = false;
            const porReinicio = window._servidorReinicio;
            window._servidorReinicio = false;
            mostrarLobbyLimpio();
            mostrarToast(porReinicio
                ? '⚠️ El servidor se reinició y la partida se perdió. Crea una sala nueva.'
                : '⚠️ La partida ya terminó o la sala se cerró.', 'danio', 6000);
            return;
        }
        window._reingresando = false;

        resetEstadoSala();
        document.getElementById('panelJugadores').classList.add('hidden');
        document.getElementById('mostrarCodigo').classList.add('hidden');
        document.getElementById('lobbyTabs')?.classList.remove('hidden');
        document.getElementById('panelConfiguracion').classList.remove('hidden');
        document.getElementById('panelUnirse').classList.add('hidden');
        if (typeof switchTab === 'function') switchTab('crear');

        if (window._joinAutomatico) {
            window._joinAutomatico = false;
            if (m !== 'La sala no existe.') alert(m);
            return;
        }
        alert(m);
    });
}

// Restaurar la sesión guardada AL FINAL del archivo, cuando ya se ejecutó todo
// lo demás: conectarSocket() usa variables `let` declaradas más abajo en este
// archivo (_gestosInicializados, _repartiendo...). Llamarla a media carga
// lanzaba "Cannot access ... before initialization", cortaba el resto de
// main.js y quien volvía con sesión guardada veía la mesa congelada.
function restaurarSesion() {
    const token    = localStorage.getItem('reyToken');
    const username = localStorage.getItem('reyUsername');
    if (!token || !username) return;

    // Decodificar el payload del JWT para verificar expiración (sin validar firma)
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 < Date.now()) {
            localStorage.removeItem('reyToken');
            localStorage.removeItem('reyUsername');
            return;
        }
    } catch { return; }

    miToken = token;
    miNombreUsuario = username;
    document.getElementById('displayUsername').innerText = miNombreUsuario;
    document.getElementById('seccion-inicio').classList.add('hidden');
    document.getElementById('pantallaJuego').classList.remove('hidden');
    conectarSocket();
}
restaurarSesion();
