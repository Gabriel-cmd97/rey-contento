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
let modoReyActual = "SORPRESA";
let cartasDescartadas = [];
let pilaRenderizadaCount = 0;
let campanaRingerId = null;

const nombresCartas = {
    0: "El Mendigo", 1: "La Rata", 2: "El Campesino", 3: "El Trovador",
    4: "El Guardia", 5: "El Verdugo", 6: "La Duquesa", 7: "El Mago",
    8: "El General", 9: "El Rey Contento"
};

// ==========================================
// TOASTS
// ==========================================
function mostrarToast(mensaje, tipo = '', duracion = 2500) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-mensaje' + (tipo ? ' toast-' + tipo : '');
    toast.innerHTML = mensaje;
    container.appendChild(toast);
    while (container.children.length > 2) container.removeChild(container.firstChild);
    setTimeout(() => {
        toast.style.animation = 'toastSalir 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, duracion);
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
        el.textContent = carta;
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
        setTimeout(() => {
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
        }, i * 120);
    }
}

function actualizarBotonesTurno(esMio, esCampana, campanaTocada) {
    const btnCambiar = document.getElementById('btnCambiar');
    btnCambiar.innerText = 'CAMBIAR';

    if (!esMio || !esCampana || !campanaTocada || !campanaRingerId) return;

    // Verificar si mi vecino derecho es quien tocó la campana
    const miIndex = listaJugadoresGlobal.findIndex(j => j.id === socket.id);
    if (miIndex === -1) return;

    let derechaIndex = miIndex;
    let intentos = 0;
    do {
        derechaIndex = (derechaIndex + 1) % listaJugadoresGlobal.length;
        intentos++;
    } while (listaJugadoresGlobal[derechaIndex]?.vidas <= 0 && intentos < listaJugadoresGlobal.length);

    if (listaJugadoresGlobal[derechaIndex]?.id === campanaRingerId) {
        btnCambiar.innerText = '🃏 ROBAR';
        mostrarToast('🔔 No puedes cambiar con quien tocó la campana — si cambias, robarás del mazo.', 'rey', 4000);
    }
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
                <div style="font-size:7px;color:rgba(255,255,255,0.45);margin-top:3px;padding:0 2px;line-height:1.1;">${nombresCartas[num]}</div>
            </div>
            <div class="resumen-carta-nombre">${j.nombre}</div>
            <div style="font-size:11px;">${pierde ? '💔' : '✅'} ${j.vidas > 0 ? '♥️'.repeat(j.vidas) : '☠️'}</div>
        `;
        grid.appendChild(item);
    });

    const btnSig = document.getElementById('btnSiguienteRondaResumen');
    btnSig.classList.toggle('hidden', datos.juegoTerminado || socket.id !== datos.dealerId);

    panel.classList.remove('hidden');
}

function ocultarResumenRonda() {
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
    document.getElementById('mensajeTurno').style.color = "rgba(255,255,255,0.4)";
}

function desactivarModoEspectador() {
    modoEspectador = false;
    document.getElementById('bannerEspectador').classList.add('hidden');
    document.getElementById('mesaDeJuego').classList.remove('mesa-espectador');
    document.getElementById('mensajeTurno').style.color = "var(--verde)";
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
                <td class="td-nombre">${esTuNombre ? '<span class="nombre-propio">'+j.username+'</span>' : j.username} ${rachaHTML}</td>
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
(function restaurarSesion() {
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
})();

// ==========================================
// PERFIL PERSONAL
// ==========================================
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
    } catch { /* sin conexión, los valores quedan en — */ }
}
document.getElementById('btnMiPerfil').addEventListener('click', cargarMiPerfil);
document.getElementById('btnCerrarPerfil').addEventListener('click', () => {
    document.getElementById('modalPerfil').classList.add('hidden');
});

// ==========================================
// AUTH
// ==========================================
async function peticionAuth(ruta) {
    const username = document.getElementById('authUsername').value;
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
            } else alert(data.mensaje);
        } else alert(data.error);
    } catch (e) { alert("Error de servidor"); }
}

document.getElementById('btnLogin').addEventListener('click', () => peticionAuth('/login'));
document.getElementById('btnRegistro').addEventListener('click', () => peticionAuth('/registro'));
document.getElementById('btnVerReglas').addEventListener('click', () => document.getElementById('modalReglas').classList.remove('hidden'));
document.getElementById('btnCerrarReglas').addEventListener('click', () => document.getElementById('modalReglas').classList.add('hidden'));

// ==========================================
// RELOJ VISUAL
// ==========================================
function gestionarRelojVisual(idEnTurno, tiempoSegundos) {
    if (intervaloVisual) clearInterval(intervaloVisual);
    const cont = document.getElementById('contenedorReloj');
    const barra = document.getElementById('barraReloj');
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
            document.getElementById('segundosReloj').style.color = '#e74c3c';
        } else {
            barra.style.background = '#e67e22';
            document.getElementById('segundosReloj').style.color = '#e67e22';
        }
        if (t <= 0) { clearInterval(intervaloVisual); cont.style.display = 'none'; }
    }, 1000);
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
    if (nombreMesa) nombreMesa.innerText = (miJugador.dealer ? '👑 ' : '👤 ') + miJugador.nombre;
    if (vidasMesa) vidasMesa.innerText = miJugador.vidas > 0 ? '♥️ ' + miJugador.vidas : '☠️ 0';

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
        if (turnoActualId === socket.id) miSilla.classList.add('turno-activo');
        else miSilla.classList.add('jugador-opaco');
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
    let idsSillas = [];
    if (numOp === 1) idsSillas = ['silla-top'];
    else if (numOp === 2) idsSillas = ['silla-left', 'silla-right'];
    else if (numOp === 3) idsSillas = ['silla-left', 'silla-top', 'silla-right'];
    else if (numOp === 4) idsSillas = ['silla-left', 'silla-top-left', 'silla-top-right', 'silla-right'];
    else if (numOp === 5) idsSillas = ['silla-left', 'silla-top-left', 'silla-top', 'silla-top-right', 'silla-right'];
    else if (numOp === 6) idsSillas = ['silla-bottom-left', 'silla-left', 'silla-top-left', 'silla-top-right', 'silla-right', 'silla-bottom-right'];
    else if (numOp === 7) idsSillas = ['silla-bottom-left', 'silla-left', 'silla-top-left', 'silla-top', 'silla-top-right', 'silla-right', 'silla-bottom-right'];

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
        let claseVuelo = cartasRepartidas ? '' : `volar-desde-centro-${idSilla.replace('silla-', '')}`;

        const claseVidaCritica = (op.vidas === 1 && !estaMuerto) ? 'vida-critica' : '';
        divSilla.className = `silla ${idSilla.replace('silla-', '')} ${esSuTurno ? 'turno-activo' : ''} ${claseVidaCritica}`.trim();
        divSilla.dataset.jugadorId = op.id;

        let cartaHTML = '';
        if (op.vidas > 0 || (mostrandoRevelacion && perdedoresActuales.includes(op.id))) {
            if (mostrandoRevelacion && op.cartaActual !== undefined) {
                let extra = (op.cartaActual === 0) ? 'mini-carta-0' : (op.cartaActual === 9) ? 'mini-carta-9' : '';
                cartaHTML = `
                    <div class="mini-carta-frente ${extra} ${claseDanio} efecto-revelar">
                        <div style="font-size:34px;font-weight:bold;line-height:1;">${op.cartaActual}</div>
                        <div style="font-size:11px;text-align:center;line-height:1.1;margin-top:5px;">${nombresCartas[op.cartaActual]}</div>
                    </div>`;
            } else if (op.vidas > 0) {
                const debeRevelar = (op.cartaRevelada === true) || (modoReyActual === 'DECLARADO' && op.cartaActual === 9);
                if (debeRevelar && op.cartaActual !== undefined) {
                    let extra = op.cartaActual === 9 ? 'mini-carta-9' : op.cartaActual === 0 ? 'mini-carta-0' : '';
                    cartaHTML = `
                        <div class="mini-carta-frente ${extra}" style="border:2px solid var(--oro);box-shadow:0 0 15px rgba(241,196,15,0.8);">
                            <div style="font-size:34px;font-weight:bold;line-height:1;">${op.cartaActual}</div>
                            <div style="font-size:11px;text-align:center;line-height:1.1;margin-top:5px;">${nombresCartas[op.cartaActual]}</div>
                        </div>`;
                } else {
                    cartaHTML = `<div class="perfil-carta-reverso ${claseVuelo}"></div>`;
                }
            }
        }

        let icono = op.dealer ? '👑' : (esSuTurno ? '⚔️' : (op.esBot ? '' : '👤'));
        let claseEstado = estaMuerto ? 'jugador-eliminado' : '';

        divSilla.innerHTML = `
            <div class="perfil-oponente ${claseEstado} ${animReparto} ${claseDanio}">
                <div style="font-size:13px;font-weight:bold;line-height:1.2;word-wrap:break-word;">${icono} ${op.nombre}</div>
                <span class="vidas-destacadas">${estaMuerto ? '☠️ 0' : '♥️ ' + op.vidas}</span>
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
            mazoFlotante.className = mazoFlotante.className.replace(/pos-\S+/g, '').trim();
            if (dealer.id === socket.id) {
                mazoFlotante.classList.add('pos-bottom');
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
    if (document.visibilityState === 'visible' && miToken && socket && !socket.connected) {
        socket.connect();
    }
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

    // El servidor cerró esta sesión porque la cuenta inició desde otra pestaña
    // o dispositivo. Desactivar reconexión automática y volver al lobby inicial.
    socket.on('sesionReemplazada', (mensaje) => {
        socket.io.opts.reconnection = false;
        miSalaActual = null;
        soyElHost = false;
        listaJugadoresGlobal = [];

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

    // Al reconectar (ej. después de desbloquear el teléfono), volver a la sala si aplica
    socket.on('reconnect', () => {
        if (miSalaActual) {
            socket.emit('unirseSala', { idSala: miSalaActual });
        }
    });

    socket.on('connect', () => {
        document.getElementById('btnCrearSala').disabled = false;
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
        const modal = document.createElement('div');
        modal.id = "modalReconexion";
        modal.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;justify-content:center;align-items:center;">
                <div style="background:var(--pergamino);color:#2c3e50;padding:30px;border-radius:15px;border:6px solid var(--oro-oscuro);text-align:center;max-width:90%;width:350px;box-shadow:0 0 40px #000;">
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
                modoJuego: document.getElementById('selectModoJuego').value,
                password: document.getElementById('inputPasswordSala').value.trim()
            }
        });
    };

    socket.on('salaCreada', (id) => {
        miSalaActual = id; soyElHost = true;
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
            miSalaActual = "";
            soyElHost = false;
        }
        document.getElementById('panelJugadores').classList.add('hidden');
        document.getElementById('mostrarCodigo').classList.add('hidden');
        document.getElementById('lobbyTabs')?.classList.remove('hidden');
        document.getElementById('panelConfiguracion').classList.remove('hidden');
        document.getElementById('panelUnirse').classList.add('hidden');
        document.getElementById('listaJugadores').innerHTML = '';
        if (typeof switchTab === 'function') switchTab('crear');
    };

    document.getElementById('btnCopiarLink').onclick = () => {
        const link = `http://34.204.215.13:4000/sala/${miSalaActual}`;
        const btn = document.getElementById('btnCopiarLink');
        const exito = () => {
            btn.innerText = "Copiado!";
            setTimeout(() => { btn.innerText = "COPIAR LINK"; }, 2000);
        };
        const error = () => {
            btn.innerText = "Error al copiar";
            setTimeout(() => { btn.innerText = "COPIAR LINK"; }, 2000);
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
        const jugadores = Array.isArray(datos) ? datos : datos.jugadores;
        const maxJug = (datos && datos.maxJugadores) ? datos.maxJugadores : parseInt(document.getElementById('selectJugadores')?.value || 8);

        listaJugadoresGlobal = jugadores.map(j =>
            j.nombre === miNombreUsuario ? { ...j, id: socket.id } : j
        );

        const colores = ['#c0392b','#2980b9','#27ae60','#8e44ad','#e67e22','#16a085','#d35400','#2c3e50'];
        document.getElementById('listaJugadores').innerHTML = jugadores.map((j, i) => {
            const inicial = j.nombre.charAt(0).toUpperCase();
            const esHost = i === 0;
            const esBot = j.esBot;
            const color = colores[i % colores.length];
            const badge = esHost ? 'Host' : (esBot ? 'Bot' : 'Listo');
            const badgeStyle = esHost
                ? 'background:rgba(241,196,15,0.2);color:var(--oro)'
                : esBot
                    ? 'background:rgba(155,89,182,0.2);color:#bb8fce'
                    : 'background:rgba(46,204,113,0.2);color:#2ecc71';
            return `<li>
                <div class="jugador-avatar-lobby" style="background:${color};">${esBot ? '🤖' : inicial}</div>
                <span class="jugador-nombre-lobby">${j.nombre}</span>
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
        document.getElementById('numRonda').innerText = datos.ronda;
        document.getElementById('nombreDealer').innerText = datos.dealer;

        // Actualizar modo inmediatamente
        if (datos.modoRey) {
            modoReyActual = datos.modoRey;
            const infoModo = document.getElementById('infoModo');
            if (infoModo) {
                infoModo.innerHTML = datos.modoRey === 'SORPRESA' ? '🎭 SORPRESA' : '👁️ DECLARADO';
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

        _cartaPendiente = carta;

        // DECLARADO: el 9 se revela de inmediato sin esperar juegoIniciado
        if (modoReyActual === 'DECLARADO' && carta === 9) {
            const contenedorCarta = document.getElementById('miCarta');
            contenedorCarta.classList.remove('flipped', 'volar-desde-centro-bottom', 'danio-recibido');
            void contenedorCarta.offsetWidth;
            contenedorCarta.classList.add('volar-desde-centro-bottom');
            // 600ms: esperar que termine la animación de vuelo antes de revelar y girar
            setTimeout(() => {
                document.getElementById('numeroCarta').innerText = carta;
                document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
                document.getElementById('cartaFrente').className = 'face front-character carta-9';
                contenedorCarta.classList.add('flipped');
                _cartaPendiente = null; // consumida, juegoIniciado no la reanimará
            }, 600);
        }
    });

    // --- RECONEXIÓN ---
    socket.on('reconexionExitosa', (datos) => {
        miSalaActual = datos.idSala;
        listaJugadoresGlobal = datos.jugadores.map(j =>
            j.nombre === miNombreUsuario ? { ...j, id: socket.id } : j
        );

        document.getElementById('seccion-inicio').classList.add('hidden');
        document.getElementById('seccion-lobby').classList.add('hidden');
        document.getElementById('mesaDeJuego').classList.remove('hidden');
        document.getElementById('panelAccionesPartida').classList.remove('hidden');
        document.getElementById('numRonda').innerText = datos.ronda;
        document.getElementById('nombreDealer').innerText = datos.dealer;
        document.getElementById('infoRonda').classList.remove('hidden');
        document.getElementById('infoDealer').classList.remove('hidden');
        if (datos.modoRey) {
            modoReyActual = datos.modoRey;
            const infoModo = document.getElementById('infoModo');
            const esSorpresa = datos.modoRey === 'SORPRESA';
            infoModo.innerHTML = esSorpresa ? '🎭 SORPRESA' : '👁️ DECLARADO';
            infoModo.style.color = esSorpresa ? 'var(--oro)' : '#e74c3c';
            infoModo.classList.remove('hidden');
        }

        listaJugadoresGlobal = datos.jugadores;
        turnoActualId = datos.estado === "TURNOS_INTERCAMBIO" ? datos.turnoEnCurso : "";
        cartasRepartidas = true;
        dibujarMesaCircular();

        document.getElementById('numeroCarta').innerText = datos.carta;
        document.getElementById('nombrePersonaje').innerText = nombresCartas[datos.carta];
        document.getElementById('cartaFrente').className = "face front-character " +
            (datos.carta === 0 ? "carta-0" : datos.carta === 9 ? "carta-9" : "");
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
        if (datosTurno.jugadores) listaJugadoresGlobal = datosTurno.jugadores;
        if (datosTurno.modoRey) modoReyActual = datosTurno.modoRey;
        turnoActualId = datosTurno.id;
        if (datosTurno.modoRey) modoReyActual = datosTurno.modoRey;

        const infoModo = document.getElementById('infoModo');
        if (infoModo && datosTurno.modoRey) {
            const esSorpresa = datosTurno.modoRey === 'SORPRESA';
            infoModo.innerHTML = esSorpresa ? '🎭 SORPRESA' : '👁️ DECLARADO';
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
            const carta = _cartaPendiente;
            _cartaPendiente = null;

            if (carta !== null && carta !== undefined) {
                const contenedorCarta = document.getElementById('miCarta');
                contenedorCarta.classList.remove('flipped', 'volar-desde-centro-bottom', 'danio-recibido');
                void contenedorCarta.offsetWidth;
                contenedorCarta.classList.add('volar-desde-centro-bottom');
                // Esperar que termine el vuelo (600ms) para revelar y girar la carta
                // El reloj inicia aquí: el jugador empieza a ver su carta al mismo tiempo
                setTimeout(() => {
                    document.getElementById('numeroCarta').innerText = carta;
                    document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
                    document.getElementById('cartaFrente').className = "face front-character " +
                        (carta === 0 ? "carta-0" : carta === 9 ? "carta-9" : "");
                    contenedorCarta.classList.add('flipped');
                    actualizarBotonesTurno(esMio, esCampana, datosTurno.campanaTocada);
                    gestionarRelojVisual(datosTurno.id, datosTurno.tiempo);
                }, 600);
            } else {
                // Sin carta que animar: iniciar reloj y revisar si es penultimo jugador
                actualizarBotonesTurno(esMio, esCampana, datosTurno.campanaTocada);
                gestionarRelojVisual(datosTurno.id, datosTurno.tiempo);
            }
            dibujarMesaCircular();
        }, 200);
    });

    socket.on('cambioDeTurno', (datosTurno) => {
        if (datosTurno.jugadores) listaJugadoresGlobal = datosTurno.jugadores;
        turnoActualId = datosTurno.id;
        if (datosTurno.modoRey) modoReyActual = datosTurno.modoRey;

        // Si llegó una carta pendiente por intercambio, mostrarla ahora
        if (_cartaPendiente !== null) {
            const carta = _cartaPendiente;
            _cartaPendiente = null;
            document.getElementById('numeroCarta').innerText = carta;
            document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
            document.getElementById('cartaFrente').className = "face front-character " +
                (carta === 0 ? "carta-0" : carta === 9 ? "carta-9" : "");
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

    document.getElementById('btnMantener').onclick = () =>
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'MANTENER' });

    document.getElementById('btnCambiar').onclick = () => {
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'CAMBIAR' });
        let miCartaVisual = document.getElementById('miCarta');
        miCartaVisual.classList.remove('volar-desde-centro-bottom');
        miCartaVisual.classList.add('efecto-intercambio');
        setTimeout(() => { miCartaVisual.classList.remove('efecto-intercambio'); }, 1000);
    };

    document.getElementById('btnCampana').onclick = () => {
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'CAMPANA' });
        document.getElementById('btnCampana').disabled = true;
    };

    socket.on('campanaTocada', (datos) => {
        campanaRingerId = datos.jugadorId;
        document.getElementById('btnCampana').classList.add('hidden');
        document.getElementById('btnCampana').disabled = true;
        document.getElementById('bannerUltimaVuelta').classList.remove('hidden');
    });

    // --- MENSAJES GLOBALES ---
    socket.on('mensajeGlobal', (m) => {
        let tipo = '';
        if (m.includes('BLOQUEO REAL')) tipo = 'bloqueo';
        else if (m.includes('Rey')) tipo = 'rey';
        else if (m.includes('eliminado')) tipo = 'danio';
        mostrarToast(m, tipo, 2500);
        // Flash rojo solo en modo Sorpresa — en Declarado el 9 ya es conocido
        if (m.includes('BLOQUEO REAL') && modoReyActual !== 'DECLARADO') {
            const tapete = document.getElementById('tapeteVistas');
            tapete.style.transition = "background 0.2s";
            tapete.style.background = "rgba(231, 76, 60, 0.3)";
            setTimeout(() => { tapete.style.background = ""; }, 600);
        }
    });

    socket.on('turnoSaltadoVisual', (idJugador) => {
        turnoActualId = idJugador;
        dibujarMesaCircular();
        document.getElementById('btnMantener').style.display = "none";
        document.getElementById('btnCambiar').style.display = "none";
    });

    // --- FIN DE RONDA ---
    socket.on('rondaTerminada', (datos) => {
        // Si el dealer acaba de cambiar su carta, actualizar el display antes de revelar
        if (_cartaPendiente !== null) {
            const carta = _cartaPendiente;
            _cartaPendiente = null;
            document.getElementById('numeroCarta').innerText = carta;
            document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
            document.getElementById('cartaFrente').className = "face front-character " +
                (carta === 0 ? "carta-0" : carta === 9 ? "carta-9" : "");
            const c = document.getElementById('miCarta');
            if (!c.classList.contains('flipped')) c.classList.add('flipped');
        }
        mostrandoRevelacion = true;
        perdedoresActuales = datos.perdedores;
        turnoActualId = "";
        listaJugadoresGlobal = datos.jugadores;

        if (datos.perdedores.includes(socket.id)) {
            document.getElementById('miCarta').classList.add('danio-recibido');
        }

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

        mostrarResumenRonda(datos);
        if (datos.juegoTerminado) {
            mostrarToast('EL JUEGO HA TERMINADO!', 'rey', 5000);
        }
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

    socket.on('reaccionJugador', (datos) => {
        if (datos.jugadorId !== socket.id) {
            mostrarReaccion(datos.jugadorId, datos.emoji);
        }
    });
    
    document.getElementById('btnRevancha').onclick = () => {
        socket.emit('quieroJugarOtraVez', miSalaActual);
        document.getElementById('btnRevancha').disabled = true;
        document.getElementById('btnRevancha').innerText = '✅ ¡Listo!';
    };

    socket.on('contadorRevancha', (datos) => {
        document.getElementById('contadorRevancha').innerText =
            `${datos.votos} de ${datos.total} quieren revancha`;
    });

    socket.on('revanchaIniciando', () => {
        desactivarModoEspectador();
        document.getElementById('pantallaVictoria').classList.add('hidden');
        document.getElementById('mesaDeJuego').classList.remove('hidden');
        document.getElementById('panelAccionesPartida').classList.remove('hidden');
        document.getElementById('panelJugadores').classList.remove('hidden');
        document.getElementById('btnRevancha').disabled = false;
        document.getElementById('btnRevancha').innerText = '⚔️ ¡Revancha!';
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
        ocultarResumenRonda();
        lanzarCoronasVictoria();
        document.getElementById('mesaDeJuego').classList.add('hidden');
        document.getElementById('panelJugadores').classList.add('hidden');
        document.getElementById('mostrarCodigo').classList.add('hidden');
        document.getElementById('pantallaVictoria').classList.remove('hidden');
        document.getElementById('nombreGanador').innerText = ganador.nombre;
        document.getElementById('contadorRevancha').innerText = '';
        document.getElementById('btnRevancha').disabled = false;
        document.getElementById('btnRevancha').innerText = '⚔️ ¡Revancha!';
        document.getElementById('barraReacciones')?.classList.add('hidden');
    });

    // --- VOLVER AL LOBBY ---
    document.getElementById('btnVolverLobby').onclick = () => {
        desactivarModoEspectador();
        document.getElementById('pantallaVictoria').classList.add('hidden');
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

        cartasRepartidas = false;
        _cartaPendiente = null;
        mostrandoRevelacion = false;
        perdedoresActuales = [];
        turnoActualId = "";
        miSalaActual = "";
        soyElHost = false;
        listaJugadoresGlobal = [];

        document.getElementById('listaJugadores').innerHTML = "";
        dibujarMesaCircular();

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

        miSalaActual = "";
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