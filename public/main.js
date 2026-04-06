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
const URL_SERVIDOR = 'http://34.204.215.13:4000';

let miToken = "", miNombreUsuario = "", miSalaActual = "", soyElHost = false;
let socket, intervaloVisual;
let listaJugadoresGlobal = [];
let turnoActualId = "";
let mostrandoRevelacion = false;
let perdedoresActuales = [];
let cartasRepartidas = false;
let modoEspectador = false;
let _cartaPendiente = null;

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
        document.getElementById('cuerpoLeaderboard').innerHTML = data.map((j, i) => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.1);">
                <td style="padding: 10px; text-align: left;">${i===0?'👑 ':''}${j.username}</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; color: var(--oro);">${j.victorias}</td>
            </tr>`).join('');
    } catch (e) { console.error("Error leaderboard"); }
}
cargarLeaderboard();

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

    ['silla-top', 'silla-left', 'silla-right'].forEach(id => {
        let el = document.getElementById(id);
        if (el) { el.innerHTML = ""; el.classList.add('hidden'); }
    });

    let miIndex = listaJugadoresGlobal.findIndex(j => j.id === socket.id);
    if (miIndex === -1) miIndex = 0;

    let miJugador = listaJugadoresGlobal[miIndex];
    let miSilla = document.getElementById('miSilla');
    let miCarta = document.getElementById('miCarta');
    let miPerfil = document.getElementById('miPerfil');

    document.getElementById('miNombreMesa').innerText = (miJugador.dealer ? '👑 ' : '👤 ') + miJugador.nombre;
    document.getElementById('iconoUsuario').innerText = miJugador.dealer ? '👑' : '👤';
    document.getElementById('misVidasMesa').innerText = miJugador.vidas > 0 ? '♥️ ' + miJugador.vidas : '☠️ 0';

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

    miSilla.classList.remove('turno-activo', 'jugador-opaco');
    if (miJugador.vidas > 0 && turnoActualId !== "") {
        if (turnoActualId === socket.id) miSilla.classList.add('turno-activo');
        else miSilla.classList.add('jugador-opaco');
    }

    // Brillo dorado en mi perfil cuando es mi turno
    if (turnoActualId === socket.id && miJugador.vidas > 0) {
        miPerfil.style.borderColor = 'var(--oro)';
        miPerfil.style.boxShadow = '0 0 0 2px #fff, 0 0 0 3px var(--oro), 0 0 15px rgba(241,196,15,1), 0 0 30px rgba(241,196,15,0.7)';
    } else {
        miPerfil.style.borderColor = '';
        miPerfil.style.boxShadow = '';
    }

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
        let divSilla = document.getElementById(idsSillas[i]);
        divSilla.classList.remove('hidden');

        let esSuTurno = (turnoActualId === op.id);
        let estaMuerto = (op.vidas <= 0);
        let claseDanio = (mostrandoRevelacion && perdedoresActuales.includes(op.id)) ? 'danio-recibido' : '';
        let animReparto = cartasRepartidas ? '' : 'animacion-reparto';
        let claseVuelo = cartasRepartidas ? '' : `volar-desde-centro-${idsSillas[i].replace('silla-', '')}`;

        divSilla.className = `silla ${idsSillas[i].replace('silla-', '')} ${esSuTurno ? 'turno-activo' : ''}`;

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
                if (op.cartaRevelada && op.cartaActual !== undefined) {
                    // Modo Declarado: carta boca arriba desde el reparto
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

    // Solo marcar repartidas si el juego está activo
    if (!document.getElementById('mesaDeJuego').classList.contains('hidden')) {
        cartasRepartidas = true;
    }
}

// ==========================================
// SOCKETS
// ==========================================
function conectarSocket() {
    socket = io(URL_SERVIDOR, { auth: { token: miToken } });

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
    document.getElementById('btnCrearSala').addEventListener('click', () => {
        socket.emit('crearSala', {
            configuracion: {
                modoRey: document.getElementById('selectModo').value,
                frecuenciaReyes: document.getElementById('selectReyes').value,
                vidas: parseInt(document.getElementById('selectVidas').value),
                maxJugadores: parseInt(document.getElementById('selectJugadores').value),
                numBots: parseInt(document.getElementById('selectBots').value)
            }
        });
    });

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

    document.getElementById('inputCodigo').addEventListener('input', function () {
        this.value = this.value.toUpperCase();
    });

    document.getElementById('btnUnirseSala').addEventListener('click', () => {
        const codigoInput = document.getElementById('inputCodigo').value.toUpperCase();
        if (codigoInput === "") return alert("Escribe un código primero");
        miSalaActual = codigoInput;
        socket.emit('unirseSala', { idSala: miSalaActual });
        document.getElementById('mostrarCodigo').classList.remove('hidden');
        document.getElementById('codigoDisplay').innerText = miSalaActual;
        document.getElementById('lobbyTabs')?.classList.add('hidden');
        document.getElementById('panelConfiguracion').classList.add('hidden');
        document.getElementById('panelUnirse').classList.add('hidden');
        document.getElementById('panelJugadores').classList.remove('hidden');
    });

    document.getElementById('btnSalirLobby').addEventListener('click', () => {
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
    });

    document.getElementById('btnCopiarLink').addEventListener('click', () => {
        const link = `http://34.204.215.13:4000/sala/${miSalaActual}`;
        const btn = document.getElementById('btnCopiarLink');
        navigator.clipboard.writeText(link).then(() => {
            btn.innerText = "Copiado!";
            setTimeout(() => { btn.innerText = "COPIAR LINK"; }, 2000);
        });
    });

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
    });

    document.getElementById('btnEmpezar').addEventListener('click', () => socket.emit('iniciarPartida', miSalaActual));

    // --- MI CARTA ---
   socket.on('tuCarta', (carta) => {
    if (modoEspectador) return;

    document.getElementById('infoRonda').classList.remove('hidden');
    document.getElementById('infoDealer').classList.remove('hidden');
    document.getElementById('seccion-lobby').classList.add('hidden');
    document.getElementById('mesaDeJuego').classList.remove('hidden');
    document.getElementById('panelAccionesPartida').classList.remove('hidden');

    if (!cartasRepartidas) {
        // Inicio de ronda: guardar para animar junto con juegoIniciado
        _cartaPendiente = carta;
    } else {
        // Durante partida (intercambio o dealer): actualizar y voltear inmediatamente
        document.getElementById('numeroCarta').innerText = carta;
        document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
        document.getElementById('cartaFrente').className = "face front-character " +
            (carta === 0 ? "carta-0" : carta === 9 ? "carta-9" : "");
        const contenedorCarta = document.getElementById('miCarta');
        if (!contenedorCarta.classList.contains('flipped')) {
            contenedorCarta.classList.add('flipped');
        }
        _cartaPendiente = null; // limpiar para que cambioDeTurno no lo re-procese
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
            const esMio = (socket.id === datos.turnoEnCurso);
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
        cartasRepartidas = false;
        turnoActualId = datosTurno.id;

        const yoEstoyMuerto = listaJugadoresGlobal.find(j => j.id === socket.id && j.vidas <= 0);
        if (yoEstoyMuerto) {
            activarModoEspectador();
            document.getElementById('mensajeTurno').innerText = datosTurno.nombre;
            _cartaPendiente = null;
            setTimeout(() => { dibujarMesaCircular(); }, 400);
            return;
        }

        document.getElementById('mazoCentral').style.display = 'inline-block';
        const esMio = socket.id === datosTurno.id;
        document.getElementById('mensajeTurno').innerText = esMio ? "COMIENZAS TU!" : `Inicia ${datosTurno.nombre}...`;
        document.getElementById('btnMantener').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnCambiar').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnMantener').disabled = !esMio;
        document.getElementById('btnCambiar').disabled = !esMio;
        document.getElementById('btnSiguienteRonda').classList.add('hidden');
        document.getElementById('btnSiguienteRonda').style.display = "none";

        setTimeout(() => {
            const carta = _cartaPendiente;
            _cartaPendiente = null;

            if (carta !== null && carta !== undefined) {
                const contenedorCarta = document.getElementById('miCarta');
                contenedorCarta.classList.remove('flipped', 'volar-desde-centro-bottom');
                void contenedorCarta.offsetWidth;
                contenedorCarta.classList.add('volar-desde-centro-bottom');
                setTimeout(() => {
                    document.getElementById('numeroCarta').innerText = carta;
                    document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
                    document.getElementById('cartaFrente').className = "face front-character " +
                        (carta === 0 ? "carta-0" : carta === 9 ? "carta-9" : "");
                    contenedorCarta.classList.add('flipped');
                }, 700);
            }
            dibujarMesaCircular();
            gestionarRelojVisual(datosTurno.id, datosTurno.tiempo);
        }, 400);
    });

    socket.on('cambioDeTurno', (datosTurno) => {
        if (datosTurno.jugadores) listaJugadoresGlobal = datosTurno.jugadores;
        turnoActualId = datosTurno.id;

        // Si llegó una carta pendiente por intercambio, mostrarla ahora
        // if (_cartaPendiente !== null) {
        //     const carta = _cartaPendiente;
        //     _cartaPendiente = null;
        //     document.getElementById('numeroCarta').innerText = carta;
        //     document.getElementById('nombrePersonaje').innerText = nombresCartas[carta];
        //     document.getElementById('cartaFrente').className = "face front-character " +
        //         (carta === 0 ? "carta-0" : carta === 9 ? "carta-9" : "");
        //     const c = document.getElementById('miCarta');
        //     if (!c.classList.contains('flipped')) c.classList.add('flipped');
        // }

        const yoEstoyMuerto = listaJugadoresGlobal.find(j => j.id === socket.id && j.vidas <= 0);
        if (yoEstoyMuerto) {
            activarModoEspectador();
            document.getElementById('mensajeTurno').innerText = datosTurno.nombre;
            setTimeout(() => { dibujarMesaCircular(); }, 200);
            return;
        }

        dibujarMesaCircular();
        const esMio = socket.id === datosTurno.id;
        document.getElementById('mensajeTurno').innerText = esMio ? "ES TU TURNO!" : `Esperando a ${datosTurno.nombre}...`;
        document.getElementById('btnMantener').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnCambiar').style.display = esMio ? "inline-block" : "none";
        document.getElementById('btnMantener').disabled = !esMio;
        document.getElementById('btnCambiar').disabled = !esMio;

        setTimeout(() => {
            dibujarMesaCircular();
            gestionarRelojVisual(datosTurno.id, datosTurno.tiempo);
        }, 200);
    });

    document.getElementById('btnMantener').addEventListener('click', () =>
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'MANTENER' })
    );

    document.getElementById('btnCambiar').addEventListener('click', () => {
        socket.emit('accionJugador', { idSala: miSalaActual, accion: 'CAMBIAR' });
        let miCartaVisual = document.getElementById('miCarta');
        miCartaVisual.classList.remove('volar-desde-centro-bottom');
        miCartaVisual.classList.add('efecto-intercambio');
        setTimeout(() => { miCartaVisual.classList.remove('efecto-intercambio'); }, 1000);
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
        document.getElementById('btnMantener').style.display = "none";
        document.getElementById('btnCambiar').style.display = "none";

        mostrarToast(`Carta mortal: ${datos.cartaMortal}`, '', 4000);
        datos.jugadores.forEach(j => {
            const perdio = datos.perdedores.includes(j.id);
            mostrarToast(`${perdio ? 'Perdio' : 'Sobrevive'} ${j.nombre} carta ${j.cartaActual}`, perdio ? 'danio' : '', 4000);
        });

        if (datos.juegoTerminado) {
            mostrarToast('EL JUEGO HA TERMINADO!', 'rey', 5000);
        } else if (socket.id === datos.dealerId) {
            let btnSig = document.getElementById('btnSiguienteRonda');
            btnSig.classList.remove('hidden');
            btnSig.style.display = "inline-block";
        }
    });

    document.getElementById('btnSiguienteRonda').addEventListener('click', () => {
        socket.emit('siguienteRonda', miSalaActual);
        document.getElementById('btnSiguienteRonda').style.display = "none";
    });

    // --- NUEVA RONDA ---
    socket.on('nuevaRondaIniciada', (datos) => {
        desactivarModoEspectador();
        mostrandoRevelacion = false;
        perdedoresActuales = [];
        cartasRepartidas = false;
        _cartaPendiente = null;
        turnoActualId = "";
        listaJugadoresGlobal = datos.jugadoresActualizados || listaJugadoresGlobal;
        // Resetear cartaRevelada para que no queden 9s visibles de ronda anterior
        listaJugadoresGlobal.forEach(j => { j.cartaRevelada = false; j.cartaActual = undefined; });
        // Resetear cartaRevelada para que no persistan los 9 de la ronda anterior
        listaJugadoresGlobal.forEach(j => { j.cartaRevelada = false; });

        document.getElementById('mensajeTurno').innerText = "Esperando...";
        document.getElementById('mensajeTurno').style.color = "var(--verde)";
        document.getElementById('mazoCentral').style.display = "block";
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
        document.getElementById('mesaDeJuego').classList.add('hidden');
        document.getElementById('panelJugadores').classList.add('hidden');
        document.getElementById('mostrarCodigo').classList.add('hidden');
        document.getElementById('pantallaVictoria').classList.remove('hidden');
        document.getElementById('nombreGanador').innerText = ganador.nombre;
    });

    // --- VOLVER AL LOBBY ---
    document.getElementById('btnVolverLobby').addEventListener('click', () => {
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
    });

    // --- ERROR DE SALA ---
    socket.on('errorSala', (m) => {
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