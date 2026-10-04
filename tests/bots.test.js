// Pruebas de la lógica de bots (sin servidor ni base):  node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const bots = require('../bots');

const fijo = (v) => () => v; // "azar" controlado
const jug = (id, carta, extra = {}) => ({ id, nombre: id, vidas: 3, cartaActual: carta, esBot: true, ...extra });
const sala = (jugadores, config = {}, extra = {}) => ({
    jugadores, descarte: [],
    config: { modoJuego: 'CLASICO', modoRey: 'SORPRESA', dificultadBots: 'DIFICIL', ...config }, ...extra,
});

test('probPerder: con 0 casi seguro pierdes en clásico, con 9 nunca', () => {
    const dist = bots.COMPOSICION.map(n => n / 76);
    assert.ok(bots.probPerder(0, dist, 3, false) > 0.8);
    assert.strictEqual(bots.probPerder(9, dist, 3, false), 0);
    // Si pierde la más alta (Mundo al revés) es al revés
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
    const s = sala([a, b, c], {}, { evento: 'MUNDO_AL_REVES' });
    // Mundo al revés (pierde la más alta): con un 7, recuperar ese 0 le conviene.
    a.cartaActual = 7;
    assert.strictEqual(bots.decidirBot(s, a, { esDealer: false, derecha: b }, fijo(0.9)), 'CAMBIAR');
    // Clásico (pierde la más baja): con un 2, recibir el 0 sería peor.
    a.cartaActual = 2; s.evento = null;
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

test('dificultad desconocida cae en NORMAL y el retraso es humano', () => {
    const a = jug('a', 8), b = jug('b', 5);
    const d = bots.decidirBot(sala([a, b], { dificultadBots: 'XYZ' }), a, { esDealer: false, derecha: b }, fijo(0.9));
    assert.strictEqual(d, 'MANTENER');
    assert.ok(bots.retrasoBot(fijo(0)) >= 3000 && bots.retrasoBot(fijo(0.999)) <= 4000);
});

test('diez: el bot cambia si lo acerca a la meta y mantiene si se pasaría', () => {
    const fijo9 = () => 0.9;
    const mk = (carta, compa) => {
        const bot = { id: 'b', nombre: 'b', esBot: true, vidas: 3, cartaActual: carta, equipo: 0, memoria: { c: compa } };
        const c = { id: 'c', nombre: 'c', vidas: 3, cartaActual: compa, equipo: 0 };
        const r = { id: 'r', nombre: 'r', vidas: 3, cartaActual: 5, equipo: 1 };
        return [bot, { jugadores: [bot, r, c, { id: 'r2', nombre: 'r2', vidas: 3, cartaActual: 5, equipo: 1 }], descarte: [], config: { equipos: 2, dificultadBots: 'NORMAL' } }, r];
    };
    let [bot, s, r] = mk(1, 5); // 6: le falta, cambiar suele acercar
    assert.strictEqual(bots.decidirBot(s, bot, { esDealer: false, derecha: r }, fijo9), 'CAMBIAR');
    [bot, s, r] = mk(5, 5); // 10 exacto: no tocar
    assert.strictEqual(bots.decidirBot(s, bot, { esDealer: false, derecha: r }, fijo9), 'MANTENER');
    [bot, s, r] = mk(8, 7); // 15: se pasa, cambiar para bajar
    assert.strictEqual(bots.decidirBot(s, bot, { esDealer: false, derecha: r }, fijo9), 'CAMBIAR');
});

test('corte: el bot protege a su Rey si su carta le conviene y acusa al único rival sin delatar', () => {
    const bot = { id: 'b', nombre: 'b', esBot: true, vidas: 3, cartaActual: 8, equipo: 0, memoria: { r: 2 } };
    const rey = { id: 'r', nombre: 'r', vidas: 3, cartaActual: 2, equipo: 0 };
    const x = { id: 'x', nombre: 'x', vidas: 3, cartaActual: 5, equipo: 1 }, y = { id: 'y', nombre: 'y', vidas: 3, cartaActual: 5, equipo: 1 };
    const s = { jugadores: [bot, x, rey, y], descarte: [], config: { modoJuego: 'CORTE', equipos: 2 },
                reyesCorte: { 0: 'r', 1: 'y' }, acusoCorte: {}, reyReveladoCorte: {}, delatadosCorte: { 1: ['x'] } };
    assert.deepStrictEqual(bots.planCorte(s, bot), { proteger: 2, acusar: 'y' });
    bot.cartaActual = 3; s.acusoCorte[0] = true;
    assert.deepStrictEqual(bots.planCorte(s, bot), {}); // 3 contra 2: no vale la pena; ya acusaron
});

test('conspiración: bot Bufón invierte carta con Truco del Espejo y mantiene', () => {
    const bot = { id: 'buf', nombre: 'b', vidas: 3, cartaActual: 0, conspiracion: { id: 'BUFON', habilidadUsada: false } };
    const s = { jugadores: [bot], evento: null };
    const plan = bots.planConspiracion(s, bot, { esDealer: false });
    assert.deepStrictEqual(plan, { habilidad: 'TRUCO_ESPEJO', accionSiguiente: 'MANTENER' });
});

test('conspiración: bot Campeón usa Intervención Real contra vecino con Rey o escudo', () => {
    const bot = { id: 'cam', nombre: 'b', vidas: 3, cartaActual: 2, conspiracion: { id: 'CAMPEON', habilidadUsada: false } };
    const rey = { id: 'rey', nombre: 'r', vidas: 3, cartaActual: 9, cartaRevelada: true };
    const s = { jugadores: [bot, rey], escudos: [], evento: null };
    const plan = bots.planConspiracion(s, bot, { esDealer: false, derecha: rey });
    assert.deepStrictEqual(plan, { habilidad: 'INTERVENCION', accionSiguiente: 'CAMBIAR' });
});

test('conspiración: bot Usurpador perpetra Golpe de Estado con carta baja', () => {
    const bot = { id: 'usr', nombre: 'b', vidas: 3, cartaActual: 1, conspiracion: { id: 'USURPADOR', habilidadUsada: false } };
    const s = { jugadores: [bot], evento: null };
    const plan = bots.planConspiracion(s, bot, { esDealer: false });
    assert.deepStrictEqual(plan, { habilidad: 'GOLPE_ESTADO' });
});

test('conspiración: bot Asesino envenena cambio cuando entrega carta mortal', () => {
    const bot = { id: 'ase', nombre: 'b', vidas: 3, cartaActual: 1, conspiracion: { id: 'ASESINO', habilidadUsada: false } };
    const rival = { id: 'riv', nombre: 'r', vidas: 3 };
    const s = { jugadores: [bot, rival], evento: null };
    const plan = bots.planConspiracion(s, bot, { esDealer: false, derecha: rival });
    assert.deepStrictEqual(plan, { habilidad: 'DAGA_ENVENENADA', accionSiguiente: 'CAMBIAR' });
});

test('conspiración: bot Inquisidor prioriza interrogar humanos vivos', () => {
    const bot = { id: 'inq', nombre: 'b', vidas: 3, cartaActual: 5, conspiracion: { id: 'INQUISIDOR', habilidadUsada: false, interrogados: [] } };
    const bot2 = { id: 'bot2', nombre: 'b2', vidas: 3, esBot: true };
    const humano = { id: 'hum', nombre: 'h', vidas: 2, esBot: false };
    const s = { jugadores: [bot, bot2, humano], evento: null };
    const plan = bots.planConspiracion(s, bot, { esDealer: false });
    assert.deepStrictEqual(plan, { habilidad: 'INTERROGATORIO', objetivoId: 'hum' });
});

test('arcana: bot usa VELO_SOMBRAS con carta 0 siendo dealer', () => {
    const bot = { id: 'bot1', nombre: 'b', vidas: 3, cartaActual: 0, arcana: { grimorio: ['VELO_SOMBRAS'] } };
    const s = { jugadores: [bot], evento: null };
    const plan = bots.planArcana(s, bot, { esDealer: true });
    assert.deepStrictEqual(plan, { hechizo: 'VELO_SOMBRAS' });
});

test('arcana: bot usa CRONORUPTURA contra vecino con escudo o Rey', () => {
    const bot = { id: 'bot1', nombre: 'b', vidas: 3, cartaActual: 2, arcana: { grimorio: ['CRONORUPTURA'] } };
    const vecino = { id: 'v1', nombre: 'vec', vidas: 3, cartaActual: 9, cartaRevelada: true };
    const s = { jugadores: [bot, vecino], escudos: [], evento: null };
    const plan = bots.planArcana(s, bot, { esDealer: false, derecha: vecino });
    assert.deepStrictEqual(plan, { hechizo: 'CRONORUPTURA', accionSiguiente: 'CAMBIAR' });
});

test('arcana: bot usa ILUSION para fortalecer carta media y mantener', () => {
    const bot = { id: 'bot1', nombre: 'b', vidas: 3, cartaActual: 4, arcana: { grimorio: ['ILUSION'] } };
    const s = { jugadores: [bot], evento: null };
    const plan = bots.planArcana(s, bot, { esDealer: false });
    assert.deepStrictEqual(plan, { hechizo: 'ILUSION', accionSiguiente: 'MANTENER' });
});


