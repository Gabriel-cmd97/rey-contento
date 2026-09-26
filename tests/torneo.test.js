// Pruebas del Torneo de la noche (reglas puras).
const test = require('node:test');
const assert = require('node:assert');
const t = require('../torneo');

test('horario: inscripción 10 min antes de las 9 pm (CDMX) y arranque a las 9', () => {
    assert.strictEqual(t.minutosCDMX(new Date('2026-09-26T02:55:00Z')), 20 * 60 + 55); // 8:55 pm CDMX
    assert.strictEqual(t.momento(20 * 60 + 49), 'antes');
    assert.strictEqual(t.momento(20 * 60 + 50), 'inscripcion');
    assert.strictEqual(t.momento(21 * 60), 'hora');
    assert.strictEqual(t.momento(22 * 60 + 1), 'antes');
});

test('mesas: hasta 6, parejas en tamaño y sin perder a nadie', () => {
    const n = (k) => Array.from({ length: k }, (_, i) => 'j' + i);
    assert.deepStrictEqual(t.repartirMesas(n(5)).map(m => m.length), [5]);
    assert.deepStrictEqual(t.repartirMesas(n(7)).map(m => m.length).sort(), [3, 4]);
    assert.deepStrictEqual(t.repartirMesas(n(13)).map(m => m.length).sort(), [4, 4, 5]);
    assert.strictEqual(t.repartirMesas(n(13)).flat().length, 13);
});

test('siguiente fase: final entre ganadores humanos; uno solo es campeón directo', () => {
    assert.deepStrictEqual(t.siguienteFase([null, null]), { campeon: null });
    assert.deepStrictEqual(t.siguienteFase(['ana', null]), { campeon: 'ana' });
    assert.deepStrictEqual(t.siguienteFase(['ana', 'beto', null]), { final: ['ana', 'beto'] });
});
