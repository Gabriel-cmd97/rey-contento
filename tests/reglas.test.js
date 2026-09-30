// Pruebas de las reglas puras (sin servidor ni base):  node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const { crearMazo, siguienteVivo, resolverCartas } = require('../reglas');

const j = (id, carta, vidas = 3) => ({ id, nombre: id, cartaActual: carta, vidas });
const sala = (jugadores, config = {}, extra = {}) => ({
    jugadores, config: { modoJuego: 'CLASICO', ...config }, ...extra,
});
const vidas = (s) => s.jugadores.map(x => x.vidas);

test('crearMazo: 76 cartas con la composición correcta en todas las frecuencias', () => {
    for (const frecuenciaReyes of ['NORMAL', 'ALTA', 'LOCURA']) {
        const m = crearMazo({ frecuenciaReyes });
        assert.strictEqual(m.length, 76);
        const cuenta = Array(10).fill(0);
        m.forEach(c => cuenta[c]++);
        assert.deepStrictEqual(cuenta, [4, 8, 8, 8, 8, 8, 8, 8, 8, 8]);
    }
});

test('siguienteVivo: salta a los eliminados y da la vuelta', () => {
    const js = [j('a', 1), j('b', 2, 0), j('c', 3), j('d', 4, 0)];
    assert.strictEqual(siguienteVivo(js, 0), 2);
    assert.strictEqual(siguienteVivo(js, 2), 0);
});

test('clásico: pierde la carta más baja, y todos los empatados en ella', () => {
    const s = sala([j('a', 2), j('b', 5), j('c', 2)]);
    const r = resolverCartas(s);
    assert.strictEqual(r.valorCritico, 2);
    assert.deepStrictEqual(vidas(s), [2, 3, 2]);
    assert.deepStrictEqual(r.perdedores, ['a', 'c']);
});

test('empate total: nadie pierde vida', () => {
    const s = sala([j('a', 4), j('b', 4)]);
    const r = resolverCartas(s);
    assert.ok(r.empateTotal);
    assert.deepStrictEqual(vidas(s), [3, 3]);
    assert.match(r.mensajes[0], /Empate total/);
});

test('los eliminados no cuentan para la carta mortal', () => {
    const s = sala([j('a', 0, 0), j('b', 5), j('c', 7)]);
    resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [0, 2, 3]);
});

test('evento Mundo al revés: pierde la carta más alta en clásico', () => {
    const s = sala([j('a', 2), j('b', 8), j('c', 5)], {}, { evento: 'MUNDO_AL_REVES' });
    const r = resolverCartas(s);
    assert.strictEqual(r.valorCritico, 8);
    assert.deepStrictEqual(vidas(s), [3, 2, 3]);
});

test('evento Doble castigo: el perdedor pierde 2 vidas (sin bajar de 0)', () => {
    const s = sala([j('a', 1), j('b', 6, 1)], {}, { evento: 'DOBLE_CASTIGO' });
    resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [1, 1]);
    const s2 = sala([j('a', 1, 1), j('b', 6)], {}, { evento: 'DOBLE_CASTIGO' });
    resolverCartas(s2);
    assert.deepStrictEqual(vidas(s2), [0, 3]);
});

test('evento Amnistía: nadie pierde vida y el de la más baja queda castigado', () => {
    const s = sala([j('a', 1), j('b', 6), j('c', 1)], {}, { evento: 'AMNISTIA' });
    const r = resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [3, 3, 3]);
    assert.deepStrictEqual(r.perdedores, []);
    assert.deepStrictEqual(r.castigados, ['a', 'c']);
});

// --- Parejas (config.equipos) ---
const conEquipos = (jugadores, extra = {}) => sala(jugadores, { equipos: 2 }, extra);
const je = (id, carta, equipo, v = 3) => ({ ...j(id, carta, v), equipo });

test('diez: meta 10 en 2 contra 2; pierde el que quedó más lejos sin pasarse', () => {
    const s = conEquipos([je('a1', 2, 0), je('b1', 6, 1), je('a2', 5, 0), je('b2', 3, 1)]); // Oro 7, Plata 9
    const r = resolverCartas(s);
    assert.strictEqual(r.diez.objetivo, 10);
    assert.deepStrictEqual(r.diez.sumas, { 0: 7, 1: 9 });
    assert.deepStrictEqual(vidas(s), [2, 3, 2, 3]);
    assert.deepStrictEqual(r.perdedores.sort(), ['a1', 'a2']);
});

