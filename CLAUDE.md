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

# Reiniciar en producción: SIEMPRE con esto, no con pm2 restart directo.
# Espera a que no haya humanos jugando (máx. 30 min) y hace pm2 save.
bin/reiniciar          # --ya para forzar
```

**Respaldo en GitHub**: `github.com/Gabriel-cmd97/rey-contento` (privado), remoto `origin` = `github-rey:...` con la llave de despliegue `~/.ssh/rey_contento_deploy` (Host `github-rey` en `~/.ssh/config`). `bin/respaldar` guarda lo pendiente como "Respaldo automático" y hace push; cron lo corre a las 03:30 (registro en `.respaldo.log`). Nunca se suben `.env` ni las partidas guardadas.

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
- `estadoSalas` — mapa `idSala → sala`. Cada sala tiene: `jugadores`, `mazo`, `descarte`, `config`, `password`, `dealerIndex`, `turnoActualIndex`, `estadoActual`
- `temporizadores` — timers de turno por sala (se cancelan y recrean en cada turno)
- `temporizadoresDesconexion` — timers de gracia por username (3 minutos antes de eliminar al jugador)
- `_socketRates` — tabla de rate limiting por socket (`socketId:evento → timestamp`)

**Las partidas sobreviven a un reinicio** (sección PERSISTENCIA DE SALAS en `server.js`): `guardarSalas()` escribe las salas activas con humanos (LOBBY, TURNOS_INTERCAMBIO, REVELACION, PREPARANDO_NUEVA_RONDA) en `.estado-salas.json` al apagar (`shutdownGracefully`) y cada 10 s (por si hay una caída), escribiendo a `.tmp` y renombrando. Al arrancar, `restaurarSalas()` las carga si tienen menos de 10 min: humanos en `online = false` con `programarGraciaDesconexion()` (3 min), y a los `MS_REANUDAR` (6 s) sigue el turno pendiente o arranca la siguiente ronda; las salas rápidas en espera reprograman su arranque. El cliente se reconecta solo y `unirseSala` lo devuelve a su lugar (`reconexionExitosa`). Las salas FINALIZADAS no se guardan. Aunque sobreviven, el reinicio se nota (reconexión en plena ronda): usa `bin/reiniciar`, que espera a que nadie esté jugando. Si agregas a la sala un campo que no sea JSON (Set, Map, timers), exclúyelo en `guardarSalas()`.

### Flujo de juego

```
crearSala / unirseSala → lobby
iniciarPartida → crearMazo() → iniciarRonda() (loop)
  └─ gestionarTurnos() → cambioDeTurno / juegoIniciado
       └─ accionJugador (MANTENER|CAMBIAR) → ejecutarAccion()
            └─ gestionarTurnos() siguiente turno
                 └─ [dealer actuó] → resolverRonda()
                      └─ siguienteRonda | finDelJuego
quieroJugarOtraVez → iniciarRevancha()
```

### Modos de juego

**`modoJuego`**:
- `CLASICO` — pierde la carta más baja al final de la ronda; eventos a veces (desde la ronda 2).
- `FIESTA` (24/09/2026) — mismas reglas, pero **evento en todas las rondas** (también la 1) y la mesa **vota** el de la siguiente: `resolverRonda` pone `sala.votacion = { opciones, votos }` con `eventos.opcionesVotacion()` (3 al azar entre `disponibles()`, sin repetir el último; los bots votan al azar; no en el duelo), lo manda en `rondaTerminada.votacion` y el socket `votarEvento { idSala, evento }` (cualquier humano de la mesa, también eliminados; se ve quién votó qué) responde a todos con `votosEvento`. `elegirEvento` toma el más votado (empate: azar) y borra la votación. El cliente la pinta en `#resumenVotacion` (`pintarVotacion`). En el historial el modo es `FIESTA`. Prueba: `tests/fiesta.js` (la corre `tests/run.sh`).
- **Se quitó el modo Campana** el 24/09/2026 (confundía al invertir la regla, no tenía Rey y partía a los jugadores en dos modos). `sanitizarConfig` fija `CLASICO`. En el historial quedan partidas viejas con modo `CAMPANA` (por eso `NOMBRE_MODO` lo conserva) y el logro `oido_fino` está `retirado` (solo lo ve quien ya lo tenía). Un modo nuevo que haga perder la carta más alta debe pasar por `reyProtegido()` y por el `pierdeAlta` de `bots.js`.

**`modoRey`**:
- `SORPRESA` — el 9 está oculto y **nada debe delatarlo**: el turno de quien lo tiene se ve como cualquier otro (`reyOculto` en `gestionarTurnos`: pausa de bot y `MANTENER`, sin `turnoSaltadoVisual` ni mensaje). Solo se descubre al chocar (`BLOQUEO`): ahí `jugador.reyDescubierto = true` y `jugadoresPublicos` muestra su 9 el resto de la ronda.
- `DECLARADO` — el 9 se reparte boca abajo y se revela a `MS_REVELAR_REY` (2 s): el servidor avisa quién lo tiene (o quiénes, si hay varios) y el cliente lo voltea con destello (`programarRevelacionRey`). El primer turno espera a después de la revelación. Quien tiene al Rey salta su turno a la vista y su vecino de la izquierda queda "atrapado".
- **Gran revelación** (`mostrarGranRey()` + `#granRey`): carta grande del Rey al centro con rayos dorados, que luego vuela a su asiento. En DECLARADO sale a los `MS_REVELAR_REY` del reparto (1.6 s + vuelo); el servidor espera `MS_GRAN_REY` (2.8 s) más antes del primer turno y el Rey sigue boca abajo en la mesa hasta que llega (`_reyOcultoHasta`). En SORPRESA sale más breve ("¡Bloqueo real!") al chocar. Los avisos de texto del Rey ya no se muestran: lo dice la revelación.
- En ambos, quien tiene el 9 nunca lo suelta: `ejecutarAccion` convierte su `CAMBIAR` en `MANTENER`.

**`dificultadBots`** (`bots.js`): **fija en `NORMAL`** desde el 24/09/2026 (se quitó el selector: demasiadas opciones al crear mesa; `sanitizarConfig` ignora lo que mande el cliente). Las tres siguen en el código: `FACIL` (umbral fijo, se equivoca 1 de cada 4), `NORMAL` (calcula la probabilidad de perder si mantiene vs. si cambia) y `DIFICIL` (además cuenta el descarte y recuerda los cambios de la ronda en `bot.memoria`). Los bots solo usan información que un humano atento también tiene. En una simulación de 60 000 rondas pierden ~26, ~19 y ~16 vidas cada 100 rondas.

