// cosmeticos.js — catálogo de cosméticos: se ven en la mesa, no cambian el juego.
// Es la única fuente: el servidor lo manda al cliente en /mis-stats y valida
// aquí lo que cada quien elige. Se desbloquean con logros (logros.js) o al
// llegar a un `nivel` (progreso.js); los que no tienen ninguno son de todos.
//
//   avatar  ícono del sprite de index.html (i-<icono>) en lugar de tu inicial
//   marco   aro alrededor de tu avatar (clase CSS .marco-<id>)
//   dorso   dibujo del reverso de tus cartas (clase CSS .dorso-<id>)
//   tapete  color de TU mesa, solo lo ves tú (clase CSS .tapete-<id>)
//
// Para agregar uno: súmalo aquí y, si es marco o dorso, su clase en style.css.

// `rareza`: comun | raro | epico | legendario (solo cómo se ve; sirve de base
// para una tienda). `img`: avatar ilustrado en public/avatares/<img>.svg.
const CATALOGO = [
    // Avatares
    { id: 'inicial',   tipo: 'avatar', titulo: 'Tu inicial', rareza: 'comun' },
    { id: 'naipe',     tipo: 'avatar', titulo: 'Naipe',      rareza: 'comun', icono: 'naipe' },
    { id: 'espadas',   tipo: 'avatar', titulo: 'Espadas',    rareza: 'comun', icono: 'espadas' },
    { id: 'caballero', tipo: 'avatar', titulo: 'Caballero',  rareza: 'comun', img: 'caballero' },
    { id: 'bufon',     tipo: 'avatar', titulo: 'Bufón',      rareza: 'raro', img: 'bufon', logro: 'aprendiz' },
    { id: 'reina',     tipo: 'avatar', titulo: 'Reina',      rareza: 'raro', img: 'reina', logro: 'primera_corona' },
    { id: 'vikingo',   tipo: 'avatar', titulo: 'Vikingo',    rareza: 'raro', img: 'vikingo', nivel: 3 },
    { id: 'lobo',      tipo: 'avatar', titulo: 'Lobo',       rareza: 'epico', img: 'lobo', nivel: 5 },
    { id: 'fantasma',  tipo: 'avatar', titulo: 'Fantasma',   rareza: 'epico', img: 'fantasma', logro: 'intocable' },
    { id: 'mago',      tipo: 'avatar', titulo: 'Mago',       rareza: 'epico', img: 'mago', logro: 'racha_real' },
    { id: 'gato',      tipo: 'avatar', titulo: 'Gato real',  rareza: 'epico', img: 'gato', logro: 'veterano' },
    { id: 'dragon',    tipo: 'avatar', titulo: 'Dragón',     rareza: 'legendario', img: 'dragon', logro: 'rey_de_reyes' },
    // (íconos anteriores: se conservan para quien ya los eligió)
    { id: 'libro',     tipo: 'avatar', titulo: 'Erudito',    rareza: 'comun', icono: 'libro',   logro: 'aprendiz' },
    { id: 'corona',    tipo: 'avatar', titulo: 'Corona',     rareza: 'raro', icono: 'corona',  logro: 'primera_corona' },
    { id: 'corazon',   tipo: 'avatar', titulo: 'Corazón',    rareza: 'raro', icono: 'corazon', logro: 'por_un_pelo' },
    { id: 'escudo',    tipo: 'avatar', titulo: 'Escudo',     rareza: 'raro', icono: 'escudo',  logro: 'intocable' },
    { id: 'mano',      tipo: 'avatar', titulo: 'Mano real',  rareza: 'raro', icono: 'mano',    logro: 'muro_del_rey' },
    { id: 'rayo',      tipo: 'avatar', titulo: 'Rayo',       rareza: 'raro', icono: 'rayo',    logro: 'racha_real' },
    { id: 'trofeo',    tipo: 'avatar', titulo: 'Trofeo',     rareza: 'epico', icono: 'trofeo', logro: 'rey_de_reyes' },
    { id: 'llama',     tipo: 'avatar', titulo: 'Llama',      rareza: 'raro', icono: 'llama',   logro: 'veterano' },
    { id: 'diana',     tipo: 'avatar', titulo: 'Diana',      rareza: 'comun', icono: 'diana' },
    { id: 'mascara',   tipo: 'avatar', titulo: 'Máscara',    rareza: 'raro', icono: 'mascara' },
    // Marcos
    { id: 'ninguno',   tipo: 'marco',  titulo: 'Sin marco',  rareza: 'comun' },
    { id: 'bronce',    tipo: 'marco',  titulo: 'Bronce',     rareza: 'comun', logro: 'primera_corona' },
    { id: 'plata',     tipo: 'marco',  titulo: 'Plata',      rareza: 'raro', logro: 'veterano' },
    { id: 'esmeralda', tipo: 'marco',  titulo: 'Esmeralda',  rareza: 'raro', nivel: 5 },
    { id: 'oro',       tipo: 'marco',  titulo: 'Oro',        rareza: 'epico', logro: 'rey_de_reyes' },
    { id: 'fuego',     tipo: 'marco',  titulo: 'Fuego',      rareza: 'epico', logro: 'racha_real' },
    { id: 'hielo',     tipo: 'marco',  titulo: 'Hielo',      rareza: 'epico', nivel: 8 },
    { id: 'relampago', tipo: 'marco',  titulo: 'Relámpago',  rareza: 'epico', logro: 'muro_del_rey' },
    { id: 'arcoiris',  tipo: 'marco',  titulo: 'Arcoíris',   rareza: 'legendario', nivel: 10 },
    { id: 'gemas',     tipo: 'marco',  titulo: 'Corona de gemas', rareza: 'legendario', nivel: 15 },
    // Dorsos de carta
    { id: 'clasico',   tipo: 'dorso',  titulo: 'Clásico',    rareza: 'comun' },
    { id: 'carmesi',   tipo: 'dorso',  titulo: 'Carmesí',    rareza: 'raro', logro: 'muro_del_rey' },
    { id: 'real',      tipo: 'dorso',  titulo: 'Azul real',  rareza: 'raro', logro: 'intocable' },
    { id: 'esmeralda', tipo: 'dorso',  titulo: 'Esmeralda',  rareza: 'raro', nivel: 4 },
    { id: 'noche',     tipo: 'dorso',  titulo: 'Noche estrellada', rareza: 'epico', nivel: 8 },
    { id: 'dorado',    tipo: 'dorso',  titulo: 'Dorado',     rareza: 'legendario', logro: 'rey_de_reyes' },
    // Tapetes (solo los ve quien los elige)
    { id: 'verde',     tipo: 'tapete', titulo: 'Verde',      rareza: 'comun' },
    { id: 'azul',      tipo: 'tapete', titulo: 'Azul noche', rareza: 'raro', logro: 'aprendiz' },
    { id: 'rojo',      tipo: 'tapete', titulo: 'Casino',     rareza: 'raro', logro: 'por_un_pelo' },
    { id: 'morado',    tipo: 'tapete', titulo: 'Real',       rareza: 'epico', logro: 'racha_real' },
    { id: 'madera',    tipo: 'tapete', titulo: 'Taberna',    rareza: 'epico', logro: 'veterano' },
    { id: 'oro',       tipo: 'tapete', titulo: 'Tesoro',     rareza: 'legendario', nivel: 7 },
    // Tienda (30/09/2026): solo se consiguen con moneda (`precio`): número = Blis
    // (gratis); { letios } = Letios (se comprarán con dinero real; solo legendarios
    // y colecciones). Blis y Letios no se cambian entre sí. `coleccion`
    // agrupa artículos que se venden juntos con descuento (COLECCIONES).
    { id: 'sombra',       tipo: 'avatar', titulo: 'Caballero oscuro',  rareza: 'epico',      img: 'sombra',       precio: 350, coleccion: 'sombra', animado: true },
    { id: 'calavera',     tipo: 'avatar', titulo: 'Rey esqueleto',     rareza: 'epico',      img: 'calavera',     precio: 400, animado: true },
    { id: 'senor_hierro', tipo: 'avatar', titulo: 'Guardián de Hierro', rareza: 'epico',      img: 'senor_hierro', precio: 320, animado: false },
    { id: 'archimago',    tipo: 'avatar', titulo: 'Archimago Antiguo', rareza: 'epico',      img: 'archimago',    precio: 380, animado: true },
    { id: 'sacerdotisa',  tipo: 'avatar', titulo: 'Sacerdotisa Roja',  rareza: 'epico',      img: 'sacerdotisa',  precio: 360, animado: true },
    { id: 'caminante',    tipo: 'avatar', titulo: 'Rey de la Noche',   rareza: 'legendario', img: 'caminante',    precio: { letios: 26 }, coleccion: 'invernal', animado: true },
    { id: 'nigromante',   tipo: 'avatar', titulo: 'Soberano de Huesos', rareza: 'legendario', img: 'nigromante',   precio: { letios: 30 }, coleccion: 'ultratumba', animado: true },
    { id: 'hechicera',    tipo: 'avatar', titulo: 'Hechicera',         rareza: 'legendario', img: 'hechicera',    precio: { letios: 28 }, coleccion: 'hechicera', animado: true },
    { id: 'fenix',        tipo: 'avatar', titulo: 'Fénix',             rareza: 'legendario', img: 'fenix',        precio: { letios: 32 }, coleccion: 'fenix', animado: true },
    { id: 'obsidiana',     tipo: 'marco',  titulo: 'Obsidiana',         rareza: 'epico',      precio: 250, coleccion: 'sombra', animado: true },
    { id: 'trono_hierro',  tipo: 'marco',  titulo: 'Trono de Hierro',   rareza: 'epico',      precio: 300, animado: true },
    { id: 'huesos',        tipo: 'marco',  titulo: 'Corona de Huesos',  rareza: 'epico',      precio: 280, coleccion: 'ultratumba', animado: true },
    { id: 'llamas',        tipo: 'marco',  titulo: 'Anillo de llamas',  rareza: 'legendario', precio: { letios: 22 }, coleccion: 'fenix', animado: true },
    { id: 'fuego_valyrio', tipo: 'marco',  titulo: 'Fuego Valyrio',     rareza: 'legendario', precio: { letios: 22 }, animado: true },
    { id: 'celestial',     tipo: 'marco',  titulo: 'Celestial',         rareza: 'legendario', precio: { letios: 24 }, coleccion: 'hechicera', animado: true },
    { id: 'hielo_eterno',  tipo: 'marco',  titulo: 'Invierno Eterno',   rareza: 'legendario', precio: { letios: 20 }, coleccion: 'invernal', animado: true },
    { id: 'nigromancia',   tipo: 'marco',  titulo: 'Aura de Nazarick',  rareza: 'legendario', precio: { letios: 24 }, coleccion: 'ultratumba', animado: true },
    { id: 'tablero',   tipo: 'dorso',  titulo: 'Tablero',         rareza: 'raro',       precio: 120 },
    { id: 'runas',     tipo: 'dorso',  titulo: 'Runas',           rareza: 'epico',      precio: 300, coleccion: 'sombra', img: 'runas' },
    { id: 'realeza',   tipo: 'dorso',  titulo: 'Realeza',         rareza: 'epico',      precio: 350, coleccion: 'hechicera', img: 'realeza' },
    { id: 'lobo',      tipo: 'dorso',  titulo: 'Lobo Huargo',     rareza: 'epico',      precio: 350, coleccion: 'invernal', img: 'lobo' },
    { id: 'dragon',    tipo: 'dorso',  titulo: 'Fuego de Dragón', rareza: 'legendario', precio: { letios: 20 }, img: 'dragon' },
    { id: 'fenix',     tipo: 'dorso',  titulo: 'Fénix',           rareza: 'legendario', precio: { letios: 20 }, coleccion: 'fenix', img: 'fenix' },
    { id: 'marmol',    tipo: 'tapete', titulo: 'Mármol',          rareza: 'raro',       precio: 150 },
    { id: 'aurora',    tipo: 'tapete', titulo: 'Aurora',          rareza: 'epico',      precio: 450, coleccion: 'hechicera', animado: true },
    { id: 'lava',      tipo: 'tapete', titulo: 'Volcán',          rareza: 'epico',      precio: 400, coleccion: 'fenix', animado: true },
];

