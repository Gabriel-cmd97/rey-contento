// Pruebas del catálogo de logros y de los lugares finales (sin servidor ni base).
const test = require('node:test');
const assert = require('node:assert');
const { CATALOGO, POR_ID, logrosDeFinDePartida, lugaresFinales } = require('../logros');

test('catálogo: ids únicos y cada logro con título, descripción e ícono', () => {
    assert.strictEqual(new Set(CATALOGO.map(l => l.id)).size, CATALOGO.length);
    CATALOGO.forEach(l => assert.ok(l.titulo && l.descripcion && l.icono, l.id));
    assert.ok(POR_ID.intocable);
});

test('ganar con 1 vida y sin perder ninguna no pueden coincidir salvo que empezaras con 1', () => {
    const ids = logrosDeFinDePartida({ gano: true, vidasFinales: 1, vidasPerdidas: 2, stats: { victorias: 1, partidas_jugadas: 1, racha_actual: 1 } });
    assert.deepStrictEqual(ids, ['primera_corona', 'por_un_pelo']);
});

test('ganar intacto con racha de 3 y 10 victorias', () => {
    const ids = logrosDeFinDePartida({ gano: true, vidasFinales: 3, vidasPerdidas: 0, stats: { victorias: 10, partidas_jugadas: 12, racha_actual: 3 } });
    assert.deepStrictEqual(ids, ['primera_corona', 'intocable', 'racha_real', 'rey_de_reyes']);
});

test('perder solo puede dar Veterano', () => {
    assert.deepStrictEqual(logrosDeFinDePartida({ gano: false, vidasFinales: 0, vidasPerdidas: 3, stats: { victorias: 0, partidas_jugadas: 24, racha_actual: 0 } }), []);
    assert.deepStrictEqual(logrosDeFinDePartida({ gano: false, vidasFinales: 0, vidasPerdidas: 3, stats: { victorias: 0, partidas_jugadas: 25, racha_actual: 0 } }), ['veterano']);
});

test('lugares: caen juntos pero uno aguantó más sin perder vida → no empatan', () => {
    const lugar = lugaresFinales('Rey', [{ nombre: 'C', ronda: 2, primera: 1 }, { nombre: 'A', ronda: 4, primera: 1 }, { nombre: 'B', ronda: 4, primera: 3 }], 4);
    assert.strictEqual(lugar('B'), 2);
    assert.strictEqual(lugar('A'), 3);
    assert.strictEqual(lugar('C'), 4);
});

test('lugares: el último en caer queda 2.º y los que caen juntos comparten lugar', () => {
    const lugar = lugaresFinales('Rey', [{ nombre: 'A', ronda: 1 }, { nombre: 'B', ronda: 3 }, { nombre: 'C', ronda: 3 }], 4);
    assert.strictEqual(lugar('Rey'), 1);
    assert.strictEqual(lugar('B'), 2);
    assert.strictEqual(lugar('C'), 2);
    assert.strictEqual(lugar('A'), 4);
    assert.strictEqual(lugar('Desconocido'), 4); // abandonó: último lugar
});
