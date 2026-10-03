// tests/conspiracion.test.js — Pruebas unitarias de "Conspiración en la Corte"
const test = require('node:test');
const assert = require('node:assert');
const conspiracion = require('../conspiracion');
const { resolverCartas } = require('../reglas');

test('conspiración: catálogo de roles tiene todas las propiedades requeridas', () => {
    assert.ok(conspiracion.IDS_ROLES.length >= 5);
    conspiracion.IDS_ROLES.forEach(id => {
        const r = conspiracion.ROLES[id];
        assert.ok(r.id, `${id} sin id`);
        assert.ok(r.titulo, `${id} sin titulo`);
        assert.ok(r.faccion, `${id} sin faccion`);
        assert.ok(r.icono, `${id} sin icono`);
        assert.ok(r.lema, `${id} sin lema`);
        assert.ok(r.mision, `${id} sin mision`);
        assert.ok(r.habilidad && r.habilidad.id && r.habilidad.nombre && r.habilidad.descripcion, `${id} sin habilidad`);
    });
});

test('conspiración: asignarRoles reparte roles a todos los jugadores según cantidad', () => {
    const jugadores4 = [{ id: '1', nombre: 'A' }, { id: '2', nombre: 'B' }, { id: '3', nombre: 'C' }, { id: '4', nombre: 'D' }];
    conspiracion.asignarRoles(jugadores4);
    jugadores4.forEach(j => {
        assert.ok(j.conspiracion);
        assert.ok(j.conspiracion.rol);
        assert.strictEqual(j.conspiracion.habilidadUsada, false);
        assert.strictEqual(j.conspiracion.misionCumplida, false);
    });

    const rolesAsignados = jugadores4.map(j => j.conspiracion.id);
    assert.strictEqual(new Set(rolesAsignados).size, 4);
});

test('conspiración: puedeUsarHabilidad respeta turno, vidas y si ya fue usada', () => {
    const sala = {
        turnoActualIndex: 0,
        jugadores: [
            { id: '1', vidas: 3, conspiracion: { id: 'CAMPEON', habilidadUsada: false } },
            { id: '2', vidas: 3, conspiracion: { id: 'ASESINO', habilidadUsada: false } }
        ]
    };

    assert.strictEqual(conspiracion.puedeUsarHabilidad(sala.jugadores[0], sala), true);
    assert.strictEqual(conspiracion.puedeUsarHabilidad(sala.jugadores[1], sala), false); // no es su turno

    sala.jugadores[0].conspiracion.habilidadUsada = true;
    assert.strictEqual(conspiracion.puedeUsarHabilidad(sala.jugadores[0], sala), false); // ya usada

    sala.jugadores[0].conspiracion.habilidadUsada = false;
    sala.jugadores[0].vidas = 0;
    assert.strictEqual(conspiracion.puedeUsarHabilidad(sala.jugadores[0], sala), false); // eliminado
});

test('conspiración: ejecutarHabilidad de Inquisidor revela el rol del objetivo', () => {
    const sala = {
        jugadores: [
            { id: 'inq', nombre: 'Inquisidor', vidas: 3, conspiracion: { id: 'INQUISIDOR', habilidadUsada: false, interrogados: [] } },
            { id: 'obj', nombre: 'Traidor', vidas: 3, conspiracion: { id: 'ASESINO', rol: conspiracion.ROLES.ASESINO, habilidadUsada: false } }
        ]
    };

    const res = conspiracion.ejecutarHabilidad(sala, sala.jugadores[0], 'obj');
    assert.ok(res);
    assert.strictEqual(res.tipo, 'INQUISICION');
    assert.strictEqual(res.rolRevelado.id, 'ASESINO');
    assert.strictEqual(sala.jugadores[0].conspiracion.habilidadUsada, true);
    assert.ok(sala.jugadores[0].conspiracion.interrogados.includes('obj'));
});

test('conspiración: ejecutarHabilidad de Bufón invierte cartaEfectiva para la ronda', () => {
    const bufon = { id: 'buf', nombre: 'Bufón', vidas: 3, cartaActual: 1, conspiracion: { id: 'BUFON', habilidadUsada: false } };
    const sala = { jugadores: [bufon] };

    const res = conspiracion.ejecutarHabilidad(sala, bufon);
    assert.ok(res);
    assert.strictEqual(res.tipo, 'ESPEJO');
    assert.strictEqual(bufon.cartaEfectiva, 8); // 9 - 1
    assert.strictEqual(bufon.conspiracion.habilidadUsada, true);

    // En resolverCartas, debe perder el que tenga valor real más bajo
    const rival = { id: 'riv', nombre: 'Rival', vidas: 3, cartaActual: 2 };
    const salaJuego = {
        config: { modoJuego: 'CONSPIRACION' },
        jugadores: [bufon, rival]
    };
    const resRonda = resolverCartas(salaJuego);
    assert.deepStrictEqual(resRonda.perdedores, ['riv']); // Rival tiene 2, Bufón tiene cartaEfectiva 8
});

test('conspiración: ejecutarHabilidad de Usurpador roba directo del mazo', () => {
    const usur = { id: 'u', nombre: 'Usurpador', vidas: 3, cartaActual: 2, conspiracion: { id: 'USURPADOR', habilidadUsada: false } };
    const sala = {
        jugadores: [usur],
        mazo: [5, 9],
        descarte: []
    };

    const res = conspiracion.ejecutarHabilidad(sala, usur);
    assert.ok(res);
    assert.strictEqual(res.tipo, 'GOLPE_ESTADO');
    assert.strictEqual(usur.cartaActual, 9);
    assert.deepStrictEqual(sala.descarte, [2]);
    assert.strictEqual(usur.conspiracion.habilidadUsada, true);
});

test('conspiración: evaluarRonda otorga recompensa a Bufón y Usurpador al cumplir misión', () => {
    const sala = {
        jugadores: [
            { id: '1', nombre: 'B', vidas: 3, cartaActual: 0, conspiracion: { id: 'BUFON', rol: conspiracion.ROLES.BUFON, misionCumplida: false } },
            { id: '2', nombre: 'U', vidas: 3, cartaActual: 9, conspiracion: { id: 'USURPADOR', rol: conspiracion.ROLES.USURPADOR, misionCumplida: false } }
        ]
    };

    const evs = conspiracion.evaluarRonda(sala);
    assert.strictEqual(evs.length, 2);
    assert.strictEqual(sala.jugadores[0].conspiracion.misionCumplida, true);
    assert.strictEqual(sala.jugadores[0].conspiracion.recompensaBlis, 50);
    assert.strictEqual(sala.jugadores[1].conspiracion.misionCumplida, true);
    assert.strictEqual(sala.jugadores[1].conspiracion.recompensaBlis, 50);
});

test('conspiración: evaluarFinPartida premia Campeón ganador y revela todos los roles', () => {
    const sala = {
        jugadores: [
            { id: 'c', nombre: 'Campeon', vidas: 2, conspiracion: { id: 'CAMPEON', rol: conspiracion.ROLES.CAMPEON, misionCumplida: false } },
            { id: 'a', nombre: 'Asesino', vidas: 0, conspiracion: { id: 'ASESINO', rol: conspiracion.ROLES.ASESINO, misionCumplida: false } }
        ]
    };

    const revelaciones = conspiracion.evaluarFinPartida(sala, sala.jugadores[0]);
    assert.strictEqual(revelaciones.length, 2);
    const revCamp = revelaciones.find(r => r.nombre === 'Campeon');
    assert.strictEqual(revCamp.misionCumplida, true);
    assert.ok(revCamp.recompensaBlis >= 75);
});
