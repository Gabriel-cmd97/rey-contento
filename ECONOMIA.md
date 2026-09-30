# Economía de Rey Contento: Blis, Letios y Gaudios

Documento oficial de especificación, arquitectura y reglas de juego del sistema económico de tres divisas, apuestas y arcones de recompensas introducido el **30 de septiembre de 2026**.

---

## 1. Visión General de las Divisas

El reino de *Rey Contento* cuenta con tres divisas complementarias diseñadas para ofrecer progresión natural, prestigio competitivo y emoción de recompensas sorpresa:

| Divisa | Nombre | Rol / Propósito | Cómo se obtiene | Usos principales |
|---|---|---|---|---|
| <img src="public/iconos/blis.svg" width="24" height="24"> | **Blis** | Moneda común y gratuita (día a día) | Jugar partidas, victorias, bonificaciones, cofre diario y subida de nivel | Compras en tienda, entradas al Pozo del Rey y apuestas |
| <img src="public/iconos/letio.svg" width="24" height="24"> | **Letios** | Divisa de alto valor y prestigio | Campeón del Torneo de la noche, racha de 7 días y Arcón de Gaudios | Prendas y estilos legendarios, pases especiales |
| <img src="public/iconos/gaudio.svg" width="24" height="24"> | **Gaudios** | Ficha / contenedor de recompensas sorpresa | Racha de 7 días del cofre diario o eventos especiales | Abrir el Arcón de Gaudios en la Tienda |

---

## 2. Detalle de Cada Moneda

### 🪙 Blis (Moneda Común)
* **Iconografía**: Moneda de oro acuñada con el perfil sonriente y coronado del Rey Contento (`public/iconos/blis.svg`).
* **Representación en Base de Datos**: Columna `usuarios.monedas` (mantenida por retrocompatibilidad, aliada a nivel de código como `blis`).
* **Tabla de Ganancias**:
  * **Por jugar partida**: +10 Blis.
  * **Por victoria**: +30 Blis adicionales.
  * **Por bonificaciones en mesa**: +5 Blis por cada bonus (derrocar al Rey de la mesa, defender corona, aciertos en apuestas).
  * **Por subir de nivel**: +50 Blis por cada nivel alcanzado.
  * **Cofre diario**:
    * Día 1: +10 Blis
    * Día 2: +15 Blis
    * Día 3: +20 Blis
    * Día 4: +25 Blis
    * Día 5: +30 Blis
    * Día 6: +40 Blis
    * Día 7: +100 Blis

---

### 💎 Letios (Moneda de Prestigio)
* **Iconografía**: Gema zafiro celestial facetada, engastada sobre una corona real dorada (`public/iconos/letio.svg`).
* **Representación en Base de Datos**: Columna `usuarios.letios` (`INT DEFAULT 0`).
* **Cómo conseguirlos**:
  1. **Torneo de la Noche (Élite)**:
     * Se disputa diariamente a las **9:00 PM (hora de la Ciudad de México)**.
     * La inscripción abre 10 minutos antes desde el lobby.
     * El **Campeón absoluto** de la fase final recibe **10 Letios** de forma automática y el título de Rey de la noche durante 24 horas.
  2. **Racha Semanal de 7 Días**:
     * Al abrir el cofre supremo del día 7 consecutivo, se otorgan **5 Letios** garantizados.
  3. **Arcón de Gaudios**:
     * Tirada con un 25% de probabilidad de conseguir entre 1 y 3 Letios.
* **Para qué sirven**:
  * Adquirir los estilos y prendas más codiciados (aspectos legendarios, marcos animados, tapetes místicos).

---

### 🎁 Gaudios (Arcón de Recompensas)
* **Iconografía**: Arcón medieval de madera noble y herrajes de oro, entreabierto con un resplandor dorado ascendente (`public/iconos/gaudio.svg`).
* **Representación en Base de Datos**: Columna `usuarios.gaudios` (`INT DEFAULT 0`).
* **Cómo conseguirlos**:
  * Se otorga **1 Gaudio** como premio mayor al completar la racha de 7 días del cofre diario.
  * En futuros eventos festivos o recompensas de torneos.
* **Mecánica del Arcón de Gaudios**:
  * Disponible en la tienda bajo la pestaña dedicada **✨ Arcón**.
  * **Costo de apertura**:
    * Opción A: **1 Gaudio**.
    * Opción B: **100 Blis** (para que cualquier jugador que ahorre Blis pueda probar su suerte).
  * **Tabla de Probabilidades de Recompensa**:
    * **55% — Prenda o estilo sorpresa**: Desbloquea inmediatamente un avatar, marco, dorso o tapete de la tienda que el jugador aún no posea (con inserción directa en la tabla `compras`).
    * **25% — Letios de Prestigio**: Pouch de gemas con **1, 2 o 3 Letios**.
    * **20% — Bolsa del Tesoro de Blis**: De **120 a 250 Blis**.
  * **Presentación**: Animación especial con pulsos de luz, sacudida del arcón, apertura con fanfarria sonora y lluvia de confeti real.

---

## 3. Sistema de Apuestas con Blis

