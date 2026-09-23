// Pruebas de la lógica de bots (sin servidor ni base):  node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const bots = require('../bots');

const fijo = (v) => () => v; // "azar" controlado
const jug = (id, carta, extra = {}) => ({ id, nombre: id, vidas: 3, cartaActual: carta, esBot: true, ...extra });
const sala = (jugadores, config = {}, extra = {}) => ({
    jugadores, descarte: [], campanaTocada: false,
    config: { modoJuego: 'CLASICO', modoRey: 'SORPRESA', dificultadBots: 'DIFICIL', ...config }, ...extra,
});

test('probPerder: con 0 casi seguro pierdes en clásico, con 9 nunca', () => {
    const dist = bots.COMPOSICION.map(n => n / 76);
    assert.ok(bots.probPerder(0, dist, 3, false) > 0.8);
    assert.strictEqual(bots.probPerder(9, dist, 3, false), 0);
    // En campana es al revés
    assert.strictEqual(bots.probPerder(0, dist, 3, true), 0);
});

test('clásico: con carta baja cambia, con carta alta mantiene', () => {
    const [a, b] = [jug('a', 1), jug('b', 5)];
    assert.strictEqual(bots.decidirBot(sala([a, b, jug('c', 4)]), a, { esDealer: false, derecha: b }, fijo(0.9)), 'CAMBIAR');
    const [x, y] = [jug('x', 8), jug('y', 5)];
    assert.strictEqual(bots.decidirBot(sala([x, y, jug('z', 4)]), x, { esDealer: false, derecha: y }, fijo(0.9)), 'MANTENER');
});

test('no intenta cambiar contra un Rey declarado', () => {
    const a = jug('a', 0), rey = jug('r', 9, { cartaRevelada: true, esBot: false });
    const d = bots.decidirBot(sala([a, rey, jug('c', 4)], { modoRey: 'DECLARADO' }), a, { esDealer: false, derecha: rey }, fijo(0.9));
    assert.strictEqual(d, 'MANTENER');
});

test('difícil recuerda qué carta le dio al vecino y decide con ella', () => {
    const a = jug('a', 2), b = jug('b', 6), c = jug('c', 5);
    // a le dio antes un 0 a b: cambiar ahora le devolvería ese 0
    bots.recordarCambio([a, b, c], a, b, 0, 2);
    const s = sala([a, b, c], { modoJuego: 'CAMPANA' });
    // Campana (pierde la más alta): con un 7, recuperar ese 0 le conviene.
    a.cartaActual = 7;
    assert.strictEqual(bots.decidirBot(s, a, { esDealer: false, derecha: b }, fijo(0.9)), 'CAMBIAR');
    // Clásico (pierde la más baja): con un 2, recibir el 0 sería peor.
    a.cartaActual = 2; s.config.modoJuego = 'CLASICO';
    assert.strictEqual(bots.decidirBot(s, a, { esDealer: false, derecha: b }, fijo(0.9)), 'MANTENER');
});

test('la memoria sigue a la carta cuando otros cambian entre sí', () => {
    const a = jug('a', 1), b = jug('b', 2), c = jug('c', 3);
    bots.recordarCambio([a, b, c], a, b, 7, 2); // a sabe que b tiene 7
    bots.recordarCambio([a, b, c], b, c, 7, 3); // b pasa el 7 a c
    assert.strictEqual(a.memoria.c, 7);
    assert.strictEqual(a.memoria.b, undefined);
    bots.olvidarCarta([a, b, c], c);
    assert.strictEqual(a.memoria.c, undefined);
});

test('campana: toca la campana con carta muy baja', () => {
    const a = jug('a', 0), b = jug('b', 5);
    const d = bots.decidirBot(sala([a, b, jug('c', 4)], { modoJuego: 'CAMPANA' }), a, { esDealer: false, derecha: b }, fijo(0.9));
    assert.strictEqual(d, 'CAMPANA');
});

test('dificultad desconocida cae en NORMAL y el retraso es humano', () => {
    const a = jug('a', 8), b = jug('b', 5);
    const d = bots.decidirBot(sala([a, b], { dificultadBots: 'XYZ' }), a, { esDealer: false, derecha: b }, fijo(0.9));
    assert.strictEqual(d, 'MANTENER');
    assert.ok(bots.retrasoBot(fijo(0)) >= 1200 && bots.retrasoBot(fijo(0.999)) <= 2500);
});
