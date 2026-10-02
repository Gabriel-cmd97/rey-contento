// Todos contra el Rey: un humano + bots contra el Rey Tirano hasta el final.
// Revisa que el Tirano se siente con sus vidas, que cada ronda traiga `jefe`
// con la regla bien aplicada y que el final diga quién ganó. Se corre desde
// tests/run.sh (server en :4000).
const fetch = require('node-fetch'); const { io } = require('socket.io-client');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const u = `t_j${Date.now().toString(36).slice(-4)}_a`;
const fallas = [];
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallas.push(msg); };

(async () => {
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const s = io(URL, { auth: { token }, reconnection: false });
  await new Promise(r => s.once('connect', r));
  const idSala = await new Promise(r => { s.once('salaCreada', r); s.emit('crearSala', { configuracion: { modoJuego: 'JEFE', vidas: 3, maxJugadores: 4 } }); });
  s.emit('iniciarPartida', idSala);
  let rondas = 0, primera = true, vidasPrevias = null;
  const jugar = (d) => { if (d.id === s.id) s.emit('accionJugador', { idSala, accion: 'MANTENER' }); };
  s.on('juegoIniciado', jugar); s.on('cambioDeTurno', jugar);
  s.on('datosMesa', d => {
    if (!primera) return; primera = false;
    const rey = d.jugadores.find(j => j.esJefe);
    ok(!!rey && rey.nombre === 'Rey Tirano', 'el Rey Tirano está sentado');
    ok(rey && rey.vidas === 5, `3 del pueblo: el Tirano tiene ${rey && rey.vidas} vidas (esperado 5)`);
    ok(d.jugadores.length === 4, `mesa de 4 (${d.jugadores.length})`);
    ok(!d.evento, 'sin eventos');
  });
  const fin = new Promise(r => {
    s.on('rondaTerminada', d => {
      rondas++;
      const f = d.jefe;
      if (!f) { ok(false, `ronda ${rondas}: falta jefe`); return; }
      const rey = d.jugadores.find(j => j.esJefe);
      const pueblo = d.jugadores.filter(j => !j.esJefe && (j.vidas > 0 || d.perdedores.includes(j.id)));
      const golpes = pueblo.filter(j => j.cartaActual > rey.cartaActual).length;
      ok(golpes === f.golpes && f.cayoRey === (golpes >= f.necesarios), `ronda ${rondas}: Tirano ${f.carta}, ${golpes}/${pueblo.length} le ganan → ${f.cayoRey ? 'pierde el Tirano' : 'pierde el pueblo'}`);
      if (f.cayoRey) ok(d.perdedores.length === 1 && d.perdedores[0] === rey.id, '   solo pierde el Tirano');
      if (d.dealerId === s.id && !d.juegoTerminado) setTimeout(() => s.emit('siguienteRonda', idSala), 800);
    });
    s.on('finDelJuego', r);
  });
  const g = await Promise.race([fin, new Promise(r => setTimeout(() => r(null), 360000))]);
  ok(!!g, 'la partida terminó');
  if (g) {
    ok(g.contraRey === true, 'el final sabe que fue contra el Rey');
    ok(g.esEquipo ? g.integrantes.includes(u) : g.esJefe, `ganó ${g.esEquipo ? 'el pueblo' : 'el Tirano'} en ${rondas} rondas`);
  }
  s.disconnect();
  console.log(fallas.length ? `FALLAS: ${fallas.length}` : 'TODO BIEN'); process.exit(fallas.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