test('diez: pasarse pierde aunque el otro esté lejos; si los dos se pasan, pierde el que se pasó más', () => {
    const a = conEquipos([je('a1', 9, 0), je('b1', 1, 1), je('a2', 3, 0), je('b2', 1, 1)]); // Oro 12, Plata 2
    resolverCartas(a);
    assert.deepStrictEqual(vidas(a), [2, 3, 2, 3]);
    const b = conEquipos([je('a1', 9, 0), je('b1', 8, 1), je('a2', 3, 0), je('b2', 7, 1)]); // Oro 12, Plata 15
    resolverCartas(b);
    assert.deepStrictEqual(vidas(b), [3, 2, 3, 2]);
});

test('diez: empate exacto nadie pierde; 3 contra 3 la meta es 15', () => {
    const e = conEquipos([je('a1', 4, 0), je('b1', 6, 1), je('a2', 4, 0), je('b2', 2, 1)]); // 8 y 8
    const r = resolverCartas(e);
    assert.ok(r.empateTotal);
    assert.deepStrictEqual(vidas(e), [3, 3, 3, 3]);
    const t = sala([je('a1', 5, 0), je('b1', 5, 1), je('a2', 5, 0), je('b2', 5, 1), je('a3', 5, 0), je('b3', 4, 1)], { equipos: 3 });
    assert.strictEqual(resolverCartas(t).diez.objetivo, 15);
    assert.deepStrictEqual(vidas(t), [3, 2, 3, 2, 3, 2]); // Oro 15 exacto, Plata 14
});

test('diez con eventos: doble castigo quita 2, mundo al revés pierde el más cercano, amnistía no quita', () => {
    const d = conEquipos([je('a1', 1, 0), je('b1', 6, 1), je('a2', 2, 0), je('b2', 3, 1)], { evento: 'DOBLE_CASTIGO' });
    resolverCartas(d);
    assert.deepStrictEqual(vidas(d), [1, 3, 1, 3]);
    const m = conEquipos([je('a1', 1, 0), je('b1', 6, 1), je('a2', 2, 0), je('b2', 3, 1)], { evento: 'MUNDO_AL_REVES' }); // Oro 3, Plata 9
    resolverCartas(m);
    assert.deepStrictEqual(vidas(m), [3, 2, 3, 2]);
    const am = conEquipos([je('a1', 1, 0), je('b1', 6, 1), je('a2', 2, 0), je('b2', 3, 1)], { evento: 'AMNISTIA' });
    const r = resolverCartas(am);
    assert.deepStrictEqual(vidas(am), [3, 3, 3, 3]);
    assert.deepStrictEqual(r.castigados.sort(), ['a1', 'a2']);
});

// --- La Corte (Rey secreto) ---
const corte = (jugadores, reyes, extra = {}) => sala(jugadores, { modoJuego: 'CORTE', equipos: 2 }, { reyesCorte: reyes, ...extra });

test('corte: solo cuentan los Reyes; el de carta más baja le cuesta la vida a su equipo', () => {
    // Los escuderos tienen 0 y 1, pero no cuentan.
    const s = corte([je('a1', 6, 0), je('b1', 0, 1), je('a2', 1, 0), je('b2', 4, 1)], { 0: 'a1', 1: 'b2' });
    const r = resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [3, 2, 3, 2]);
    assert.deepStrictEqual(r.corte.perdedores, [1]);
    assert.deepStrictEqual(r.reyesCulpables, ['b2']);
    assert.deepStrictEqual(r.culpables, []); // hacia afuera no se nombra al Rey
});

test('corte: empate de Reyes nadie pierde; la acusación se cobra aunque empaten', () => {
    const s = corte([je('a1', 5, 0), je('b1', 2, 1), je('a2', 1, 0), je('b2', 5, 1)], { 0: 'a1', 1: 'b2' }, { castigoCorte: { 0: 1 } });
    const r = resolverCartas(s);
    assert.ok(r.empateTotal);
    assert.deepStrictEqual(vidas(s), [2, 3, 2, 3]);
    assert.deepStrictEqual(s.castigoCorte, {});
});

test('corte con mundo al revés y doble castigo', () => {
    const m = corte([je('a1', 8, 0), je('b1', 2, 1), je('a2', 1, 0), je('b2', 3, 1)], { 0: 'a1', 1: 'b2' }, { evento: 'MUNDO_AL_REVES' });
    resolverCartas(m);
    assert.deepStrictEqual(vidas(m), [2, 3, 2, 3]);
    const d = corte([je('a1', 8, 0), je('b1', 2, 1), je('a2', 1, 0), je('b2', 3, 1)], { 0: 'a1', 1: 'b2' }, { evento: 'DOBLE_CASTIGO' });
    resolverCartas(d);
    assert.deepStrictEqual(vidas(d), [3, 1, 3, 1]);
});
