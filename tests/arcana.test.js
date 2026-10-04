const test = require('node:test');
const assert = require('node:assert');
const arcana = require('../arcana');
const { siguienteVivo } = require('../reglas');

test('arcana: catálogo de hechizos tiene todas las propiedades requeridas', () => {
    assert.strictEqual(arcana.IDS_HECHIZOS.length, 6);
    arcana.IDS_HECHIZOS.forEach(id => {
        const h = arcana.HECHIZOS[id];
        assert.ok(h.id, `Hechizo ${id} debe tener id`);
        assert.ok(h.nombre, `Hechizo ${id} debe tener nombre`);
        assert.ok(h.runa, `Hechizo ${id} debe tener runa`);
        assert.ok(h.color, `Hechizo ${id} debe tener color`);
        assert.ok(h.descripcion, `Hechizo ${id} debe tener descripcion`);
    });
});

test('arcana: repartirGrimorios entrega 2 hechizos iniciales a cada jugador', () => {
    const jugadores = [
        { id: 'j1', nombre: 'Merlín', vidas: 3 },
        { id: 'j2', nombre: 'Morgana', vidas: 3 },
        { id: 'j3', nombre: 'Gandalf', vidas: 3 }
    ];

    arcana.repartirGrimorios(jugadores);

    jugadores.forEach(j => {
        assert.ok(j.arcana, `${j.nombre} debe tener objeto arcana`);
        assert.strictEqual(j.arcana.grimorio.length, 2, `${j.nombre} debe tener 2 hechizos`);
        assert.strictEqual(j.arcana.veloActivo, false);
        assert.strictEqual(j.arcana.ilusionActiva, false);
    });
});

test('arcana: ejecutarHechizo INVERSION invierte el sentido de turnos', () => {
    const sala = {
        estadoActual: 'TURNOS_INTERCAMBIO',
        turnoActualIndex: 0,
        sentidoTurnos: 1,
        jugadores: [
            { id: 'j1', nombre: 'Merlín', vidas: 3, arcana: { grimorio: ['INVERSION'], hechizosLanzados: [] } },
            { id: 'j2', nombre: 'Morgana', vidas: 3, arcana: { grimorio: [], hechizosLanzados: [] } }
        ]
    };

    const res = arcana.ejecutarHechizo(sala, 'j1', 'INVERSION');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(sala.sentidoTurnos, -1);
    assert.strictEqual(sala.jugadores[0].arcana.grimorio.length, 0);

    // Con sentido -1, siguienteVivo avanza a la izquierda
    const idxAnt = siguienteVivo(sala.jugadores, 0, sala.sentidoTurnos);
    assert.strictEqual(idxAnt, 1);
});

test('arcana: ejecutarHechizo ILUSION aumenta valor efectivo en +2', () => {
    const sala = {
        estadoActual: 'TURNOS_INTERCAMBIO',
        turnoActualIndex: 0,
        jugadores: [
            { id: 'j1', nombre: 'Merlín', vidas: 3, cartaActual: 3, arcana: { grimorio: ['ILUSION'], hechizosLanzados: [] } }
        ]
    };

    const res = arcana.ejecutarHechizo(sala, 'j1', 'ILUSION');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(sala.jugadores[0].cartaEfectiva, 5); // 3 + 2
    assert.strictEqual(sala.jugadores[0].arcana.ilusionActiva, true);
});

test('arcana: ejecutarHechizo VELO_SOMBRAS protege y absorbe daño mortal', () => {
    const sala = {
        config: { modoJuego: 'GUERRA_ARCANA', vidas: 3 },
        estadoActual: 'TURNOS_INTERCAMBIO',
        turnoActualIndex: 0,
        escudos: [],
        jugadores: [
            { id: 'j1', nombre: 'Merlín', vidas: 2, cartaActual: 0, arcana: { grimorio: ['VELO_SOMBRAS'], hechizosLanzados: [] } },
            { id: 'j2', nombre: 'Morgana', vidas: 3, cartaActual: 7, arcana: { grimorio: [], hechizosLanzados: [] } }
        ]
    };

    const res = arcana.ejecutarHechizo(sala, 'j1', 'VELO_SOMBRAS');
    assert.strictEqual(res.ok, true);
    assert.ok(sala.escudos.includes('Merlín'));
    assert.strictEqual(sala.jugadores[0].arcana.veloActivo, true);

    // Simular que Merlín perdió la ronda con la carta más baja
    const resultadoRonda = { perdedores: ['j1'] };
    sala.jugadores[0].vidas = 1; // Supongamos que resolverCartas le restó 1 vida

    const eventos = arcana.resolverFinRondaArcana(sala, resultadoRonda);
    assert.strictEqual(resultadoRonda.perdedores.length, 0); // Velo lo salva de la lista de perdedores
    assert.strictEqual(sala.jugadores[0].vidas, 2); // Se le devuelve la vida absorbida
    assert.ok(eventos.some(e => e.tipo === 'VELO_ABSORCION'));
});

test('arcana: ejecutarHechizo DESTIERRO cambia la carta del vecino con una del mazo', () => {
    let cartaEnviada = null;
    const helpers = {
        enviarCarta: (s, j) => { cartaEnviada = j.cartaActual; }
    };

    const sala = {
        estadoActual: 'TURNOS_INTERCAMBIO',
        turnoActualIndex: 0,
        sentidoTurnos: 1,
        mazo: [9, 8, 4],
        jugadores: [
            { id: 'j1', nombre: 'Merlín', vidas: 3, arcana: { grimorio: ['DESTIERRO'], hechizosLanzados: [] } },
            { id: 'j2', nombre: 'Morgana', vidas: 3, cartaActual: 1, arcana: { grimorio: [], hechizosLanzados: [] } }
        ]
    };

    const res = arcana.ejecutarHechizo(sala, 'j1', 'DESTIERRO', {}, helpers);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(sala.jugadores[1].cartaActual, 4); // Robó del mazo
    assert.strictEqual(cartaEnviada, 4);
});

test('arcana: ejecutarHechizo CRONORUPTURA anula escudo de vecino', () => {
    const sala = {
        estadoActual: 'TURNOS_INTERCAMBIO',
        turnoActualIndex: 0,
        sentidoTurnos: 1,
        escudos: ['Morgana'],
        jugadores: [
            { id: 'j1', nombre: 'Merlín', vidas: 3, arcana: { grimorio: ['CRONORUPTURA'], hechizosLanzados: [] } },
            { id: 'j2', nombre: 'Morgana', vidas: 3, arcana: { grimorio: [], hechizosLanzados: [] } }
        ]
    };

    const res = arcana.ejecutarHechizo(sala, 'j1', 'CRONORUPTURA');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(sala.escudos.includes('Morgana'), false); // Escudo roto
    assert.strictEqual(sala.jugadores[0].arcana.cronorrupturaActiva, true);
});

test('arcana: reabastecerGrimorio añade un nuevo hechizo a jugador dañado', () => {
    const jugador = {
        id: 'j1',
        nombre: 'Merlín',
        vidas: 2,
        arcana: { grimorio: ['ILUSION'], hechizosLanzados: ['INVERSION'] }
    };

    const nuevo = arcana.reabastecerGrimorio(jugador);
    assert.ok(nuevo);
    assert.strictEqual(jugador.arcana.grimorio.length, 2);
    // Si ya tiene 2, no debe reabastecer más
    assert.strictEqual(arcana.reabastecerGrimorio(jugador), null);
});
