// Pruebas de la elección de eventos de ronda (sin servidor ni base).
const test = require('node:test');
const assert = require('node:assert');
const { elegirEvento, IDS, CATALOGO, MAX_RONDAS_SIN_EVENTO } = require('../eventos');
const bots = require('../bots');

const sala = (extra = {}, config = {}) => ({ rondaActual: 3, config: { modoJuego: 'CLASICO', ...config }, ...extra });

test('catálogo: cada evento tiene título, descripción e ícono', () => {
    IDS.forEach(id => assert.ok(CATALOGO[id].titulo && CATALOGO[id].descripcion && CATALOGO[id].icono, id));
});

test('nunca hay evento en práctica, ronda 1, eventos apagados o duelo', () => {
    const siempre = () => 0; // el azar siempre diría que sí
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
    const s = { jugadores: [bot, rey, otro], descarte: [],
                config: { modoJuego: 'CLASICO', dificultadBots: 'DIFICIL', modoRey: 'DECLARADO' } };
    const ctx = { esDealer: false, derecha: rey };
    assert.strictEqual(bots.decidirBot(s, bot, ctx, () => 0.9), 'MANTENER'); // sin evento: el Rey bloquea
    s.evento = 'MERCADO';
    assert.strictEqual(bots.decidirBot(s, bot, ctx, () => 0.9), 'CAMBIAR');  // en Mercado roba del mazo
});

test('bots: en Mundo al revés no toman el 9 del vecino', () => {
    const bot = { id: 'b', cartaActual: 8, vidas: 3, esBot: true };
    const rey = { id: 'r', cartaActual: 9, vidas: 3, cartaRevelada: true };
    const s = { jugadores: [bot, rey, { id: 'o', cartaActual: 4, vidas: 3 }], descarte: [],
                config: { modoJuego: 'CLASICO', dificultadBots: 'DIFICIL', modoRey: 'DECLARADO' }, evento: 'MUNDO_AL_REVES' };
    assert.strictEqual(bots.decidirBot(s, bot, { esDealer: false, derecha: rey }, () => 0.9), 'MANTENER');
});

// --- Eventos de amigos y modo Fiesta (24/09/2026) ---
const { rotarCartas, resolverCartas } = require('../reglas');
const { opcionesVotacion, disponibles } = require('../eventos');

test('carrusel: cada quien recibe la carta de su izquierda; el Rey y los eliminados no se mueven', () => {
    const js = [{ nombre: 'a', cartaActual: 1, vidas: 2 }, { nombre: 'b', cartaActual: 9, vidas: 2 },
                { nombre: 'c', cartaActual: 5, vidas: 0 }, { nombre: 'd', cartaActual: 7, vidas: 1 }];
    const pases = rotarCartas(js, j => j.cartaActual === 9);
    assert.deepStrictEqual(js.map(j => j.cartaActual), [7, 9, 5, 1]);
    assert.strictEqual(pases.length, 2);
});

test('premio real: la más alta gana una vida sin pasar de las iniciales', () => {
    const s = { evento: 'PREMIO', config: { vidas: 3 }, jugadores: [
        { id: 'a', nombre: 'a', cartaActual: 8, vidas: 2 }, { id: 'b', nombre: 'b', cartaActual: 1, vidas: 3 },
        { id: 'c', nombre: 'c', cartaActual: 8, vidas: 3 }] };
    const r = resolverCartas(s);
    assert.deepStrictEqual(s.jugadores.map(j => j.vidas), [3, 2, 3]);
    assert.deepStrictEqual(r.premiados, ['a']);
});

test('disponibles: sin Premio en parejas y sin Venganza si no hay vengador vivo', () => {
    const s = sala({ jugadores: [{ nombre: 'x', vidas: 0 }], vengadores: ['x'] }, { equipos: 2 });
    const d = disponibles(s);
    assert.ok(!d.includes('PREMIO') && !d.includes('VENGANZA') && d.includes('CARRUSEL'));
    s.jugadores[0].vidas = 1;
    assert.ok(disponibles(s).includes('VENGANZA'));
});

test('fiesta: hay evento desde la ronda 1 y gana el más votado', () => {
    const nunca = () => 0.99;
    const s = sala({ rondaActual: 1, jugadores: [] }, { modoJuego: 'FIESTA' });
    assert.ok(elegirEvento(s, 4, nunca));
    s.votacion = { opciones: ['NIEBLA', 'MERCADO', 'CARRUSEL'], votos: { a: 'MERCADO', b: 'MERCADO', c: 'NIEBLA' } };
    s.ultimoEvento = null;
    assert.strictEqual(elegirEvento(s, 4, nunca), 'MERCADO');
    assert.strictEqual(s.votacion, null);
});

test('votación: 3 opciones distintas y nunca repite el último evento', () => {
    const s = sala({ jugadores: [], ultimoEvento: 'NIEBLA' });
    const o = opcionesVotacion(s);
    assert.strictEqual(o.length, 3);
    assert.strictEqual(new Set(o).size, 3);
    assert.ok(!o.includes('NIEBLA'));
});

test('venganza: el bot va por la carta más alta que conoce, nunca por el Rey', () => {
    const bot = { id: 'b', nombre: 'b', esBot: true, cartaActual: 2, vidas: 2, memoria: { x: 6, y: 9, z: 4 } };
    const s = { jugadores: [bot, { id: 'x', nombre: 'x', vidas: 1 }, { id: 'y', nombre: 'y', vidas: 2 }, { id: 'z', nombre: 'z', vidas: 2 }] };
    assert.strictEqual(bots.objetivoVenganza(s, bot), 1);
    s.escudos = ['x'];
    assert.strictEqual(bots.objetivoVenganza(s, bot), 3);
});