**`tiempoTurno`**: fijo en `TIEMPO_TURNO` (20 s) para todos los modos; ya no se elige al crear sala (con eventos, poderes y parejas hace falta tiempo para ver la mesa). La práctica usa 60 s y un jugador desconectado al menos 30 s. El cliente toma la duración del campo `tiempo` de `juegoIniciado`/`cambioDeTurno`, nunca de un valor fijo.

**`frecuenciaReyes`**: se **sortea** al crear la sala (y en la rápida) desde el 24/09/2026, ya no se elige; la sala de espera lo muestra en "Cómo será la partida" (`pintarComoSeraPartida()`, con la `config` que ahora trae `actualizarLobby`, sin contraseña). Controla qué tan seguido aparecen los 9s — `NORMAL` (aleatorio), `ALTA`, `LOCURA` (sesgados hacia las primeras rondas)

### Sala con contraseña

Al crear una sala se puede enviar `configuracion.password`. El servidor la guarda en `sala.password` (separado de `sala.config` que se expone al cliente). Al unirse, si la sala tiene contraseña y no coincide, el servidor emite `errorSala: 'WRONG_PASSWORD'`. El cliente muestra el campo de contraseña o un modal según si el join vino de un link o del panel manual.

### Desconexión y reconexión

- Al desconectarse **fuera de su turno**: timer de gracia de 3 minutos (`temporizadoresDesconexion`)
- Al desconectarse **en su turno**: el timer de turno se cancela y se reinicia en 8 segundos para no bloquear el juego
- Al reconectar: Socket.io está configurado con `reconnectionAttempts: Infinity`. El evento `visibilitychange` del navegador fuerza `socket.connect()` al desbloquear el teléfono. Al reconectar, el cliente emite `unirseSala` si tenía sala activa. El servidor responde con `reconexionExitosa` que incluye `turnoNombre` (username del jugador en turno, más estable que el socket ID)

### Inactividad (modo automático)

Si se acaba el tiempo de un jugador, `iniciarReloj` juega por él con `decisionPorAusente()` (cálculo de bot NORMAL, no solo mantener) y suma `turnosSinJugar`. Con `TURNOS_PARA_AUTOMATICO` (2) seguidos, `activarAutomatico()` lo pone en modo automático: `gestionarTurnos` lo trata como bot (ritmo de bot, puede usar poderes) y la mesa ve "Auto" en su asiento. Desconectarse más de 3 minutos también lo pone en automático (antes lo eliminaba). Recupera el control con `volverAJugar` (botón del aviso `#avisoAutomatico`), con cualquier jugada o poder, o al reconectarse (`desactivarAutomatico`). En la práctica no aplica.

### Salir y llegar tarde

- **Salir de la partida**: opción del menú de la mesa (`data-accion="salir"`) con confirmación propia `#modalSalirPartida`; manda `abandonarSala` (el servidor hace `socket.leave`, la mesa sigue sin ti) y vuelve al lobby como "Volver a la Corte". Si sales desde la victoria, dejas de contar para la revancha.
- **Llegar cuando ya terminó**: `unirseSala` a una sala FINALIZADA (no práctica ni rápida) te sienta y cuenta como voto de revancha (`esperandoRevancha` en el cliente); entras en lugar de un bot. A media partida el aviso dice que podrás entrar en la revancha.

### Salas sin humanos

`cerrarSalasSinHumanos()` (cada minuto) cierra una partida en juego si lleva `SALA_SIN_HUMANOS_MS` (5 min) sin ningún humano conectado en la mesa (vivo o mirando). Sin esto, los bots —y los humanos en automático— la seguían jugando para siempre y el sweeper no la veía inactiva. `sala.ultimoHumano` se reinicia al restaurar tras un reinicio para dar tiempo a reconectarse.

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
- **`PANEL_CLAVE`**: clave del panel de uso (`/estadisticas.html`), que se manda en el encabezado `x-clave` a `GET /api/panel`. Sin ella el panel queda apagado.

### Frontend (`public/main.js`)

**Variables globales clave**:
- `miToken`, `miNombreUsuario`, `miSalaActual` — sesión activa
- `listaJugadoresGlobal` — estado local de jugadores (se sincroniza en cada evento)
- `_cartaPendiente` — carta recibida vía `tuCarta` que espera ser animada en `juegoIniciado` o `cambioDeTurno`
- `modoReyActual`, `turnoActualId`, `mostrandoRevelacion`

**Funciones auxiliares clave**:
- `dibujarMesaCircular()` — función principal de renderizado; redibuja todos los asientos según cantidad de oponentes (1–7). Los `pos-*` CSS en `#mazoFlotante` se asignan aquí para mover el mazo junto al dealer
- `actualizarBotonesTurno(esMio)` — repinta los poderes y la guía del turno
- `gestionarRelojVisual(id, segundos)` — reloj visual del turno; se llama dentro del callback de animación de carta (600ms después del evento) para que el jugador ya vea su carta cuando empieza el conteo
- `lanzarCoronasVictoria()` — genera partículas CSS animadas al mostrar la pantalla de victoria
- `restaurarSesion()` — verifica JWT en localStorage (decodifica el exp sin validar firma) y auto-logea si es válido

**Pantallas** (visibilidad controlada con clase `hidden`):
- `seccion-inicio` — login + leaderboard
- `pantallaJuego` — contenedor padre que engloba lobby (`seccion-lobby`) y mesa (`mesaDeJuego`); se muestra al hacer login
- `mesaDeJuego` — tapete de juego activo (dentro de `pantallaJuego`)
- `pantallaVictoria` — pantalla final

**Modales**: `modalReglas`, `modalPerfil`, `modalPasswordSala`

**Logros e historial**: catálogo en `logros.js` (única fuente; el cliente lo recibe en `/mis-stats` → `catalogoLogros` y en el aviso `logroDesbloqueado`). Tablas `historial` (una fila por humano y partida) y `logros` (PK username+logro), creadas por `crearTablasSiNoExisten()` al arrancar. El servidor lleva `sala.caidas` y `sala.vidasPerdidas` (se reinician en la ronda 1); `registrarHistorialYLogros()` guarda el historial y decide los logros de fin de partida con `logrosDeFinDePartida()`. Los de momento (`oido_fino`, `muro_del_rey`, `aprendiz`) se otorgan con `otorgarLogro()` donde ocurren. La práctica no suma nada salvo `aprendiz`. `/mis-stats` devuelve también `logros` y las últimas 10 partidas; el perfil los pinta con `pintarLogrosPerfil()` y `pintarHistorialPerfil()`. Para un logro nuevo: agrégalo al catálogo y otórgalo en `server.js`.