const TIPOS = ['avatar', 'marco', 'dorso', 'tapete'];

// Colecciones: todo lo que tenga `coleccion: id`, junto y con descuento.
const COLECCIONES = [
    { id: 'ultratumba', titulo: 'Colección de Ultratumba',  lema: 'Soberanía sobre la muerte', descuento: 0.25 },
    { id: 'invernal',   titulo: 'Colección del Invierno',   lema: 'El invierno ha llegado',    descuento: 0.25 },
    { id: 'fenix',      titulo: 'Colección del Fénix',      lema: 'Renace de tus cenizas',     descuento: 0.25 },
    { id: 'hechicera',  titulo: 'Colección Arcana',         lema: 'La magia está de tu lado',  descuento: 0.25 },
    { id: 'sombra',     titulo: 'Colección de la Sombra',   lema: 'Nadie te ve venir',         descuento: 0.2 },
];
function coleccion(id) {
    const c = COLECCIONES.find(x => x.id === id);
    if (!c) return null;
    const articulos = CATALOGO.filter(x => x.coleccion === id);
    // Colecciones se venden en Letios (moneda de pago). Lo que cuesta Blis se
    // cuenta a 25 Blis por Letio.
    const enLetios = (x) => typeof x.precio === 'object' ? (x.precio.letios ?? (x.precio.blis || 0) / 25) : x.precio / 25;
    const suma = Math.round(articulos.reduce((t, x) => t + enLetios(x), 0));
    return { ...c, articulos: articulos.map(x => `${x.tipo}:${x.id}`), suma: { letios: suma },
             precio: { letios: Math.max(1, Math.round(suma * (1 - c.descuento))) } };
}
const POR_ID = Object.fromEntries(CATALOGO.map(c => [`${c.tipo}:${c.id}`, c]));
const PREDETERMINADOS = { avatar: 'inicial', marco: 'ninguno', dorso: 'clasico', tapete: 'verde' };

