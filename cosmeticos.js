// cosmeticos.js — catálogo de cosméticos: se ven en la mesa, no cambian el juego.
// Es la única fuente: el servidor lo manda al cliente en /mis-stats y valida
// aquí lo que cada quien elige. Se desbloquean con logros (logros.js); los que
// no tienen `logro` son de todos desde el principio.
//
//   avatar  ícono del sprite de index.html (i-<icono>) en lugar de tu inicial
//   marco   aro alrededor de tu avatar (clase CSS .marco-<id>)
//   dorso   dibujo del reverso de tus cartas (clase CSS .dorso-<id>)
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
    // Marcos
    { id: 'ninguno',  tipo: 'marco',  titulo: 'Sin marco' },
    { id: 'bronce',   tipo: 'marco',  titulo: 'Bronce',    logro: 'primera_corona' },
    { id: 'plata',    tipo: 'marco',  titulo: 'Plata',     logro: 'veterano' },
    { id: 'oro',      tipo: 'marco',  titulo: 'Oro',       logro: 'rey_de_reyes' },
    { id: 'fuego',    tipo: 'marco',  titulo: 'Fuego',     logro: 'racha_real' },
    // Dorsos de carta
    { id: 'clasico',  tipo: 'dorso',  titulo: 'Clásico' },
    { id: 'carmesi',  tipo: 'dorso',  titulo: 'Carmesí',   logro: 'muro_del_rey' },
    { id: 'real',     tipo: 'dorso',  titulo: 'Azul real', logro: 'intocable' },
    { id: 'dorado',   tipo: 'dorso',  titulo: 'Dorado',    logro: 'rey_de_reyes' },
];

const TIPOS = ['avatar', 'marco', 'dorso'];
const POR_ID = Object.fromEntries(CATALOGO.map(c => [`${c.tipo}:${c.id}`, c]));
const PREDETERMINADOS = { avatar: 'inicial', marco: 'ninguno', dorso: 'clasico' };

// ¿Puede usarlo quien tiene estos logros (ids)?
function disponible(tipo, id, logrosIds) {
    const c = POR_ID[`${tipo}:${id}`];
    return !!c && (!c.logro || logrosIds.includes(c.logro));
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

module.exports = { CATALOGO, TIPOS, PREDETERMINADOS, disponible, leer };