**Apuestas, Rey de la mesa y Torneo de la noche** (25/09/2026). *Apuestas*: quien ya quedó fuera (humano, vidas 0) elige en `#panelApuesta` quién pierde la ronda (socket `apostar`); se cierran en la primera jugada (`apuestasCerradas`) y `resolverApuestasYCorona()` paga +15 XP si acertó. *Rey de la mesa*: el ganador (no en parejas) queda como `sala.reyDeMesa` para la revancha (`j.reyMesa` = coronas seguidas); derrocarlo da +25 XP a los humanos vivos y defender la corona +30. Todo eso se acumula en `sala.bonusXp` con `darBonus()` y llega junto con la XP de la partida (`progreso.extras`, se desglosa en la victoria). *Torneo de la noche* (reglas en `torneo.js`, pruebas en `tests/torneo.test.js`): 9 pm CDMX, inscripción 10 min antes con `#bannerTorneo` (socket `torneoInscribir`; el estado llega con `torneo` a todos). A la hora, `arrancarTorneo()` sienta a los inscritos conectados en mesas de hasta 6 (`crearMesaTorneo`, como la rápida: `torneoUnido`, 15 s y bots; la final va sin bots). Los humanos que ganan su mesa van a la final (`revisarFaseTorneo`); el campeón es Rey de la noche 24 h (tabla `torneos`, `reyDeLaNoche`, `j.reyNoche`) y gana 100 XP. En mesas de torneo no hay revancha ni "Empezar" manual. Fase que no termina en 25 min se cierra con lo que haya. `POST /api/torneo/abrir { segundos }` con `x-clave: PANEL_CLAVE` lo abre a mano para probar (no bloquea el de la noche). El estado del torneo vive en memoria: un reinicio a media fase lo pierde.

**Niveles y recompensa diaria** (25/09/2026; reglas puras en `progreso.js`, pruebas en `tests/progreso.test.js`): columnas `usuarios.xp`, `racha_diaria` y `dia_premio` ('AAAA-MM-DD' en CDMX). Al terminar una partida (no práctica) `sumarXpDePartida()` da `xpDePartida()` (20 + 3 por ronda aguantada, tope 30, + 40 si ganó) y emite `progreso { ganada, xpAntes, xpAhora, antes, ahora, desbloqueos }` a cada humano conectado; la victoria lo anima en `#progresoXP` (`animarProgreso`, festeja si subió de nivel). Nivel n pide `50·(n-1)·n` XP (100, 300, 600, 1000…). Cosméticos con `nivel` en el catálogo se abren al llegar (`disponible(tipo, id, logros, nivel)`; `desbloqueadosPorNivel`). Recompensa diaria: `GET /premio-diario` (estado) y `POST /premio-diario` (cobra; el `UPDATE … AND dia_premio <=> ?` evita cobrar dos veces con dos pestañas), racha de 7 días (20, 30, 40, 50, 60, 80, 150 XP; faltar un día la reinicia). El cliente pregunta al entrar (`revisarPremioDiario`, desde `pintarUsuarioBarra`) y muestra `#modalPremio`. Tu nivel sale en la barra (`#nivelTop`) y en el perfil (`#pNivel`); `/mis-stats` trae `nivel`. El 25/09/2026 se dio XP retroactiva a los 6 jugadores reales con partidas anteriores (historial antes de las 16:10 UTC con las reglas de `xpDePartida`; partidas sin historial a 20 y victorias a 40): 3212 XP en total. Respaldo del XP previo en `~/respaldos/rey-xp-antes-retroactivo-20260925.json`.

**Cosméticos** (25/09/2026; `cosmeticos.js` es la única fuente): avatar (ícono del sprite en lugar de la inicial), marco (`.marco-<id>`) y dorso de carta (`.dorso-<id>`). No cambian el juego. Se desbloquean con logros (`logro` en el catálogo; sin `logro` = de todos). Se guardan como JSON en `usuarios.cosmeticos`; `POST /cosmeticos { tipo, id }` con `Authorization: Bearer` valida que lo tengas contra la tabla `logros`. En memoria, `looks[username]` (se carga al conectarse el socket con `cargarLook` y se actualiza al elegir) y `jugadoresPublicos` lo manda como `j.look` (solo humanos). `/mis-stats` trae `cosmeticos: { catalogo, elegidos }`. En el cliente: `pintarCosmeticosPerfil()` (sección "Mis cosméticos" del perfil), `pintarMiLook()` (barra de arriba y el dorso de tu carta), `contenidoAvatar/claseMarco/claseDorso` en la lista de la sala de espera y los asientos. Para agregar uno: súmalo al catálogo y, si es marco o dorso, su clase en `style.css` (bloque COSMÉTICOS). Más adelante: monedas por partida, tienda y anuncios con recompensa.

**Escanear QR para unirse** (botón en la pestaña Unirse): el QR de la sala lleva `linkDeSala()` y `codigoDesdeQR()` saca el código (…/sala/ABCDE, ?sala= o el código solo). Mientras el juego vaya por HTTP el navegador **no permite la cámara en vivo**, así que se usa `<input type="file" capture="environment">` (foto) y `leerQRDeFoto()` la decodifica con jsQR (se carga de jsdelivr al usarlo). Con HTTPS (`isSecureContext`) el mismo botón abre `#escanerQR` con la cámara en vivo. Al leer un código se llena `#inputCodigo` y se simula el clic en "Unirse a la partida".

**Mesas abiertas** (pestaña Unirse): evento `listarSalas` → `salasAbiertas` con las salas en LOBBY sin contraseña, sin práctica, **rápidas o marcadas públicas** (`config.publica`, selector Visibilidad en Más opciones; desde el 25/09/2026 las mesas creadas son privadas por defecto: solo con código/enlace/QR; el anfitrión la abre o cierra en la sala de espera tocando `#chipVisibilidad` → socket `cambiarVisibilidad { idSala, publica }`, no si tiene contraseña; `actualizarLobby.config.conContrasena` lo avisa), con lugar y al menos un humano conectado. El cliente la pide cada 4 s solo mientras la pestaña Unirse está a la vista (`window.alAbrirUnirse`, lo llama `switchTab`).

**Recuperación de cuenta** (sin correo): al registrarse, `/registro` devuelve `codigoRecuperacion` (12 caracteres, se muestra una sola vez en `#modalCodigo`); en la base solo queda su hash bcrypt en `usuarios.codigo_recuperacion`. `POST /recuperar { username, codigo, password }` (límite de login, error único, comparación contra hash dummy) cambia la contraseña y entrega un código nuevo. `POST /codigo-recuperacion` con `Authorization: Bearer <token>` genera uno nuevo desde el perfil (sirve a cuentas anteriores a esta función).

