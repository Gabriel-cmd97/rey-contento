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

No hay suite de pruebas ni linter configurado.

## Arquitectura

**Rey Contento** es un juego de cartas multijugador en tiempo real que corre como un único proceso Node.js.

### Stack
- **Backend**: Express 5 + Socket.io 4 — `server.js`
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

**CSS importante**:
- `.hidden { display: none !important }` — nunca usar `display: flex !important` en clases que convivan con `hidden` porque el orden en el archivo determina cuál gana cuando tienen igual especificidad
- `#mazoFlotante.pos-*` — 8 clases de posicionamiento absoluto dentro del tapete que mueven el mazo junto al dealer
- `.reaccion-flotante` — `position: fixed` con `left/top` calculados desde `getBoundingClientRect()` y variables CSS `--dx`/`--dy` para flotar siempre hacia el centro del tapete
- Las animaciones de vuelo de carta (`volar-desde-centro-*`) duran 600ms — el flip y el reloj de turno arrancan en el callback de ese delay

### Trampas frecuentes

**Sincronización HTML ↔ JS**: `dibujarMesaCircular()` accede a elementos del DOM por ID. Si se elimina o renombra un elemento HTML que el JS referencia, la función fallará silenciosamente en el punto de acceso y **no dibujará a los oponentes** (el error detiene la ejecución antes de llegar al bucle de sillas). Verificar siempre que todo `getElementById(id)` tenga su contraparte en `index.html`, o añadir un guard: `const el = document.getElementById(id); if (el) el.innerText = ...`.

**Reset parcial de sillas**: `dibujarMesaCircular()` ahora limpia las 7 sillas posibles al inicio (no solo las 3 cardinales). Si en el futuro se añaden más asientos al HTML, agregarlos al array `TODAS_LAS_SILLAS` dentro de la función o volverán a quedar sillas "fantasma" cuando el número de oponentes baja.

**ID de jugadores**: en el evento `actualizarLobby`, el cliente remapea su propio jugador con `id: socket.id` para asegurar la coincidencia local. En `juegoIniciado`, `cambioDeTurno` y `reconexionExitosa`, `listaJugadoresGlobal` se reemplaza directamente con `datos.jugadores` que viene del servidor (con los socket IDs reales vigentes). `dibujarMesaCircular()` usa `findIndex(j => j.id === socket.id)` para identificar al jugador local; si no lo encuentra, cae en index 0 en lugar de fallar.

### Convenciones de seguridad y robustez

Estas convenciones se aplicaron tras un hardening pass. Si trabajás en código que las toca, mantenelas:

- **Identidad por username, no por socket.id**: handlers que mutan estado de sala (`accionJugador`, `iniciarPartida`, `siguienteRonda`) validan `socket.usuario.username` contra `sala.jugadores[N].nombre`. El `socket.id` cambia en cada reconexión y abre ventanas de race.
- **Whitelist de acciones**: `accionJugador` rechaza cualquier `accion` fuera de `['MANTENER', 'CAMBIAR', 'CAMPANA']` antes de tocar estado.
- **`sanitizarConfig()`**: toda config que viene del cliente en `crearSala` pasa por este helper en `server.js`. Hace clamp de rangos (vidas 1-10, maxJugadores 2-8, numBots 0..max-1) y valida enums. Agregar nuevos campos de config significa actualizar este helper también.
- **Passwords de sala**: se hashean con `bcrypt.hashSync` al crear y se comparan con `bcrypt.compareSync` al unirse. **Nunca** guardar `sala.password` en plaintext.
- **Shuffle**: usar siempre el helper `barajar()` (Fisher-Yates). **Nunca** `arr.sort(() => Math.random() - 0.5)` — no produce distribución uniforme.
- **Guards de existencia de sala en timers**: `resolverRonda`, `iniciarRonda` e `iniciarRevancha` empiezan con `if (!estadoSalas[sala.idSala]) return;`. Cualquier nueva función que se invoque desde un `setTimeout` debería hacer lo mismo, o el callback puede ejecutarse sobre una sala ya borrada.
- **Sesión duplicada**: al hacer `unirseSala` con un username que ya tiene socket vivo, el servidor reasigna el id ANTES de desconectar al socket anterior (orden importante — invertido, el `disconnect` handler limpia al jugador legítimo) y emite `sesionReemplazada` con un delay de 150ms para que el paquete viaje antes del close. El cliente desactiva `socket.io.opts.reconnection` al recibirlo.
- **DOM listeners dentro de `conectarSocket()`**: usar asignación `.onclick = fn` (o `.oninput`, etc.), **nunca** `.addEventListener`. La asignación es idempotente — si `conectarSocket()` corre dos veces, no duplica handlers.
- **Cleanup de socket viejo**: `conectarSocket()` empieza removiendo todos los listeners y desconectando el socket previo si existe. No quitar esto: sin ello, los handlers del socket viejo siguen disparándose en eventos del nuevo.
