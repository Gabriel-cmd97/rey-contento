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

const CATALOGO = [
    // Avatares
    { id: 'inicial',  tipo: 'avatar', titulo: 'Tu inicial' },
    { id: 'naipe',    tipo: 'avatar', titulo: 'Naipe',     icono: 'naipe' },
    { id: 'espadas',  tipo: 'avatar', titulo: 'Espadas',   icono: 'espadas' },
    { id: 'libro',    tipo: 'avatar', titulo: 'Erudito',   icono: 'libro',   logro: 'aprendiz' },
    { id: 'corona',   tipo: 'avatar', titulo: 'Corona',    icono: 'corona',  logro: 'primera_corona' },
    { id: 'corazon',  tipo: 'avatar', titulo: 'Corazón',   icono: 'corazon', logro: 'por_un_pelo' },
    { id: 'escudo',   tipo: 'avatar', titulo: 'Escudo',    icono: 'escudo',  logro: 'intocable' },
    { id: 'mano',     tipo: 'avatar', titulo: 'Mano real', icono: 'mano',    logro: 'muro_del_rey' },
    { id: 'rayo',     tipo: 'avatar', titulo: 'Rayo',      icono: 'rayo',    logro: 'racha_real' },
    { id: 'trofeo',   tipo: 'avatar', titulo: 'Trofeo',    icono: 'trofeo',  logro: 'rey_de_reyes' },
    { id: 'llama',    tipo: 'avatar', titulo: 'Llama',     icono: 'llama',   logro: 'veterano' },
    { id: 'diana',    tipo: 'avatar', titulo: 'Diana',     icono: 'diana',   nivel: 3 },
    { id: 'mascara',  tipo: 'avatar', titulo: 'Máscara',   icono: 'mascara', nivel: 6 },
    // Marcos
    { id: 'ninguno',  tipo: 'marco',  titulo: 'Sin marco' },
    { id: 'bronce',   tipo: 'marco',  titulo: 'Bronce',    logro: 'primera_corona' },
    { id: 'plata',    tipo: 'marco',  titulo: 'Plata',     logro: 'veterano' },
    { id: 'oro',      tipo: 'marco',  titulo: 'Oro',       logro: 'rey_de_reyes' },
    { id: 'fuego',    tipo: 'marco',  titulo: 'Fuego',     logro: 'racha_real' },
    { id: 'esmeralda', tipo: 'marco', titulo: 'Esmeralda', nivel: 5 },
    { id: 'arcoiris', tipo: 'marco',  titulo: 'Arcoíris',  nivel: 10 },
    // Dorsos de carta
    { id: 'clasico',  tipo: 'dorso',  titulo: 'Clásico' },
    { id: 'carmesi',  tipo: 'dorso',  titulo: 'Carmesí',   logro: 'muro_del_rey' },
    { id: 'real',     tipo: 'dorso',  titulo: 'Azul real', logro: 'intocable' },
    { id: 'dorado',   tipo: 'dorso',  titulo: 'Dorado',    logro: 'rey_de_reyes' },
    { id: 'esmeralda', tipo: 'dorso', titulo: 'Esmeralda', nivel: 4 },
    { id: 'noche',    tipo: 'dorso',  titulo: 'Noche estrellada', nivel: 8 },
    // Tapetes (solo los ve quien los elige)
    { id: 'verde',    tipo: 'tapete', titulo: 'Verde' },
    { id: 'azul',     tipo: 'tapete', titulo: 'Azul noche', logro: 'aprendiz' },
    { id: 'rojo',     tipo: 'tapete', titulo: 'Casino',     logro: 'por_un_pelo' },
    { id: 'morado',   tipo: 'tapete', titulo: 'Real',       logro: 'racha_real' },
    { id: 'madera',   tipo: 'tapete', titulo: 'Taberna',    logro: 'veterano' },
    { id: 'oro',      tipo: 'tapete', titulo: 'Tesoro',     nivel: 7 },
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
