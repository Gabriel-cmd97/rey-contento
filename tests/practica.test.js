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

const { GUIONES } = require('../practica');
const conEvento = (cartas, evento) => ({ ...mesa(cartas), evento });

test('práctica de poderes, ronda 1: con Mundo al revés cambias tu 8 con A y A pierde', () => {
    const r1 = GUIONES.poderes[1];
    assert.strictEqual(r1.evento, 'MUNDO_AL_REVES');
    const [tu, a, b] = r1.cartas;
    const res = resolverCartas(conEvento([a, tu, b], 'MUNDO_AL_REVES')); // tú y A intercambian
    assert.deepStrictEqual(res.perdedores, ['A']);
});

test('práctica de poderes, ronda 2: el Oráculo muestra un 8 y robándolo te salvas', () => {
    const r2 = GUIONES.poderes[2];
    assert.deepStrictEqual(r2.poderes[0], ['ORACULO']);
    const [, a, b] = r2.cartas;
    const res = resolverCartas(mesa([r2.mazo, a, b]));
    assert.ok(!res.perdedores.includes('tu'));
});

test('práctica de poderes, ronda 3: con el escudo el cambio de B rebota y B pierde', () => {
    const r3 = GUIONES.poderes[3];
    assert.strictEqual(r3.bots[2], 'CAMBIAR');
    assert.deepStrictEqual(r3.poderes[0], ['ESCUDO']);
    const res = resolverCartas(mesa(r3.cartas)); // nadie cambió gracias al escudo
    assert.deepStrictEqual(res.perdedores, ['B']);
});
