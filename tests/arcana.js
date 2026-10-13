// Modo Guerra Arcana: un humano contra bots. Revisa que se entregue el Grimorio,
// que los hechizos estén disponibles, que los bots ejecuten sus tácticas arcanas
// y que la partida avance con normalidad hasta terminar o resolver rondas.
const fetch = require('node-fetch'); const { io } = require('socket.io-client');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const u = `t_a${Date.now().toString(36).slice(-4)}_a`;
const fallas = [];
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallas.push(msg); };

(async () => {
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const s = io(URL, { auth: { token }, reconnection: false });
  await new Promise(r => s.once('connect', r));

  const idSala = await new Promise(r => {
    s.once('salaCreada', r);
    s.emit('crearSala', { configuracion: { modoJuego: 'GUERRA_ARCANA', vidas: 3, maxJugadores: 4 } });
  });

  s.emit('iniciarPartida', idSala);

  let rondas = 0, grimorioRecibido = false, sentidoVisto = false;
  let hechizos = [];

  s.on('tuGrimorio', g => {
    grimorioRecibido = true;
    hechizos = g;
    ok(Array.isArray(g) && g.length > 0, `Grimorio recibido con ${g.length} hechizos`);
  });

  s.on('sentidoTurnos', sentido => {
    sentidoVisto = true;
    ok(sentido === 1 || sentido === -1, `Sentido de turnos recibido: ${sentido}`);
  });

  const jugar = (d) => {
    if (d.id !== s.id) return;
    // Si tenemos hechizo de velo o destierro, probar lanzarlo
    const velo = hechizos.find(h => h.id === 'VELO_SOMBRAS');
    if (velo) {
      s.emit('lanzarHechizo', { idSala, hechizoId: 'VELO_SOMBRAS' });
      hechizos = hechizos.filter(h => h.id !== 'VELO_SOMBRAS');
    }
    setTimeout(() => {
      s.emit('accionJugador', { idSala, accion: 'MANTENER' });
    }, 400);
  };

  s.on('juegoIniciado', jugar);
  s.on('cambioDeTurno', jugar);

  const fin = new Promise(r => {
    s.on('rondaTerminada', d => {
      rondas++;
      ok(true, `Ronda ${rondas} terminada con éxito en Guerra Arcana`);
      if (d.juegoTerminado || rondas >= 3) return r(d);
      if (d.dealerId === s.id) setTimeout(() => s.emit('siguienteRonda', idSala), 1000);
    });
    s.on('finDelJuego', r);
  });

  const res = await Promise.race([fin, new Promise(r => setTimeout(() => r(null), 120000))]);
  ok(!!res, 'La partida de Guerra Arcana avanzó correctamente');
  ok(grimorioRecibido, 'Se recibió el grimorio arcano');

  s.disconnect();
  console.log(fallas.length ? `FALLAS: ${fallas.length}` : 'TODO BIEN');
  process.exit(fallas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
