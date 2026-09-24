// Pruebas de las reglas puras (sin servidor ni base):  node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const { crearMazo, siguienteVivo, resolverCartas } = require('../reglas');

const j = (id, carta, vidas = 3) => ({ id, nombre: id, cartaActual: carta, vidas });
const sala = (jugadores, config = {}, extra = {}) => ({
    jugadores, config: { modoJuego: 'CLASICO', ...config }, campanaTocada: false, vueltasCampana: 0, ...extra,
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

test('campana: pierde la más alta; quien tocó y acertó no paga extra', () => {
    const s = sala([j('a', 1), j('b', 8), j('c', 4)], { modoJuego: 'CAMPANA' },
        { campanaTocada: true, campanaTocadorId: 'a' });
    const r = resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [3, 2, 3]);
    assert.deepStrictEqual(r.campanaInfo, { tocadorId: 'a', acertada: true });
});

test('campana: quien tocó con la carta mortal paga doble', () => {
    const s = sala([j('a', 8), j('b', 1), j('c', 4)], { modoJuego: 'CAMPANA' },
        { campanaTocada: true, campanaTocadorId: 'a' });
    const r = resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [1, 3, 3]);
    assert.strictEqual(r.campanaInfo.acertada, false);
});

test('campana: 2 vueltas sin tocarla → la más alta paga doble', () => {
    const s = sala([j('a', 8), j('b', 1)], { modoJuego: 'CAMPANA' }, { vueltasCampana: 2 });
    const r = resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [1, 3]);
    assert.match(r.mensajes[0], /cobarde/);
});

test('campana: si la penalización extra lo elimina, no pierde otra vida', () => {
    const s = sala([j('a', 8, 1), j('b', 1)], { modoJuego: 'CAMPANA' }, { vueltasCampana: 2 });
    resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [0, 3]);
});

test('campana: el empate total también perdona la penalización de no tocarla', () => {
    const s = sala([j('a', 6), j('b', 6)], { modoJuego: 'CAMPANA' }, { vueltasCampana: 2 });
    const r = resolverCartas(s);
    assert.deepStrictEqual(vidas(s), [3, 3]);
    assert.strictEqual(r.mensajes.length, 1);
    assert.match(r.mensajes[0], /Empate total/);
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
