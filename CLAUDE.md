# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
# Iniciar el servidor
yarn node server.js
# o con el script auxiliar
bash start.sh   # ejecuta PORT=4000 yarn node server.js

# Instalar dependencias
yarn install
```

Sin linter. Hay un script de tests E2E en `tests/e2e.js` que cubre auth, validación de inputs, sesión reemplazada, password de sala (bcrypt), whitelist de acciones y reacciones. Cómo correrlo:

```bash
# Una vez: instalar deps de testing fuera del proyecto (no están en package.json)
mkdir -p /tmp/rey-tests && cd /tmp/rey-tests
npm init -y && npm install socket.io-client@4 node-fetch@2

# Con el server corriendo en :4000 — usa SIEMPRE el envoltorio
tests/run.sh
```

**Ojo: las pruebas pegan a la base de producción (RDS).** Cada corrida registra
dos usuarios `t_<sufijo>_a`/`_b`. `tests/run.sh` corre `e2e.js` y después
`tests/limpiar-usuarios-prueba.js`, que los borra (solo nombres con ese patrón
exacto y 0 victorias). Para ver cuántos quedan sin borrar:
`yarn node tests/limpiar-usuarios-prueba.js --ver`.

Lo que NO cubre: animaciones, DOM, reconexión real, comportamiento puro del cliente.

Las reglas del juego (`reglas.js`) y los bots (`bots.js`) tienen pruebas unitarias aparte, sin servidor ni base:
`node --test tests/*.test.js` (Node 18+, `export PATH=/usr/bin:$PATH`).

## Arquitectura

**Rey Contento** es un juego de cartas multijugador en tiempo real que corre como un único proceso Node.js.

### Stack
- **Backend**: Express 5 + Socket.io 4 — `server.js` (sockets, turnos, timers y lo que se envía a cada quien)
- **Reglas puras**: `reglas.js` — `barajar`, `crearMazo`, `siguienteVivo` (siguiente jugador vivo a la derecha) y `resolverCartas` (resta vidas al final de la ronda y devuelve perdedores + mensajes). No habla con sockets: una regla nueva va aquí, con su prueba en `tests/reglas.test.js`
- **Bots**: `bots.js`
- **Base de datos**: Pool de conexiones MySQL2 hacia AWS RDS MariaDB — `db.js`
- **Frontend**: Vanilla JS + HTML/CSS plano servido como estáticos desde `public/`
- **Auth**: JWT (expiración 8h) emitido al hacer login; se pasa como `socket.handshake.auth.token` en cada conexión Socket.io. El token se persiste en `localStorage` y se restaura automáticamente al recargar la página (`restaurarSesion()` en `main.js`)

### Estado del servidor

Todo el estado vive en memoria dentro de `server.js`:
- `estadoSalas` — mapa `idSala → sala`. Cada sala tiene: `jugadores`, `mazo`, `descarte`, `config`, `password`, `dealerIndex`, `turnoActualIndex`, `estadoActual`, flags de campana
- `temporizadores` — timers de turno por sala (se cancelan y recrean en cada turno)
- `temporizadoresDesconexion` — timers de gracia por username (3 minutos antes de eliminar al jugador)
- `_socketRates` — tabla de rate limiting por socket (`socketId:evento → timestamp`)

**No hay persistencia de partidas** — un reinicio del servidor elimina todas las salas activas.

### Flujo de juego

```
crearSala / unirseSala → lobby
iniciarPartida → crearMazo() → iniciarRonda() (loop)
  └─ gestionarTurnos() → cambioDeTurno / juegoIniciado
       └─ accionJugador (MANTENER|CAMBIAR|CAMPANA) → ejecutarAccion()
            └─ gestionarTurnos() siguiente turno
                 └─ [dealer actuó] → resolverRonda()
                      └─ siguienteRonda | finDelJuego
quieroJugarOtraVez → iniciarRevancha()
```

### Modos de juego

**`modoJuego`**:
- `CLASICO` — pierde la carta más baja al final de la ronda
- `CAMPANA` — pierde la carta más alta; cualquier jugador puede tocar la campana en su turno para iniciar la última vuelta. El jugador adyacente derecho al ringer no puede intercambiar con él — roba del mazo en su lugar (`derechaEsRinger` en `ejecutarAccion`)

**`modoRey`**:
- `SORPRESA` — el 9 está oculto
- `DECLARADO` — cuando alguien recibe el 9, se revela públicamente de inmediato

**`dificultadBots`** (`bots.js`): `FACIL` (umbral fijo, se equivoca 1 de cada 4), `NORMAL` (calcula la probabilidad de perder si mantiene vs. si cambia) y `DIFICIL` (además cuenta el descarte y recuerda los cambios de la ronda en `bot.memoria`). Los bots solo usan información que un humano atento también tiene. En una simulación de 60 000 rondas pierden ~26, ~19 y ~16 vidas cada 100 rondas.

**`tiempoTurno`**: segundos por turno, uno de `TIEMPOS_TURNO` (7, 10, 15, 20; default 10). Un jugador desconectado recibe al menos 30s. El cliente toma la duración del campo `tiempo` de `juegoIniciado`/`cambioDeTurno`, nunca de un valor fijo.

**`frecuenciaReyes`**: controla qué tan seguido aparecen los 9s — `NORMAL` (aleatorio), `ALTA`, `LOCURA` (sesgados hacia las primeras rondas)

### Sala con contraseña

Al crear una sala se puede enviar `configuracion.password`. El servidor la guarda en `sala.password` (separado de `sala.config` que se expone al cliente). Al unirse, si la sala tiene contraseña y no coincide, el servidor emite `errorSala: 'WRONG_PASSWORD'`. El cliente muestra el campo de contraseña o un modal según si el join vino de un link o del panel manual.

### Desconexión y reconexión

- Al desconectarse **fuera de su turno**: timer de gracia de 3 minutos (`temporizadoresDesconexion`)
- Al desconectarse **en su turno**: el timer de turno se cancela y se reinicia en 8 segundos para no bloquear el juego
- Al reconectar: Socket.io está configurado con `reconnectionAttempts: Infinity`. El evento `visibilitychange` del navegador fuerza `socket.connect()` al desbloquear el teléfono. Al reconectar, el cliente emite `unirseSala` si tenía sala activa. El servidor responde con `reconexionExitosa` que incluye `turnoNombre` (username del jugador en turno, más estable que el socket ID)

### Rate limiting de sockets

La función `permitir(socketId, evento, limitMs)` en `server.js` bloquea eventos si se emiten antes de que expire el intervalo. Aplicado a `crearSala` (3s) y `accionJugador` (400ms). Las entradas se limpian en el evento `disconnect`.

### Stats

Tabla MySQL `usuarios`: `victorias`, `partidas_jugadas`, `racha_actual`, `racha_maxima`.
- `registrarFinPartida()` — actualiza al terminar la partida
- `agregarColumnasSiNoExisten()` — migración de esquema al arrancar; añadir nuevas columnas aquí en lugar de alterar el esquema manualmente
- `GET /leaderboard` — top 10 global
- `GET /mis-stats/:username` — stats de un jugador específico con `winrate` calculado

### Variables de entorno

Requeridas en `.env`:
```
DB_HOST=
DB_USER=
DB_PASSWORD=
DB_NAME=
JWT_SECRET=
PORT=4000
```

Opcionales:
```
ALLOWED_ORIGINS=http://34.204.215.13:4000,http://localhost:4000
DEBUG_LOG=1
```

- **`ALLOWED_ORIGINS`**: lista comma-separated de orígenes permitidos para CORS (HTTP + Socket.io). Si NO está definido, se permite cualquier origen y se loguea un warning al arrancar. En producción debe estar definido.
- **`DEBUG_LOG`**: si está set (valor truthy), activa nivel `log.debug(...)`. Default off.

### Frontend (`public/main.js`)

**Variables globales clave**:
- `miToken`, `miNombreUsuario`, `miSalaActual` — sesión activa
- `listaJugadoresGlobal` — estado local de jugadores (se sincroniza en cada evento)
- `campanaRingerId` — socket ID del jugador que tocó la campana en la ronda actual (para detectar el penúltimo jugador en modo Campana)
- `_cartaPendiente` — carta recibida vía `tuCarta` que espera ser animada en `juegoIniciado` o `cambioDeTurno`
- `modoReyActual`, `turnoActualId`, `mostrandoRevelacion`

**Funciones auxiliares clave**:
- `dibujarMesaCircular()` — función principal de renderizado; redibuja todos los asientos según cantidad de oponentes (1–7). Los `pos-*` CSS en `#mazoFlotante` se asignan aquí para mover el mazo junto al dealer
- `actualizarBotonesTurno(esMio, esCampana, campanaTocada)` — muestra/oculta el botón 🔔 y cambia el texto de CAMBIAR a "🃏 ROBAR" si el vecino derecho es el ringer
- `gestionarRelojVisual(id, segundos)` — reloj visual del turno; se llama dentro del callback de animación de carta (600ms después del evento) para que el jugador ya vea su carta cuando empieza el conteo
- `lanzarCoronasVictoria()` — genera partículas CSS animadas al mostrar la pantalla de victoria
- `restaurarSesion()` — verifica JWT en localStorage (decodifica el exp sin validar firma) y auto-logea si es válido

**Pantallas** (visibilidad controlada con clase `hidden`):
- `seccion-inicio` — login + leaderboard
- `pantallaJuego` — contenedor padre que engloba lobby (`seccion-lobby`) y mesa (`mesaDeJuego`); se muestra al hacer login
- `mesaDeJuego` — tapete de juego activo (dentro de `pantallaJuego`)
- `pantallaVictoria` — pantalla final

**Modales**: `modalReglas`, `modalPerfil`, `modalPasswordSala`

**Guías para quien empieza** (sección "GUÍAS PARA QUIEN EMPIEZA" en `main.js`): flecha SVG `#flechaGuia` de tu carta al vecino derecho (o al mazo si eres dealer o tu vecino tocó la campana), texto `#guiaAcciones` bajo los botones, banner `#bannerObjetivo` al iniciar la ronda y `#resumenExplicacion` en el resumen. Se prenden solas las primeras `PARTIDAS_CON_GUIAS` (3) partidas (`localStorage.reyPartidasGuia`, se cuenta en `finDelJuego`); el botón 💡 fija `reyGuias = on|off`. `actualizarGuiaTurno()` se llama desde `actualizarBotonesTurno()`, así que cubre los tres caminos de turno. Regla: **nunca** sugerir si conviene cambiar o mantener.

**`restaurarSesion()` va al FINAL de `main.js`**: `conectarSocket()` usa variables `let` declaradas más abajo; llamarla antes (estaba a media carga) lanzaba "Cannot access ... before initialization", cortaba el resto del archivo y quien volvía con sesión guardada veía la mesa congelada (arreglado el 23/09/2026).

**CSS importante**:
- `.hidden { display: none !important }` — nunca usar `display: flex !important` en clases que convivan con `hidden` porque el orden en el archivo determina cuál gana cuando tienen igual especificidad
- `#mazoFlotante.pos-*` — 8 clases de posicionamiento absoluto dentro del tapete que mueven el mazo junto al dealer
- `.reaccion-flotante` — `position: fixed` con `left/top` calculados desde `getBoundingClientRect()` y variables CSS `--dx`/`--dy` para flotar siempre hacia el centro del tapete
- Las animaciones de vuelo de carta (`volar-desde-centro-*`) duran 600ms — el flip y el reloj de turno arrancan en el callback de ese delay

### Trampas frecuentes

**Sincronización HTML ↔ JS**: `dibujarMesaCircular()` accede a elementos del DOM por ID. Si se elimina o renombra un elemento HTML que el JS referencia, la función fallará silenciosamente en el punto de acceso y **no dibujará a los oponentes** (el error detiene la ejecución antes de llegar al bucle de sillas). Verificar siempre que todo `getElementById(id)` tenga su contraparte en `index.html`, o añadir un guard: `const el = document.getElementById(id); if (el) el.innerText = ...`.

**Reset parcial de sillas**: `dibujarMesaCircular()` ahora limpia las 7 sillas posibles al inicio (no solo las 3 cardinales). Si en el futuro se añaden más asientos al HTML, agregarlos al array `TODAS_LAS_SILLAS` dentro de la función o volverán a quedar sillas "fantasma" cuando el número de oponentes baja.

**ID de jugadores**: en el evento `actualizarLobby`, el cliente remapea su propio jugador con `id: socket.id` para asegurar la coincidencia local. En `juegoIniciado`, `cambioDeTurno` y `reconexionExitosa`, `listaJugadoresGlobal` se reemplaza directamente con `datos.jugadores` que viene del servidor (con los socket IDs reales vigentes). `dibujarMesaCircular()` usa `findIndex(j => j.id === socket.id)` para identificar al jugador local; si no lo encuentra, cae en index 0 en lugar de fallar.

### Invariantes de timing (cliente ↔ servidor)

La cadena de un inicio de ronda es: el server emite `datosMesa` + `tuCarta` (t=0) y luego `juegoIniciado` (t=+500ms); el cliente guarda la carta en `tuCarta` y la anima al recibir el evento de turno. Estos invariantes mantienen sincronizados el cronómetro real del server y el reloj visual del cliente. Si tocás este flujo, preservalos:

- **La carta SOLO se revela en el evento posterior a `tuCarta`**, nunca dentro de `tuCarta`. `tuCarta` únicamente hace `_cartaPendiente = carta`; el revelado (flip + número) lo hacen `juegoIniciado`, `cambioDeTurno` o `rondaTerminada`, que consumen `_cartaPendiente`. **Nunca** revelar/animar dentro de `tuCarta` con un `setTimeout` propio: `juegoIniciado` llega ~500ms después y hace `++_renderGen`, que invalida ese callback (race) → la carta queda mostrando el dorso. Esto pasaba con el 9 de DECLARADO. El revelado público del 9 en DECLARADO es responsabilidad del server (`mensajeGlobal`) y del render de oponentes (`cartaRevelada`), no de la carta propia.
- **`iniciarReloj()` siempre con duración explícita**. Nunca llamarla sin el 3er argumento: el default de 10s pisaría la duración real del jugador (`config.tiempoTurno` online / ≥30s offline / 8s al desconectar en turno). `gestionarTurnos` ya arranca el reloj con la duración correcta — no agregar una segunda llamada a `iniciarReloj` "por las dudas" después de `gestionarTurnos`.
- **Colchón del primer turno de la ronda**. En `gestionarTurnos`, cuando `esInicio === true`, el timer REAL del server usa `tiempoTurno + SEG_EXTRA_PRIMER_TURNO` (1s), pero el campo `tiempo` enviado al cliente queda en `tiempoTurno`. Esto compensa que el reloj visual del cliente arranca ~800ms tarde (espera el vuelo de carta de 600ms + 200ms de delay) — sin el colchón el server cortaría el turno con ~1s aún visible en pantalla. En `cambioDeTurno` no se aplica porque ahí el reloj visual arranca sincrónico.

### Convenciones de frontend visual (animaciones, íconos, carga)

Estas convenciones se aplicaron al pulir el aspecto y la confiabilidad de carga del cliente. Si tocás estas zonas, mantenelas:

**Carga sin recursos externos bloqueantes**
- `socket.io` se sirve LOCAL desde el propio servidor: `<script src="/socket.io/socket.io.min.js">` (mismo origen, versión exacta del backend). **Nunca** volver a un CDN externo bloqueante — si el CDN falla o va lento, la página no carga (`main.js` necesita `io`).
- Librerías no críticas (TWEEN.js, qrcodejs) se cargan con `async` desde CDN, y el código tolera su ausencia (`typeof TWEEN/QRCode === 'undefined'` → fallback). Nunca hacerlas bloqueantes ni que `main.js` dependa de ellas al cargar.
- Google Fonts no-bloqueante (`media="print" onload="this.media='all'"` + `<noscript>`).
- **CSS crítico inline en `<head>`**: `<style>.hidden{display:none!important}</style>`. Imprescindible: sin él, antes de que cargue `style.css` los overlays con estilo inline (ej. `#vistaQR` con `display:flex`) parpadean visibles (FOUC). Todo overlay nuevo oculto por `.hidden` depende de esto.

**Overlays robustos en móvil**
- Los overlays a pantalla completa usan `position:fixed; inset:0; -webkit-overflow-scrolling:touch; transform:translateZ(0)`. El `inset:0` (no `width/height:100%`) y la capa de composición (`translateZ(0)`) evitan el "ghosting"/doble-render de elementos `fixed` en iOS. Patrón en `modalReglas` y `vistaQR`.

**Animaciones (TWEEN.js)**
- Ticker global corre SIEMPRE vía `requestAnimationFrame` y llama `TWEEN.update()` solo si TWEEN existe (porque carga `async`).
- Vuelo de tu carta: `animarVueloCartaTween(el, gen, onComplete)`. Respeta `_renderGen` (aborta si llegó otro evento). **Sin rotación en Z** (competía con el flip → parecía doble reparto).
- Reparto escalonado de oponentes: `repartirCartasEscalonado()` se dispara en `datosMesa`. Cartas "fantasma" (overlay `position:fixed`, z-index 40) vuelan del mazo a cada asiento, en orden DESDE el dealer. Reglas: el set `_repartiendo` marca qué jugadores tienen carta en vuelo y `dibujarMesaCircular` pinta sus reversos en `opacity:0` (para que un re-render no muestre la carta real encimada al fantasma); cada fantasma nace `opacity:0` y se hace visible en `onStart` (no durante su `delay`, si no quedaban cartas estáticas sobre el mazo).
- Resumen de ronda con respiro: `rondaTerminada` revela la carta nueva del dealer de inmediato pero demora `mostrarResumenRonda` ~1400ms (con guard de `gen`), para que el jugador vea qué carta sacó del mazo antes de que el pop-up la tape.

**Figuras de cartas (íconos SVG)**
- Las figuras son SVG locales en `public/iconos/0.svg`…`9.svg` (set game-icons.net, CC-BY 3.0 — atribución al pie del modal de reglas). **No** usar emojis (cada SO los dibuja distinto) ni un CDN de íconos en runtime.
- Mapa `figurasCartas` (n → ruta) + helper `figuraIMG(n, px)` que devuelve el `<img>`. La carta principal se pinta con `pintarCartaPrincipal(carta)` (número + figura + nombre + clase de color) — centraliza lo que antes se repetía en 4 eventos de revelado (`juegoIniciado`, `cambioDeTurno`, `rondaTerminada`, `reconexionExitosa`).
- Tamaño de la figura en la carta principal por CSS (`#figuraCarta img`, vía var); el `px` de `figuraIMG` es solo fallback.
- La pila central de descarte (`renderizarPila`) usa las figuras OSCURAS (`/iconos/N.svg`) sobre fondo pergamino. El mazo (`#mazoFlotante`) lleva un emblema heráldico dorado (`/iconos/mazo.svg`, fleur-de-lys) centrado en el dorso.

**Tamaños de carta adaptables (vars en `:root`)**
- `dibujarMesaCircular()` calcula y setea en `:root`, según la cantidad de oponentes (`numOp`) y si es celular (`window.innerWidth <= 768`), TODAS las dimensiones de carta: `--reverso-w/h` (boca-abajo), `--carta-w/h` + `--carta-num` + `--carta-fig` (tu carta: número y figura escalan con ella), `--mini-w/h` (oponentes revelados) y `--pila-w/h` (pila central). Regla general: **menos jugadores → cartas más grandes** (aprovechan el espacio); **mesa llena → más chicas**.
- El CSS base usa esas vars (con fallback); **no** poner tamaños fijos de carta en las media queries (pisarían las vars). Patrón heredado del de `--reverso-*`.
- El mazo HEREDA `.perfil-carta-reverso` (sin `width/height` inline) → coincide siempre con los asientos y la carta del reparto.
- El contenedor de nombre/vidas propio (`#miPerfil`) se posiciona con `bottom: calc(var(--carta-h) + offset)` para seguir la altura (variable) de tu carta y no encimarse.

**Tono de cartas (pergamino)**
- `.front-character` (tu carta), `.mini-carta-frente` (oponentes revelados) y `.carta-en-pila` (pila) comparten el mismo degradado pergamino. Las especiales lo pisan: `.carta-9`/`.mini-carta-9`/`.rey-pila` doradas, `.carta-0`/`.mini-carta-0`/`.cero-pila` grises.

**Despeje del mazo (auto-ajustable)**
- Las posiciones del mazo (`#mazoFlotante.pos-*`) calculan su offset con `calc()` en función del tamaño de carta (`--carta-w` para `pos-bottom`, `--reverso-w/h` para el resto), porque `.turno-activo` hace `scale(1.1)` + glow de ~70px. Así el mazo **se aleja solo cuando las cartas crecen** y se acerca cuando se achican — **no** volver a offsets fijos (quedaban cortos al cambiar el tamaño de carta). El `+Npx` de cada fórmula cubre el perfil + el glow.

**Layout de escritorio (formato celular)**
- En escritorio (`@media min-width:768px`) la mesa se muestra como **columna retrato centrada** (no a lo ancho): `.tapete-virtual` con `max-width: 470px`, `height: min(86vh, 760px)`, y `#mesaDeJuego { justify-content: center }` para centrarla verticalmente (es flex-column y solo contiene la mesa). Los asientos diagonales usan `%`, así que escalan al achicar la mesa.

**Visibilidad de pantallas (sin mezcla)**
- Jerarquía: top-level `seccion-inicio`, `pantallaJuego` (contiene `seccion-lobby` y `mesaDeJuego`) y `pantallaVictoria`. Dentro de `pantallaJuego`, lobby y mesa son excluyentes.
- Entrar a la mesa (`reconexionExitosa`, `tuCarta`, `datosMesa`) SIEMPRE oculta victoria, resumen y QR — si te reconectás desde esas pantallas no deben quedar encimadas.
- `finDelJuego` oculta mesa, footer (`panelAccionesPartida`), código, reacciones y QR antes de mostrar victoria. `btnVolverLobby` oculta mesa y footer explícitamente.

**Compartir sala**: `linkDeSala()` arma el link con IP pública fija (no `window.location.origin`, para que sirva aunque el host haya entrado por localhost). Reusado por "Copiar enlace" y el QR (`vistaQR` + `mostrarVistaQR`/`ocultarVistaQR`).

**Botones de acción y accesibilidad** (bloque final de `style.css`): MANTENER en madera con filo de oro y CAMBIAR en oro acuñado, dentro de la paleta del juego (no volver a azul/rojo genéricos). Suben con `acciones-entran` cada vez que se muestran (inicio de tu turno). Atajos de teclado `ATAJOS_MESA` en `main.js` (M, C, B) que simulan el clic; la letra se ve solo con `(hover: hover) and (pointer: fine)` vía `data-tecla`. Foco `:focus-visible` dorado y `prefers-reduced-motion` que apaga las animaciones en bucle.

**Jerarquía de botones fuera de la mesa**: `.boton-oro` para la acción principal de cada pantalla (Crear partida, Empezar, Revancha) y `.boton-madera` para volver/salir. No usar `boton-medieval-verde`/`-rojo` en pantallas nuevas.

**Lobby**: `.lobby-blason` (emblema `mazo.svg` + nombre + lema) arriba de las pestañas; dentro de una sala se achica con `:has(#panelJugadores:not(.hidden))`.

**Victoria**: `pintarFinalPartida(ganador)` pone título distinto si ganaste, tu lugar y la tabla final (`#tablaFinal`). El servidor solo manda al ganador, así que el orden de caída lo anota `registrarCaidas()` en cada `rondaTerminada` (`_caidasPartida`, se vacía al pintar el final).

**Idioma**: todo el texto visible en **español de México (tuteo)** — "tú"/"tienes"/"escanea", nunca voseo ("vos"/"tenés"/"escaneá"). Vocabulario: **"celular"** (no "móvil"), **"enlace"** (no "link"). Los identificadores de código preexistentes (`btnCopiarLink`, `linkDeSala`, clase `btn-copiar-link`) se mantienen.

### Convenciones de seguridad y robustez

Estas convenciones se aplicaron tras un hardening pass. Si trabajás en código que las toca, mantenelas:

- **Identidad por username, no por socket.id**: handlers que mutan estado de sala (`accionJugador`, `iniciarPartida`, `siguienteRonda`) validan `socket.usuario.username` contra `sala.jugadores[N].nombre`. El `socket.id` cambia en cada reconexión y abre ventanas de race.
- **Nunca emitir `sala.jugadores` tal cual**: usar `jugadoresPublicos(sala)`. Trae la carta oculta de todos y la memoria de los bots; el helper solo deja pasar `cartaActual` al revelar la ronda o si es un Rey declarado, y calcula `cartaRevelada` en cada envío. Hasta el 23/09/2026 las cartas de todos viajaban en cada turno y se podían ver en las herramientas del navegador.
- **Whitelist de acciones**: `accionJugador` rechaza cualquier `accion` fuera de `['MANTENER', 'CAMBIAR', 'CAMPANA']` antes de tocar estado.
- **`sanitizarConfig()`**: toda config que viene del cliente en `crearSala` pasa por este helper en `server.js`. Hace clamp de rangos (vidas 1-10, maxJugadores 2-8, numBots 0..max-1) y valida enums. Agregar nuevos campos de config significa actualizar este helper también.
- **Passwords de sala**: se hashean con `bcrypt.hashSync` al crear y se comparan con `bcrypt.compareSync` al unirse. **Nunca** guardar `sala.password` en plaintext.
- **Shuffle**: usar siempre el helper `barajar()` (Fisher-Yates). **Nunca** `arr.sort(() => Math.random() - 0.5)` — no produce distribución uniforme. Esto aplica a TODOS los reshuffles, incluidos los de `ejecutarAccion` cuando el mazo se agota (robo del dealer y robo del vecino del ringer) — todos pasan por `barajar([...sala.descarte])`.
- **Guards de existencia de sala en timers**: `resolverRonda`, `iniciarRonda` e `iniciarRevancha` empiezan con `if (!estadoSalas[sala.idSala]) return;`. Cualquier nueva función que se invoque desde un `setTimeout` debería hacer lo mismo, o el callback puede ejecutarse sobre una sala ya borrada.
- **Sesión duplicada**: al hacer `unirseSala` con un username que ya tiene socket vivo, el servidor reasigna el id ANTES de desconectar al socket anterior (orden importante — invertido, el `disconnect` handler limpia al jugador legítimo) y emite `sesionReemplazada` con un delay de 150ms para que el paquete viaje antes del close. El cliente desactiva `socket.io.opts.reconnection` al recibirlo.
- **DOM listeners dentro de `conectarSocket()`**: usar asignación `.onclick = fn` (o `.oninput`, etc.), **nunca** `.addEventListener`. La asignación es idempotente — si `conectarSocket()` corre dos veces, no duplica handlers.
- **Cleanup de socket viejo**: `conectarSocket()` empieza removiendo todos los listeners y desconectando el socket previo si existe. No quitar esto: sin ello, los handlers del socket viejo siguen disparándose en eventos del nuevo.
- **Avanzar turno al sacar a un jugador en su turno**: cualquier handler que ponga `vidas = 0` a un jugador que está en turno (`abandonarSala`) debe cancelar `temporizadores[idSala]` y avanzar al siguiente vivo (o llamar `resolverRonda` si era el dealer). Sin esto la partida se cuelga: el timer dispara `ejecutarAccion('MANTENER')`, que corta temprano en `if (jugadorActual.vidas <= 0) return` sin avanzar, y la sala queda atascada hasta que el sweeper la borre (30 min).
- **Rate limit de endpoints de lectura**: `/leaderboard` y `/mis-stats` usan el limiter `limitarLectura` (200 req/15min por IP). Pegan a la DB sin auth y se consultan en cada carga de la pantalla de inicio, así que el límite es generoso pero acotado para frenar scraping. Todo endpoint HTTP nuevo que toque la DB debe llevar algún limiter (`limitarAuth`/`limitarLogin`/`limitarLectura` según el caso).
