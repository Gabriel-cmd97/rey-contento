// El guion de la práctica debe terminar como dicen los textos del globo
// (main.js, PRÁCTICA GUIADA) si el jugador sigue las instrucciones.
const test = require('node:test');
const assert = require('node:assert');
const { RONDAS } = require('../practica');
const { resolverCartas } = require('../reglas');

const mesa = (cartas) => ({
    jugadores: cartas.map((c, i) => ({ id: ['tu', 'A', 'B'][i], nombre: ['tu', 'A', 'B'][i], vidas: 3, cartaActual: c })),
    config: { modoJuego: 'CLASICO' }, campanaTocada: false, vueltasCampana: 0,
});

test('ronda 1: tú cambias con A, A cambia con B y B roba → pierde A con 4', () => {
    const [tu, a, b] = RONDAS[1].cartas;
    assert.strictEqual(tu, 1);                      // "Te tocó el 1, La Rata"
    assert.strictEqual(a, 7);                       // "Ahora tienes el 7 de A"
    const s = mesa([a, b, RONDAS[1].mazo]);          // tú 7 · A 4 · B robó
    const r = resolverCartas(s);
    assert.deepStrictEqual(r.perdedores, ['A']);
    assert.strictEqual(r.valorCritico, 4);
});

test('ronda 2: eres el dealer con un 2 y robas un 7 → te salvas', () => {
    const [tu, a, b] = RONDAS[2].cartas;
    assert.strictEqual(tu, 2);                      // "Tienes un 2"
    assert.strictEqual(RONDAS[2].mazo, 7);          // "Robaste un 7 del mazo"
    const r = resolverCartas(mesa([RONDAS[2].mazo, a, b]));
    assert.ok(!r.perdedores.includes('tu'));
});

test('ronda 3: A (tu derecha) tiene el Rey y nadie cambia → tú te salvas', () => {
    const [tu, a, b] = RONDAS[3].cartas;
    assert.strictEqual(a, 9);                       // "lo tiene A"
    const r = resolverCartas(mesa([tu, a, b]));
    assert.ok(!r.perdedores.includes('tu'));
});