// ¿Puede usarlo quien tiene estos logros (ids), este nivel y estas compras
// ('tipo:id')? Lo de la tienda solo si lo compró.
function disponible(tipo, id, logrosIds, nivel = 1, comprados = []) {
    const c = POR_ID[`${tipo}:${id}`];
    if (!c) return false;
    if (c.precio) return comprados.includes(`${tipo}:${id}`);
    return (!c.logro || logrosIds.includes(c.logro)) && (!c.nivel || nivel >= c.nivel);
}
function articuloDeTienda(tipo, id) {
    const c = POR_ID[`${tipo}:${id}`];
    return c && c.precio ? c : null;
}

// Cosméticos que se abren al pasar del nivel `antes` al `ahora`.
function desbloqueadosPorNivel(antes, ahora) {
    return CATALOGO.filter(c => c.nivel && c.nivel > antes && c.nivel <= ahora);
}

// Lo guardado en la base (JSON o null) → { avatar, marco, dorso } válido.
// Si algo ya no existe en el catálogo, vuelve al predeterminado.
function leer(texto) {
    let d = {};
    try { d = JSON.parse(texto || '{}') || {}; } catch { d = {}; }
    const r = {};
    TIPOS.forEach(t => { r[t] = POR_ID[`${t}:${d[t]}`] ? d[t] : PREDETERMINADOS[t]; });
    return r;
}

// Arcón de Gaudios: contenedor de recompensas y cosméticos
const ARCON_GAUDIO = {
    costoBlis: 100,
    costoGaudios: 1,
};

module.exports = { CATALOGO, TIPOS, PREDETERMINADOS, COLECCIONES, ARCON_GAUDIO, coleccion, disponible, articuloDeTienda, desbloqueadosPorNivel, leer };