**Panel de uso** (`/estadisticas.html`, clave `PANEL_CLAVE`): `GET /api/panel` junta totales, partidas y jugadores por día (14 días, hora de CDMX = UTC-6), ronda de caída, abandonos, modos, logros y lo que pasa en vivo (`io.engine.clientsCount`, salas en memoria). **Ritmo del juego** (sección del panel): `historial.duracion_seg` (desde `sala.inicioPartida`) da la duración de partida y de ronda; la tabla `decisiones` guarda cuánto tarda una persona en decidir (`jugada`, desde `sala.inicioTurno` hasta su `accionJugador`), cuándo se le acaba el tiempo (`tiempo`) y cuándo pasa a automático (`auto`), vía `registrarDecision()` (sin bots ni práctica; se inserta sin esperar). El panel muestra promedio, percentil 90, % de tiempo agotado y tramos de 5 s de los últimos 30 días. Las partidas se cuentan por `historial.partida` (`sala.idPartida`); las filas anteriores a esa columna se agrupan por ganador y minuto.

**Eventos de ronda** (`eventos.js`, nunca en práctica ni duelo; 9 en total; desde el 24/09/2026 siempre prendidos: se quitó la opción del lobby y `sanitizarConfig` fija `eventos: true`): `elegirEvento()` decide en `iniciarRonda` (35 % desde la ronda 2, seguro tras 3 rondas sin evento, nunca el mismo dos seguidas) y se guarda en `sala.evento` solo esa ronda. Dónde vive cada regla: MUNDO_AL_REVES en `resolverCartas` (pierde la más alta) y `reyProtegido()` (el Rey no protege); NIEBLA en `enviarCarta()` (no se manda `tuCarta`; el cliente la descubre en `rondaTerminada`); DOBLE_CASTIGO y AMNISTIA en `resolverCartas` (esta devuelve `castigados`, que se guardan por nombre en `sala.castigadosSiguiente` y saltan su turno en la ronda siguiente); MERCADO en `ejecutarAccion` (cambiar = robar del mazo). Eventos "de amigos" (24/09/2026): CARRUSEL en `resolverRonda` antes de `resolverCartas` (`reglas.rotarCartas`: todos pasan a la derecha, el Rey protegido se queda; se manda `tuCarta` a cada quien antes de `rondaTerminada`); CONFESION en `iniciarRonda` (carta de alguien al azar, anunciada a los `introMs`; los bots la guardan en `memoria`; si es el 9 queda `reyDescubierto`); VENGANZA (`sala.vengadores` = quien perdió vida y sigue vivo, se calcula en cada `resolverRonda`; `datosMesa.vengadores`; `accionJugador` acepta `objetivo` (nombre) y lo valida con `puedeVengarse()`, pasa `{ objetivoIndex, venganza }` a `ejecutarAccion`, que deja cambiar incluso al dealer; el escudo y el Rey sí frenan; los bots usan `bots.objetivoVenganza()`, solo con cartas que conocen; en el cliente `body.venganza-activa` y tocar un asiento); PREMIO en `resolverCartas` (la más alta gana una vida hasta `config.vidas`, devuelve `premiados`; nunca en parejas). `eventos.disponibles()` quita PREMIO en parejas y VENGANZA sin vengadores vivos. Los bots los consideran en `decidirBot`. **Cualquier regla nueva sobre el Rey debe pasar por `reyProtegido(sala)`**.

**Poderes** (modo opcional `config.poderes`, desactivado por defecto; nunca en práctica ni rápida): catálogo y reglas de bots en `poderes.js`. Al perder una vida y seguir vivo, `darPoder()` da uno al azar (máximo 2), avisado con `poderGanado`. `usarPoder(sala, idx, poder)` en `server.js` es la única entrada (socket `usarPoder` para humanos, y los bots en `gestionarTurnos`): Espiar y Oráculo devuelven la carta solo a quien lo usó (`resultadoPoder`), el Escudo agrega el nombre a `sala.escudos` (se vacía cada ronda) y el Salto llama a `ejecutarAccion(..., { objetivoIndex })`. Los escudos rebotan cambios y saltos antes que el Rey. `jugadoresPublicos` nunca manda qué poderes tiene alguien, solo `numPoderes` y `escudo`. Tras Espiar u Oráculo, un bot decide con `mejorQue()`.

**Parejas** (`config.equipos` = 2 o 3; mesa de 4 o 6): `prepararEquipos()` (en la ronda 1, también en revancha) completa con bots y asigna `equipo = índice % 2` (0 Oro, 1 Plata, alternados: tu vecino derecho siempre es rival). Las vidas son del equipo: `resolverCartas` con `enEquipos` anota el daño por equipo (la carta mortal cuenta una vez, las penalizaciones extra se suman) y lo aplica a todos sus integrantes; devuelve también `culpables`. `enviarCarta()` manda `cartaCompanero` a los compañeros (los bots la guardan en su memoria). Termina cuando queda un equipo con vidas; `ganador` es `{ esEquipo, equipo, nombre, integrantes }` y la victoria cuenta para todos sus humanos. Sin duelo final en parejas. En el historial el modo es `PAREJAS`.

**Duelo final**: `sala.enDuelo` cuando quedan 2 vivos en una partida que empezó con 3 o más. La primera ronda de duelo trae `anunciarDuelo` (pantalla de versus). En `rondaTerminada` el cliente hace chocar las cartas (`animarChoqueDuelo`) y el servidor da 2 s extra antes de seguir o de la victoria.

**Presentaciones y tiempos**: `datosMesa` trae `introMs` (versus 2.8 s + carta de evento 4.4 s, si aplican; la carta se ve 4 s = `MS_CARTA_EVENTO` en main.js). El Rey declarado se revela a `introMs + MS_REVELAR_REY` y el primer turno arranca después; el cliente usa el mismo `introMs` para no adelantarse.

**Frases rápidas** (botón de globo junto a las reacciones): el cliente manda `frase { idSala, frase: <número> }`; el servidor valida `0 ≤ frase < TOTAL_FRASES` (límite 1 cada 2 s) y reenvía `fraseJugador`. Los textos viven solo en `FRASES_RAPIDAS` de `main.js`: **si agregas o quitas frases, actualiza `TOTAL_FRASES` en `server.js`**. Nunca texto libre. `mostrarFrase()` pone un globo de pergamino sobre el asiento (uno por jugador, 3 s). El botón solo se activa entre rondas (`mostrandoRevelacion`) o en modo espectador (`frasesDisponibles()`); durante los turnos quedan las reacciones con emoji.

