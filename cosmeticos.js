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
];

const TIPOS = ['avatar', 'marco', 'dorso', 'tapete'];
const POR_ID = Object.fromEntries(CATALOGO.map(c => [`${c.tipo}:${c.id}`, c]));
const PREDETERMINADOS = { avatar: 'inicial', marco: 'ninguno', dorso: 'clasico', tapete: 'verde' };

// ¿Puede usarlo quien tiene estos logros (ids) y este nivel?
function disponible(tipo, id, logrosIds, nivel = 1) {
    const c = POR_ID[`${tipo}:${id}`];
    return !!c && (!c.logro || logrosIds.includes(c.logro)) && (!c.nivel || nivel >= c.nivel);
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

module.exports = { CATALOGO, TIPOS, PREDETERMINADOS, disponible, desbloqueadosPorNivel, leer };
