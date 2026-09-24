// Pruebas de la elección de eventos de ronda (sin servidor ni base).
const test = require('node:test');
const assert = require('node:assert');
const { elegirEvento, IDS, CATALOGO, MAX_RONDAS_SIN_EVENTO } = require('../eventos');
const bots = require('../bots');

const sala = (extra = {}, config = {}) => ({ rondaActual: 3, config: { modoJuego: 'CLASICO', ...config }, ...extra });

test('catálogo: cada evento tiene título, descripción e ícono', () => {
    IDS.forEach(id => assert.ok(CATALOGO[id].titulo && CATALOGO[id].descripcion && CATALOGO[id].icono, id));
});

test('nunca hay evento en campana, práctica, ronda 1, eventos apagados o duelo', () => {
    const siempre = () => 0; // el azar siempre diría que sí
    assert.strictEqual(elegirEvento(sala({}, { modoJuego: 'CAMPANA' }), 4, siempre), null);
    assert.strictEqual(elegirEvento(sala({}, { practica: true }), 4, siempre), null);
    assert.strictEqual(elegirEvento(sala({ rondaActual: 1 }), 4, siempre), null);
    assert.strictEqual(elegirEvento(sala({}, { eventos: false }), 4, siempre), null);
    assert.strictEqual(elegirEvento(sala(), 2, siempre), null);
});

test('después de 3 rondas sin evento, el siguiente es seguro', () => {
    const s = sala();
    const nunca = () => 0.99;
    for (let i = 0; i < MAX_RONDAS_SIN_EVENTO; i++) assert.strictEqual(elegirEvento(s, 4, nunca), null);
    assert.ok(IDS.includes(elegirEvento(s, 4, nunca)));
});

test('el mismo evento no sale dos veces seguidas', () => {
    const s = sala();
    let anterior = null;
    for (let i = 0; i < 200; i++) {
        const e = elegirEvento(s, 4, Math.random);
        if (e) { assert.notStrictEqual(e, anterior); anterior = e; }
    }
});

test('bots: en Mercado roban del mazo aunque su vecino tenga el Rey a la vista', () => {
    const bot = { id: 'b', cartaActual: 1, vidas: 3, esBot: true };
    const rey = { id: 'r', cartaActual: 9, vidas: 3, cartaRevelada: true };
    const otro = { id: 'o', cartaActual: 4, vidas: 3 };
    const s = { jugadores: [bot, rey, otro], descarte: [], campanaTocada: false,
                config: { modoJuego: 'CLASICO', dificultadBots: 'DIFICIL', modoRey: 'DECLARADO' } };
    const ctx = { esDealer: false, derecha: rey };
    assert.strictEqual(bots.decidirBot(s, bot, ctx, () => 0.9), 'MANTENER'); // sin evento: el Rey bloquea
    s.evento = 'MERCADO';
    assert.strictEqual(bots.decidirBot(s, bot, ctx, () => 0.9), 'CAMBIAR');  // en Mercado roba del mazo
});

test('bots: en Mundo al revés no toman el 9 del vecino', () => {
    const bot = { id: 'b', cartaActual: 8, vidas: 3, esBot: true };
    const rey = { id: 'r', cartaActual: 9, vidas: 3, cartaRevelada: true };
    const s = { jugadores: [bot, rey, { id: 'o', cartaActual: 4, vidas: 3 }], descarte: [], campanaTocada: false,
                config: { modoJuego: 'CLASICO', dificultadBots: 'DIFICIL', modoRey: 'DECLARADO' }, evento: 'MUNDO_AL_REVES' };
    assert.strictEqual(bots.decidirBot(s, bot, { esDealer: false, derecha: rey }, () => 0.9), 'MANTENER');
});