**Partida rápida** ("Partida rápida" en el lobby, evento `partidaRapida`): el servidor sienta al jugador en la primera sala con `config.rapida` en LOBBY con lugar, o crea una (4 jugadores, clásico, sorpresa, 3 vidas, 10 s). `arrancarRapida()` la empieza sola a los `RAPIDA_ESPERA_MS` (45 s; el botón "Esperar 30 s más" → `rapidaMasTiempo` suma `RAPIDA_EXTRA_MS` hasta 2 min desde que se creó) o al llenarse, quita a quien se desconectó y completa con bots. Nadie es host: `iniciarPartida` la ignora. El cliente recibe `rapidaUnido { idSala, faltanMs }` y muestra la cuenta en `#rapidaEspera`; el código de la sala sigue visible para invitar a alguien a esa mesa. `empezarPartida(sala)` es el arranque común (Empezar juego, práctica y rápida). Prueba: `tests/rapida.js` (la corre `tests/run.sh`).

**Práctica de eventos y poderes** ("Aprende eventos y poderes"): segundo guion (`GUIONES.poderes` en `practica.js`, config `practica: 'poderes'` con `poderes: true`). Cada ronda del guion puede fijar `evento`, `poderes` que se regalan al empezar (en la práctica no se ganan al azar) y `esperaInicio` (ms extra antes del primer turno: la ronda 3 da 8 s para levantar el Escudo). Los textos están en `practicaPoderesEvento()`; `practicaEvento` recibe también `'poder'` (resultadoPoder) y `'accion'` (accionMesa). El Escudo se puede usar desde el reparto: `pintarBarraPoderes` considera la ronda en juego desde `datosMesa`, no desde el primer turno.

**Práctica del modo Fiesta** (tarjeta "Modo Fiesta" en Aprender; 24/09/2026): tercer guion `GUIONES.fiesta` (config `practica: 'fiesta'`, clásico sin votación, sorpresa). Ronda 1 Confesión fija (`confesion: 1` en el guion → `practica.confesionDeRonda`): A tiene al Rey, tu 0 pierde sí o sí y quedas de vengador; ronda 2 Venganza siendo dealer (tocas el asiento de B, que tiene un 7); ronda 3 Carrusel (te llega el 8 de B hagas lo que hagas). Textos en `practicaFiestaEvento()`; al terminar guarda `localStorage.reyPracticaFiestaHecha`. En la práctica los bots no se vengan por su cuenta.

**Práctica guiada** ("Aprender a jugar" en el lobby): `crearSala` con `{ practica: true }` → `sanitizarConfig` fija la mesa (3 vidas, 2 bots, declarado, 60 s por turno). `practica.js` tiene el guion: cartas por asiento, carta de arriba del mazo y jugada de cada bot por ronda; el dealer arranca en el asiento 2 para que juegues primero. El servidor no cuenta estadísticas, no avanza después de `ULTIMA_RONDA` y borra la sala al abandonarla. En `main.js` (sección PRÁCTICA GUIADA) `practicaEvento()` muestra el globo `#coachPractica` según ronda y turno; **los textos suponen las cartas del guion**, si cambias uno revisa el otro. Al terminar se guarda `localStorage.reyPracticaHecha` y el botón pasa de oro a madera.

**La mesa no se tapa con el panel de abajo**: el panel de acciones (`#panelAccionesPartida`) cambia de alto con guías, poderes y frases; un `ResizeObserver` (`vigilarAltoDelPie`) lo publica en `--alto-pie` y el tapete mide `100dvh - barra - --alto-pie`. Si la flecha guía estaba a la vista, se recoloca con `actualizarGuiaTurno(..., redibujar = true)`. Para que el panel no crezca de más, la línea de gestos solo sale en los primeros 3 turnos (`_turnosConGuiaGestos`) y la de "ves la carta de tu compañero" solo en la ronda 1.

**Más color y emoción** (25/09/2026, bloque MÁS COLOR Y EMOCIÓN de `style.css`): (1) la mesa toma el color del evento con `aplicarTemaMesa()` (clase `tema-<ID>` en `#tapeteVistas`; Niebla y Carrusel usan su `::after`), y sin evento tu tapete cosmético (`tapete-<id>`, tipo `tapete` en `cosmeticos.js`, solo lo ve quien lo elige). **La clase base es `tapete-virtual`: al quitar clases `tapete-*` nunca quitarla** (pasó y la mesa perdió todo su estilo). Se llama desde `pintarInfoMesa()` y `pintarMiLook()`. (2) Cartas a color: `valor-N` con `--tinta` por valor (0 y 9 conservan su gris y dorado); `pintarCartaPrincipal` la pone en tu carta y `colorearCartas()` en la mesa, la pila y el resumen leyendo el número pintado. (4) `dramaCartaMortal()` al aplicar el daño: la carta de quien pierde se agranda con brillo rojo (`.carta-mortal-drama`, usa la propiedad `scale` para no chocar con otros transform), la mesa tiembla (`.temblor`, propiedad `translate`) y suena el golpe. (5) Victoria: `pintarPodio()` con los 3 primeros de `clasificacion` (el servidor agrega `look` en `datosFin`) y `lanzarConfeti()`. (6) En tu turno `body.en-mesa.puedo-jugar::after` hace brillar la orilla de la pantalla y la carta da un saltito (en `actualizarBotonesTurno`). Todo se apaga con prefers-reduced-motion.

**Regla: todo debe funcionar en vertical y horizontal, en cualquier dispositivo** (pedido del 25/09/2026). Al tocar una pantalla, revisarla al menos en 390×844, 844×390 y escritorio/tableta. Barrido del 25/09/2026 en celular vertical/horizontal, celular chico acostado (640×360), tableta vertical/horizontal y computadora: inicio, lobby, Unirse, sala de espera, QR, perfil, reglas, mesa, resumen y victoria sin elementos inalcanzables. En computadora/tableta el panel de la mesa va fijo al fondo y centrado (antes quedaba debajo de la mesa, fuera de la pantalla, cuando la mesa se volvió fija sin scroll).

**Mesa horizontal** (25/09/2026, bloque MESA HORIZONTAL al final de `style.css`): con `(orientation: landscape) and (max-height: 600px)` la mesa va fija a la izquierda y `#panelAccionesPartida` es una columna a la derecha (`--ancho-columna`); las cartas se achican forzando las vars `--carta-*`, `--reverso-*`, `--mini-*` con `!important` (el JS las calcula por ancho y en horizontal manda el alto), tu nombre va al lado de tu carta, los asientos se compactan y el resumen de ronda va a lo ancho con scroll propio. Lo activa la orientación, no una clase: así se ve bien aunque giren el celular sin querer. La opción "Jugar en horizontal" del menú (`alternarHorizontal()`) pide pantalla completa y `screen.orientation.lock('landscape')` (Android); si falla (iPhone) pide girar el celular. Probado en 740×360, 844×390 y 915×412. El lobby (Crear: rápida y aprender | crear mesa) y la sala de espera (invitar y jugadores | cómo será y botones) también van a dos columnas en horizontal (bloque LOBBY Y SALA DE ESPERA EN HORIZONTAL, por `:nth-child` de `#panelConfiguracion` y `grid-row` en `#panelJugadores`: si agregas hijos a esos paneles, revisa ese bloque). La victoria en horizontal va a dos columnas (título y podio | tabla y botones lado a lado); en cualquier orientación, si no cabe se desplaza desde arriba (`.victoria-contenido { margin-block: auto }` en vez de centrar con overflow oculto, que cortaba el título).

