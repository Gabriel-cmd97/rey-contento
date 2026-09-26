// Pruebas de niveles y recompensa diaria (sin servidor ni base).
const test = require('node:test');
const assert = require('node:assert');
const p = require('../progreso');

test('XP por partida: jugar, rondas (con tope) y ganar', () => {
    assert.strictEqual(p.xpDePartida({ gano: false, rondasAguantadas: 0 }), 20);
    assert.strictEqual(p.xpDePartida({ gano: false, rondasAguantadas: 4 }), 32);
    assert.strictEqual(p.xpDePartida({ gano: true, rondasAguantadas: 50 }), 90);
});

test('niveles: 100, 300, 600, 1000… y el avance dentro del nivel', () => {
    assert.deepStrictEqual(p.nivelDe(0), { nivel: 1, xpEnNivel: 0, xpDelNivel: 100 });
    assert.strictEqual(p.nivelDe(99).nivel, 1);
    assert.strictEqual(p.nivelDe(100).nivel, 2);
    assert.deepStrictEqual(p.nivelDe(450), { nivel: 3, xpEnNivel: 150, xpDelNivel: 300 });
    assert.strictEqual(p.nivelDe(1000).nivel, 5);
});

test('día en CDMX: a las 3 am UTC todavía es el día anterior', () => {
    assert.strictEqual(p.hoyCDMX(new Date('2026-09-26T03:00:00Z')), '2026-09-25');
    assert.strictEqual(p.hoyCDMX(new Date('2026-09-26T07:00:00Z')), '2026-09-26');
    assert.strictEqual(p.diaAnterior('2026-10-01'), '2026-09-30');
});

test('premio diario: primera vez, racha que sigue, ya cobrado, falta un día y vuelta al día 1 tras el 7', () => {
    const hoy = '2026-09-25';
    assert.deepStrictEqual(p.estadoPremio(null, 0, hoy), { disponible: true, racha: 1, premio: 20 });
    assert.deepStrictEqual(p.estadoPremio('2026-09-24', 2, hoy), { disponible: true, racha: 3, premio: 40 });
    assert.strictEqual(p.estadoPremio(hoy, 3, hoy).disponible, false);
    assert.strictEqual(p.estadoPremio('2026-09-22', 5, hoy).racha, 1);
    assert.deepStrictEqual(p.estadoPremio('2026-09-24', 6, hoy), { disponible: true, racha: 7, premio: 150 });
    assert.strictEqual(p.estadoPremio('2026-09-24', 7, hoy).racha, 1);
});
