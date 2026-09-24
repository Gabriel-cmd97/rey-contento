// Volver en tu turno (salir de la app y regresar): el aviso de turno debe
// traer el reloj que queda y la carta nunca debe llegar como "undefined".
// Correr a mano: NODE_PATH=/tmp/rey-tests/node_modules node tests/reconexion.js
const fetch = require('node-fetch'); const { io } = require('socket.io-client');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const conectar = token => new Promise(r => { const s = io(URL, { auth: { token }, reconnection: false }); s.once('connect', () => r(s)); });
(async () => {
  const u = 't_rc' + Date.now().toString(36).slice(-4) + '_a';
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  let s = await conectar(token);
  s.emit('crearSala', { configuracion: { vidas: 3, numBots: 2, maxJugadores: 3, eventos: false } });
  const id = await new Promise(r => s.once('salaCreada', r));
  const miTurno = new Promise(r => { const f = d => d.id === s.id && r(); s.on('juegoIniciado', f); s.on('cambioDeTurno', f); });
  s.emit('iniciarPartida', id);
  await miTurno;
  s.disconnect();                                   // sale de la app en su turno
  await new Promise(r => setTimeout(r, 3000));
  s = await conectar(token);
  const rec = new Promise(r => s.once('reconexionExitosa', r));
  const turno = new Promise(r => s.once('cambioDeTurno', r));
  s.emit('unirseSala', { idSala: id });
  const d = await rec, t = await turno;
  const ok = typeof d.carta === 'number' && typeof t.tiempo === 'number' && t.tiempo >= 8 && Array.isArray(t.jugadores) && t.modoJuego;
  console.log(`carta al volver: ${d.carta} | reloj que queda: ${t.tiempo} s | modo: ${t.modoJuego} →`, ok ? 'OK' : 'FALLA');
  s.emit('abandonarSala', id); s.disconnect(); process.exit(ok ? 0 : 1);
})();