**Mesa limpia** (`body.en-mesa`, lo pone un MutationObserver cuando `#mesaDeJuego` está a la vista): se oculta la barra superior y la bitácora del centro; la mesa sube hasta arriba. La ronda y el modo van bajo el reloj (`#infoMesa`, `pintarInfoMesa()` en cada `dibujarMesaCircular`). En las esquinas: `#btnBitacoraMesa` (con contador de jugadas nuevas) y `#btnMenuMesa` → `#panelMenuMesa` (guías, sonido, bitácora, reglas, perfil; reutiliza los botones ocultos de la barra). Las reacciones y frases se despliegan con `#btnReacciones` (😀, junto a MANTENER) y se pliegan al usarlas o a los 8 s. Los asientos de las esquinas superiores bajan a `top: 13%` para no quedar bajo esos botones.

**Sin encimados (auditoría del 24/09/2026, `tests/auditoria-visual.js`)**: el mazo está fijo al centro junto a la pila (`.centro-cartas` dentro de `.centro-mesa-wrapper`); junto al dealer chocaba con los asientos, y quién reparte se ve con la corona. Ya no hay banners flotando: el objetivo y el evento de la ronda van en `#infoMesa` y el marcador de equipos dentro del cuadro del reloj. Los avisos (`#toastContainer`) van en el hueco entre los asientos de arriba y el reloj (`top: 21%`, angostos, en varias líneas) y **no** se muestran las jugadas comunes (mantener, cambiar, robar, usar Espiar/Oráculo/Salto): esas se ven con su animación y quedan en la bitácora. Si agregas algo que flote sobre la mesa, corre la auditoría en 360×740 **y en 844×390** (`TAM=844x390`; escenarios `SOLO=6|33|F|3`). Desde el 25/09/2026 la auditoría revisa el choque real con el panel (en horizontal el panel es una columna a la derecha) y permite el botón del menú sobre él.

**Reacciones (25/09/2026)**: lista cerrada en dos lados, `REACCIONES` en main.js y `EMOJIS_REACCION` / `EMOJIS_LANZABLES` / `REACCIONES_ESPECIALES` en server.js (si agregas una, en ambos). 14 emojis, 5 lanzables (🍅 🌹 💋 🥚 🍺: `reaccion { idSala, emoji, objetivo: nombre }`, el servidor valida que el objetivo esté en la mesa y no seas tú, y reenvía `objetivoId`; `mostrarLanzamiento()` los hace volar en arco e `impactoLanzamiento()` hace la mancha o los corazones) y 3 especiales (🐉 Veterano, 💎 Rey de reyes, ⚡ Racha real) que el servidor valida con `logrosDe[username]` (se carga en `cargarLook` y se actualiza en `otorgarLogro`). El panel (`#barraReacciones.abierta`) flota sobre la barra sin achicar la mesa; al elegir algo lanzable, `body.apuntando` y se toca un asiento (tiene prioridad sobre la Venganza en el clic del tapete). `Sonidos.reaccion(emoji)` da un sonido a cada una. `sugerirReacciones()` ofrece 3 al momento (te bloquea el Rey, pierdes vida, te salvas, te lanzan algo; en este caso lo lanzable se le regresa a quien te lo lanzó) en `#sugerenciaReaccion`, 4 s.

**Reacciones y avisos**: las reacciones y el botón de frases son solo el emoji o el ícono, sin círculo ni borde; cada botón reparte el ancho de la fila para que se toque fácil. Los avisos (`#toastContainer`) van justo encima del panel (`--alto-pie`) y se muestra uno a la vez (lo mismo queda en la bitácora).

**Parejas en la mesa**: cada asiento dice "Compañero · Oro" o "Rival · Plata" (`.rol-equipo`), tu perfil "Tú · Oro", y al repartir la ronda 1 `mostrarAvisoEquipo()` muestra 5 s "Tu equipo: Oro · compañero: …". El marcador de vidas por equipo va al centro del tapete.

**Jugar con gestos, sin botones (25/09/2026, como el UNO)**: por defecto MANTENER/CAMBIAR grandes están ocultos (`body:not(.con-botones)`); en tu turno (`body.puedo-jugar`, lo pone `actualizarBotonesTurno` y lo quita `terminarMiJugada()` al jugar o al terminar la ronda) salen `#chipMantener` (izquierda de la carta, "2 toques · ↓") y `#chipCambiar` (derecha, "desliza ⟶"), que también se tocan y simulan el clic en los botones ocultos (siguen en el DOM: los gestos y las teclas M/C dependen de ellos). Menú → "Botones de jugada" (`localStorage.reyBotones=on`, `aplicarModoBotones()`) regresa los botones. **No quitar `puedo-jugar` en `quitarVenganza()`**: se llama al empezar tu turno si no eres vengador y borraba los indicadores al aparecer.

**Gestos sobre tu carta** (`inicializarGestosCarta`): deslizar a la derecha ≥ 70 px = CAMBIAR; doble toque (< 350 ms, sin arrastrar) o deslizar hacia abajo = MANTENER. `.carta-naipe` lleva `touch-action: manipulation` para que el doble toque no haga zoom. Con guías activas, `amagarCarta()` mueve la carta hacia la derecha como invitación y `#guiaAcciones` explica los gestos.

**Guías para quien empieza** (sección "GUÍAS PARA QUIEN EMPIEZA" en `main.js`): flecha SVG `#flechaGuia` de tu carta al vecino derecho (o al mazo si eres dealer o hay Mercado), texto `#guiaAcciones` bajo los botones, banner `#bannerObjetivo` al iniciar la ronda y `#resumenExplicacion` en el resumen. Se prenden solas las primeras `PARTIDAS_CON_GUIAS` (3) partidas (`localStorage.reyPartidasGuia`, se cuenta en `finDelJuego`); el botón 💡 fija `reyGuias = on|off`. `actualizarGuiaTurno()` se llama desde `actualizarBotonesTurno()`, así que cubre los tres caminos de turno. La guía del turno avisa también si tu vecino tiene escudo o al Rey a la vista, si es rival (parejas), el evento de la ronda y qué hace cada poder que tienes (con los nombres de la mesa); con guías, `turnoSaltadoVisual` explica por qué no juegas (Rey declarado o amnistía). Regla: **nunca** sugerir si conviene cambiar o mantener.