### A. El Pozo del Rey (Buy-in de la Sala)
1. **Configuración**:
   * Al crear una mesa (en el menú desplegable *Más opciones*), el anfitrión puede definir la entrada del Pozo:
     * `0` (Gratis / sin pozo)
     * `10 Blis`
     * `25 Blis`
     * `50 Blis`
     * `100 Blis`
2. **Cobro y Acumulación**:
   * Al dar clic en *Empezar juego* o al iniciar una revancha, el servidor debita de forma atómica la cuota a cada jugador humano conectado que disponga de saldo.
   * La suma se acumula en `sala.pozoTotal` y se envía a los clientes en el evento `datosMesa.pozo`.
   * En la mesa de juego se despliega el chip informativo: `🪙 Pozo: X Blis`.
3. **Reparto del Premio al Finalizar**:
   * **Victoria Humana**: El ganador humano (o los integrantes del equipo en modalidad parejas) se reparte la totalidad del Pozo del Rey acumulado.
   * **Victoria de Bot o Empate**: Si un bot gana la partida o no hay ganador humano vivo, **el Pozo del Rey se lo queda la casa** (las arcas reales de la Corona). ¡Esto añade máxima emoción a la mesa para impedir que los bots se queden con el botín!

---

### B. Apuestas de Espectadores y Eliminados
Cuando un jugador pierde todas sus vidas (`vidas = 0`), la interfaz despliega el panel interactivo de apuestas con dos modalidades:

```
[ ⚡ Ronda (x2) ]   [ 👑 Campeón (x3) ]
```

1. **⚡ Apuesta por Ronda ("¿Quién pierde esta ronda?")**:
   * Se abre al comenzar cada ronda y se bloquea en la primera jugada.
   * **Fichas**: Gratis, 5, 10 o 25 Blis.
   * **Premio**: Si el objetivo pierde una o más vidas en esa ronda:
     * Recupera su apuesta y gana el **doble de Blis (x2)**.
     * Bonificación de **+15 XP**.
   * Si el jugador cambia de opinión antes del bloqueo de la ronda, el servidor le reembolsa la apuesta previa antes de aplicar la nueva.

2. **👑 Apuesta al Campeón ("¿Quién ganará la partida?")**:
   * Permite predecir cuál de los supervivientes en pie se coronará como el Campeón del juego.
   * **Fichas**: Gratis, 5, 10 o 25 Blis.
   * **Premio**:
     * Si su candidato gana la partida: **pago triple de Blis (x3)** y bonificación de **+50 XP**.
   * Notificación global en el chat y registro en pantalla de victoria.

---

## 4. Endpoints y Arquitectura Técnica

### Endpoints HTTP
* `POST /tienda/abrir-gaudio`:
  * Encabezado: `Authorization: Bearer <JWT>`.
  * Cuerpo: `{ metodo: 'gaudio' | 'blis' }` (opcional; por defecto prioriza Gaudio si el saldo es >= 1).
  * Respuesta: `{ ok: true, premio: { tipo, articulo, titulo, subtitulo, rareza }, saldo, blis, letios, gaudios }`.
* `POST /tienda/comprar`:
  * Permite compras atómicas con Blis o con Letios.
* `POST /premio-diario`:
  * Al reclamar el día 7 de racha, asigna automáticamente `+5 Letios` y `+1 Gaudio`.
* `GET /mis-stats/:username`:
  * Devuelve `{ blis, letios, gaudios, victorias, ... }`.

### Eventos de Socket.io
* `apostar`: Payload `{ idSala, objetivo, monto }` para la ronda en curso.
* `apuestaHecha`: Emite al cliente la confirmación de la apuesta y saldo actualizado.
* `resultadoApuesta`: Notifica acierto/fallo al resolver la ronda.
* `apostarCampeon`: Payload `{ idSala, objetivo, monto }` para predecir al ganador final.
* `apuestaCampeonHecha`: Confirma la predicción del campeón de la partida.
* `resultadoApuestaCampeon`: Notifica el desenlace y ganancia x3 al terminar la partida.

---

## 5. Archivos Involucrados

* [`progreso.js`](file:///var/www/html/rey/progreso.js): Constantes y cálculos de economía (`BLIS`, `LETIOS`, `GAUDIOS`).
* [`cosmeticos.js`](file:///var/www/html/rey/cosmeticos.js): Catálogo de artículos, precios en Blis y Letios, y constantes del `ARCON_GAUDIO`.
* [`server.js`](file:///var/www/html/rey/server.js): Lógica de base de datos, cobro y distribución del Pozo del Rey, endpoints de apertura y handlers de apuestas por sockets.
* [`public/index.html`](file:///var/www/html/rey/public/index.html): Símbolos SVG (`#i-blis`, `#i-letio`, `#i-gaudio`), saldo dual/triple en barra superior y modales de tienda y arcón.
* [`public/main.js`](file:///var/www/html/rey/public/main.js): Renderizado de divisas, pestañas de tienda, apertura animada del arcón y paneles de apuestas de espectadores.
* [`public/style.css`](file:///var/www/html/rey/public/style.css): Clases de animación, temas visuales y estilos del Arcón de Gaudios y fichas de apuestas.
