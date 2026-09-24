// Revancha: vuelve con los mismos jugadores que había, no con el cupo máximo.
// Mesa de 8 lugares con 1 humano + 2 bots → la revancha debe ser de 3.
// Correr a mano: NODE_PATH=/tmp/rey-tests/node_modules node tests/revancha.js
const fetch = require('node-fetch'); const { io } = require('socket.io-client');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
(async () => {
  const u = 't_rv' + Date.now().toString(36).slice(-4) + '_a';
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const s = io(URL, { auth: { token }, reconnection: false }); await new Promise(r => s.once('connect', r));
  const jugar = d => { if (d.id === s.id) setTimeout(() => s.emit('accionJugador', { idSala: id, accion: 'MANTENER' }), 500); };
  s.on('juegoIniciado', jugar); s.on('cambioDeTurno', jugar);
  s.emit('crearSala', { configuracion: { vidas: 1, numBots: 2, maxJugadores: 8, eventos: false } });
  const id = await new Promise(r => s.once('salaCreada', r));
  const primera = new Promise(r => s.once('datosMesa', r));
  s.emit('iniciarPartida', id);
  const antes = (await primera).jugadores.length;
  await new Promise(r => s.once('finDelJuego', r));
  const segunda = new Promise(r => s.once('datosMesa', r));
  s.emit('quieroJugarOtraVez', id);
  const despues = (await segunda).jugadores.length;
  console.log(`partida: ${antes} jugadores | revancha: ${despues} →`, antes === despues ? 'OK' : 'FALLA');
  s.emit('abandonarSala', id); s.disconnect(); process.exit(antes === despues ? 0 : 1);
})();