**`restaurarSesion()` va al FINAL de `main.js`**: `conectarSocket()` usa variables `let` declaradas más abajo; llamarla antes (estaba a media carga) lanzaba "Cannot access ... before initialization", cortaba el resto del archivo y quien volvía con sesión guardada veía la mesa congelada (arreglado el 23/09/2026).

**CSS importante**:
- `.hidden { display: none !important }` — nunca usar `display: flex !important` en clases que convivan con `hidden` porque el orden en el archivo determina cuál gana cuando tienen igual especificidad
- `#mazoFlotante.pos-*` — 8 clases de posicionamiento absoluto dentro del tapete que mueven el mazo junto al dealer
- `.reaccion-flotante` — `position: fixed` con `left/top` calculados desde `getBoundingClientRect()` y variables CSS `--dx`/`--dy` para flotar siempre hacia el centro del tapete
- Las animaciones de vuelo de carta (`volar-desde-centro-*`) duran 600ms — el flip y el reloj de turno arrancan en el callback de ese delay

### Trampas frecuentes

**Sincronización HTML ↔ JS**: `dibujarMesaCircular()` accede a elementos del DOM por ID. Si se elimina o renombra un elemento HTML que el JS referencia, la función fallará silenciosamente en el punto de acceso y **no dibujará a los oponentes** (el error detiene la ejecución antes de llegar al bucle de sillas). Verificar siempre que todo `getElementById(id)` tenga su contraparte en `index.html`, o añadir un guard: `const el = document.getElementById(id); if (el) el.innerText = ...`.

**Todo el HTML va ANTES de `<script src="main.js">`**: con sesión guardada, `restaurarSesion()` corre `conectarSocket()` al cargar `main.js`, y cualquier elemento que esté después del script todavía no existe. `#modalSalirPartida` estaba después: `getElementById('btnCancelarSalir').onclick` tronaba y cortaba el resto de `conectarSocket()` (Salir de la partida, Volver a la Corte, errores de sala…) solo para quien volvía con sesión guardada (arreglado el 25/09/2026).

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

**Íconos de la interfaz (sprite SVG propio)**
- La interfaz fija (barra superior, pestañas, etiquetas de configuración, botones, asientos, vidas, avatares, resumen) usa íconos de trazo del sprite al inicio de `<body>` en `index.html` (`<symbol id="i-<nombre>">`, viewBox 24, sin relleno). En HTML: `<svg class="icono"><use href="#i-corona"/></svg>`; en JS: `icono('corona')`, que devuelve ese mismo markup. Toman el color del texto (`currentColor`).
- **No** volver a poner emojis en la interfaz fija (cada celular los dibuja distinto). Quedan como emoji a propósito: las reacciones (son del jugador y el servidor las valida por emoji), y el texto corrido de mensajes, avisos y bitácora.
- Un elemento con ícono se actualiza con `innerHTML`, no `innerText` (borraría el SVG).
- La leyenda de cartas del modal de reglas usa las mismas figuras `/iconos/N.svg` de las cartas.

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

**Botones de acción y accesibilidad** (bloque final de `style.css`): MANTENER en madera con filo de oro y CAMBIAR en oro acuñado, dentro de la paleta del juego (no volver a azul/rojo genéricos). Suben con `acciones-entran` cada vez que se muestran (inicio de tu turno). Atajos de teclado `ATAJOS_MESA` en `main.js` (M, C) que simulan el clic; la letra se ve solo con `(hover: hover) and (pointer: fine)` vía `data-tecla`. Foco `:focus-visible` dorado y `prefers-reduced-motion` que apaga las animaciones en bucle.

**Jerarquía de botones fuera de la mesa**: `.boton-oro` para la acción principal de cada pantalla (Crear partida, Empezar, Revancha) y `.boton-madera` para volver/salir. No usar `boton-medieval-verde`/`-rojo` en pantallas nuevas.

**Bots de relleno automáticos** (24/09/2026): ya no se eligen al crear mesa. `sanitizarConfig` deja `numBots: 0` y `empezarPartida()` llama `completarConBots()` (la misma que usa la rápida): quita a quien se fue del lobby y llena con bots hasta `maxJugadores` ("Jugadores en la mesa"). Parejas sigue con `prepararEquipos`.

**Lobby a pantalla completa**: la pestaña Crear tiene tres `.lobby-bloque` (Jugar ahora → Partida rápida; Aprender → dos `.tarjeta-aprender`; Crear mesa → lo esencial a la vista y el resto dentro de `<details id="masOpciones">`, con resumen en `#resumenMasOpciones` que arma `actualizarResumenConfig()`). Las acciones principales de Crear y de la sala de espera van en `.lobby-acciones-fijas` (sticky al fondo, respeta el área segura). `#seccion-lobby` ocupa `100dvh` menos la barra superior. Todos los `id` de los selectores se conservan: si agregas una opción de sala, ponla en "Más opciones" salvo que sea esencial.

**Lobby**: `.lobby-blason` (emblema `mazo.svg` + nombre + lema) arriba de las pestañas; dentro de una sala se achica con `:has(#panelJugadores:not(.hidden))`.

**Victoria**: `pintarFinalPartida(ganador)` pone título distinto si ganaste, tu lugar y la tabla final (`#tablaFinal`). El servidor solo manda al ganador, así que el orden de caída lo anota `registrarCaidas()` en cada `rondaTerminada` (`_caidasPartida`, se vacía al pintar el final).

**Compresión y caché**: `compression()` (gzip) antes de todo lo estático. `/` y `/index.html` los sirve `servirIndex()`, que reescribe `style.css` y `main.js` con `?v=<huella del contenido>`; lo versionado se cachea un año (`immutable`), `index.html` y lo demás van con `no-cache` (revalidan con ETag → 304) y `/iconos/` un día. Primera visita ~83 KB en vez de ~343 KB. Si agregas otro CSS/JS a `index.html`, agrégalo también a `servirIndex()` o quedará sin versión.

**Contraste (revisado el 23/09/2026 con medición WCAG en todas las pantallas)**: texto normal ≥ 4.5:1, grande ≥ 3:1. Para texto secundario sobre madera oscura usar `var(--texto-suave)` (nunca blanco al 25–45 %); para texto dorado sobre pergamino, `var(--oro-tinta)`; para texto sobre el tapete verde, darle fondo propio (como `.mazo-conteo`). Los avisos (`.toast-*`) llevan fondo oscuro con letra clara, nunca letra del mismo tono que el fondo. Las correcciones están en el bloque "CONTRASTE" al final de `style.css`.

