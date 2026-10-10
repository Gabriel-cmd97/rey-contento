const fs = require('fs');
let content = fs.readFileSync('cosmeticos.js', 'utf8');

// Dorsos
content = content.replace(
    "{ id: 'carmesi',   tipo: 'dorso',  titulo: 'Carmesí',    rareza: 'raro', logro: 'muro_del_rey' },",
    "{ id: 'carmesi',   tipo: 'dorso',  titulo: 'Carmesí',    rareza: 'raro', logro: 'muro_del_rey', coleccion: 'casino' },"
);
content = content.replace(
    "{ id: 'real',      tipo: 'dorso',  titulo: 'Azul real',  rareza: 'raro', logro: 'intocable' },",
    "{ id: 'real',      tipo: 'dorso',  titulo: 'Azul real',  rareza: 'raro', logro: 'intocable', coleccion: 'noche' },"
);
content = content.replace(
    "{ id: 'noche',     tipo: 'dorso',  titulo: 'Noche estrellada', rareza: 'epico', nivel: 8 },",
    "{ id: 'noche',     tipo: 'dorso',  titulo: 'Noche estrellada', rareza: 'epico', nivel: 8, coleccion: 'realeza' },"
);
content = content.replace(
    "{ id: 'dorado',    tipo: 'dorso',  titulo: 'Dorado',     rareza: 'legendario', logro: 'rey_de_reyes' },",
    "{ id: 'dorado',    tipo: 'dorso',  titulo: 'Dorado',     rareza: 'legendario', logro: 'rey_de_reyes', coleccion: 'tesoro' },"
);

// We need a dorso 'madera'
content = content.replace(
    "// Tapetes (solo los ve quien los elige)",
    "{ id: 'madera',    tipo: 'dorso',  titulo: 'Roble',      rareza: 'epico', logro: 'veterano', coleccion: 'taberna' },\n    // Tapetes (solo los ve quien los elige)"
);

// Tapetes
content = content.replace(
    "{ id: 'azul',      tipo: 'tapete', titulo: 'Azul noche', rareza: 'raro', logro: 'aprendiz' },",
    "{ id: 'azul',      tipo: 'tapete', titulo: 'Azul noche', rareza: 'raro', logro: 'aprendiz', coleccion: 'noche' },"
);
content = content.replace(
    "{ id: 'rojo',      tipo: 'tapete', titulo: 'Casino',     rareza: 'raro', logro: 'por_un_pelo' },",
    "{ id: 'rojo',      tipo: 'tapete', titulo: 'Casino',     rareza: 'raro', logro: 'por_un_pelo', coleccion: 'casino' },"
);
content = content.replace(
    "{ id: 'morado',    tipo: 'tapete', titulo: 'Real',       rareza: 'epico', logro: 'racha_real' },",
    "{ id: 'morado',    tipo: 'tapete', titulo: 'Real',       rareza: 'epico', logro: 'racha_real', coleccion: 'realeza' },"
);
content = content.replace(
    "{ id: 'madera',    tipo: 'tapete', titulo: 'Taberna',    rareza: 'epico', logro: 'veterano' },",
    "{ id: 'madera',    tipo: 'tapete', titulo: 'Taberna',    rareza: 'epico', logro: 'veterano', coleccion: 'taberna' },"
);
content = content.replace(
    "{ id: 'oro',       tipo: 'tapete', titulo: 'Tesoro',     rareza: 'legendario', nivel: 7 },",
    "{ id: 'oro',       tipo: 'tapete', titulo: 'Tesoro',     rareza: 'legendario', nivel: 7, coleccion: 'tesoro' },"
);

fs.writeFileSync('cosmeticos.js', content);
