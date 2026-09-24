// Pruebas del modo con poderes (sin servidor ni base).
const test = require('node:test');
const assert = require('node:assert');
const { CATALOGO, IDS, MAX_PODERES, darPoder, quitarPoder, mejorQue, poderParaBot } = require('../poderes');

test('catálogo completo', () => {
    IDS.forEach(id => assert.ok(CATALOGO[id].titulo && CATALOGO[id].descripcion && CATALOGO[id].icono, id));
});

test('se da un poder al perder vida, con máximo y nunca a eliminados', () => {
    const j = { vidas: 2 };
    assert.ok(IDS.includes(darPoder(j, () => 0)));
    for (let i = 0; i < 5; i++) darPoder(j);
    assert.strictEqual(j.poderes.length, MAX_PODERES);
    assert.strictEqual(darPoder({ vidas: 0 }), null);
});

test('quitar un poder que no se tiene no hace nada', () => {
    const j = { vidas: 1, poderes: ['ESPIAR'] };
    assert.strictEqual(quitarPoder(j, 'SALTO'), false);
    assert.strictEqual(quitarPoder(j, 'ESPIAR'), true);
    assert.deepStrictEqual(j.poderes, []);
});

test('mejorQue respeta si pierde la más baja o la más alta', () => {
    assert.ok(mejorQue(7, 3, false));
    assert.ok(mejorQue(2, 6, true));
});

test('bots: escudo con buena carta, espiar con mala, oráculo si roban del mazo', () => {
    const ctx = { esDealer: false, puedeSaltar: true, pierdeLaMasAlta: false };
    assert.strictEqual(poderParaBot({ cartaActual: 8, poderes: ['ESCUDO', 'ESPIAR'] }, ctx), 'ESCUDO');
    assert.strictEqual(poderParaBot({ cartaActual: 2, poderes: ['ESCUDO', 'ESPIAR'] }, ctx), 'ESPIAR');
    assert.strictEqual(poderParaBot({ cartaActual: 2, poderes: ['ORACULO'] }, { ...ctx, esDealer: true }), 'ORACULO');
    assert.strictEqual(poderParaBot({ cartaActual: 2, poderes: [] }, ctx), null);
});