**Animaciones de la mesa** (sección "ANIMACIONES DE LA MESA" en `main.js` y bloque homónimo en `style.css`):
- *Revelación con suspenso*: en `rondaTerminada` se guarda `_inicioRevelacion`; `estiloRevelar(id)` da a cada `.mini-carta-frente` un `--retraso-revelar` según `ordenRevelacion()` (el orden en que jugó, dealer al final, `PASO_REVELAR_MS` = 450) calculado contra el reloj, así un re-render no la reinicia. El daño (tu carta, sonido, `animarPerdidaVida`) y el borde rojo de las perdedoras esperan `duracionRevelacion()`. El resumen sale a `max(1400, fin + 1100)`.
- *Cambios visibles*: `accionMesa` tipo `CAMBIO` → `animarCambioEntre(jugador, objetivo)` cruza dos reversos fantasma en arco (Web Animations API).
- *Bloqueo del Rey* (`accionMesa` `BLOQUEO`): `animarBloqueoRey()` — la carta rebota con `volarFantasma(..., { rebote })` y una corona destella sobre el Rey.
- *Robo del mazo* (`accionMesa` `MAZO`, dealer o Mercado): `animarRoboMazo()` — carta del mazo al jugador y la vieja a la pila.
- `volarFantasma(desde, hacia, { arco, duracion, rebote })` es el vuelo común de carta boca abajo; úsalo para cualquier animación nueva de cartas.
- *Pérdida de vida*: `animarPerdidaVida()` parte un corazón sobre las vidas y, si quedó eliminado, pone el sello de calavera.
- *Cuenta regresiva del resumen*: `rondaTerminada` trae `autoSiguienteMs` (cuánto falta para que la siguiente ronda empiece sola; `null` si termina la partida o la práctica). `iniciarCuentaResumen()` lo descuenta desde que llegó el evento (`datos._recibido`), no desde que aparece el resumen, así llega a cero junto con el servidor. Si cambias las pausas del servidor, la cuenta se ajusta sola.
- Todo se salta con `menosMovimiento()` (prefers-reduced-motion). El servidor da tiempo a verlo: `MS_PAUSA_BOT` (11 s, para alcanzar a ver quién tenía qué) antes de que un dealer bot avance y `MS_PAUSA_VICTORIA` (6.5 s) antes de `finDelJuego`; si se alarga la revelación, ajustar esas pausas.

**Idioma**: todo el texto visible en **español de México (tuteo)** — "tú"/"tienes"/"escanea", nunca voseo ("vos"/"tenés"/"escaneá"). Vocabulario: **"celular"** (no "móvil"), **"enlace"** (no "link"). Los identificadores de código preexistentes (`btnCopiarLink`, `linkDeSala`, clase `btn-copiar-link`) se mantienen.

### Convenciones de seguridad y robustez

Estas convenciones se aplicaron tras un hardening pass. Si trabajás en código que las toca, mantenelas:

- **Identidad por username, no por socket.id**: handlers que mutan estado de sala (`accionJugador`, `iniciarPartida`, `siguienteRonda`) validan `socket.usuario.username` contra `sala.jugadores[N].nombre`. El `socket.id` cambia en cada reconexión y abre ventanas de race.
- **Nunca emitir `sala.jugadores` tal cual**: usar `jugadoresPublicos(sala)`. Trae la carta oculta de todos y la memoria de los bots; el helper solo deja pasar `cartaActual` al revelar la ronda o si es un Rey declarado, y calcula `cartaRevelada` en cada envío. Hasta el 23/09/2026 las cartas de todos viajaban en cada turno y se podían ver en las herramientas del navegador.
- **Whitelist de acciones**: `accionJugador` rechaza cualquier `accion` fuera de `['MANTENER', 'CAMBIAR']` antes de tocar estado.
- **`sanitizarConfig()`**: toda config que viene del cliente en `crearSala` pasa por este helper en `server.js`. Hace clamp de rangos (vidas 1-10, maxJugadores 2-8, numBots 0..max-1) y valida enums. Agregar nuevos campos de config significa actualizar este helper también.
- **Passwords de sala**: se hashean con `bcrypt.hashSync` al crear y se comparan con `bcrypt.compareSync` al unirse. **Nunca** guardar `sala.password` en plaintext.
- **Shuffle**: usar siempre el helper `barajar()` (Fisher-Yates). **Nunca** `arr.sort(() => Math.random() - 0.5)` — no produce distribución uniforme. Esto aplica a TODOS los reshuffles, incluidos los de `ejecutarAccion` cuando el mazo se agota (robo del dealer y del Mercado) — todos pasan por `barajar([...sala.descarte])`.
- **Ids que siguen al jugador**: al reconectarse cambia su socket id; `unirseSala` actualiza también `hostId` si apuntaban al id viejo. Cualquier campo nuevo de la sala que guarde un socket id debe actualizarse ahí.
- **Guards de existencia de sala en timers**: `resolverRonda`, `iniciarRonda` e `iniciarRevancha` empiezan con `if (!estadoSalas[sala.idSala]) return;`. Cualquier nueva función que se invoque desde un `setTimeout` debería hacer lo mismo, o el callback puede ejecutarse sobre una sala ya borrada.
- **Sesión duplicada**: al hacer `unirseSala` con un username que ya tiene socket vivo, el servidor reasigna el id ANTES de desconectar al socket anterior (orden importante — invertido, el `disconnect` handler limpia al jugador legítimo) y emite `sesionReemplazada` con un delay de 150ms para que el paquete viaje antes del close. El cliente desactiva `socket.io.opts.reconnection` al recibirlo.
- **DOM listeners dentro de `conectarSocket()`**: usar asignación `.onclick = fn` (o `.oninput`, etc.), **nunca** `.addEventListener`. La asignación es idempotente — si `conectarSocket()` corre dos veces, no duplica handlers.
- **Cleanup de socket viejo**: `conectarSocket()` empieza removiendo todos los listeners y desconectando el socket previo si existe. No quitar esto: sin ello, los handlers del socket viejo siguen disparándose en eventos del nuevo.
- **Avanzar turno al sacar a un jugador en su turno**: cualquier handler que ponga `vidas = 0` a un jugador que está en turno (`abandonarSala`) debe cancelar `temporizadores[idSala]` y avanzar al siguiente vivo (o llamar `resolverRonda` si era el dealer). Sin esto la partida se cuelga: el timer dispara `ejecutarAccion('MANTENER')`, que corta temprano en `if (jugadorActual.vidas <= 0) return` sin avanzar, y la sala queda atascada hasta que el sweeper la borre (30 min).
- **Rate limit de endpoints de lectura**: `/leaderboard` y `/mis-stats` usan el limiter `limitarLectura` (200 req/15min por IP). Pegan a la DB sin auth y se consultan en cada carga de la pantalla de inicio, así que el límite es generoso pero acotado para frenar scraping. Todo endpoint HTTP nuevo que toque la DB debe llevar algún limiter (`limitarAuth`/`limitarLogin`/`limitarLectura` según el caso).
