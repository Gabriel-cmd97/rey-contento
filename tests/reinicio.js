// Reinicio a media partida: el jugador se reconecta solo, vuelve a su sala
// con su misma carta y la ronda sigue. OJO: ejecuta 'pm2 restart rey-contento'
// (reinicia producción), por eso NO está en tests/run.sh. Correr a mano:
//   NODE_PATH=/tmp/rey-tests/node_modules node tests/reinicio.js
const fetch = require('node-fetch'); const { io } = require('socket.io-client'); const { execSync } = require('child_process');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const esperar = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const u = 't_sob' + Date.now().toString(36).slice(-4) + '_a';
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const s = io(URL, { auth: { token }, reconnectionDelay: 1000 });
  await new Promise(r => s.once('connect', r));
  s.emit('crearSala', { configuracion: { vidas: 3, maxJugadores: 3, numBots: 2, tiempoTurno: 20 } });
  const idSala = await new Promise(r => s.once('salaCreada', r));
  let miCarta = null; s.on('tuCarta', c => { miCarta = c; });
  s.emit('iniciarPartida', idSala);
  let ronda = 0; s.on('datosMesa', d => { ronda = d.ronda; });
  await esperar(2500);
  console.log(`antes del reinicio: sala ${idSala}, ronda ${ronda}, mi carta ${miCarta}`);
  let cartaAntes = miCarta; s.once('disconnect', () => { cartaAntes = miCarta; });

  let reconexion = null; s.on('reconexionExitosa', d => { reconexion = d; });
  s.on('connect', () => s.emit('unirseSala', { idSala }));   // lo mismo que hace el navegador
  const eventosDespues = []; ['cambioDeTurno', 'rondaTerminada', 'datosMesa', 'juegoIniciado'].forEach(ev => s.on(ev, () => eventosDespues.push(ev)));
  // Mi turno: mantener (para que la ronda avance)
  s.on('cambioDeTurno', d => { if (d.id === s.id) setTimeout(() => s.emit('accionJugador', { idSala, accion: 'MANTENER' }), 400); });
  s.on('juegoIniciado', d => { if (d.id === s.id) setTimeout(() => s.emit('accionJugador', { idSala, accion: 'MANTENER' }), 900); });

  execSync('pm2 restart rey-contento');
  const t0 = Date.now();
  while (!reconexion && Date.now() - t0 < 20000) await esperar(200);
  console.log(`reconectado en ${((Date.now() - t0) / 1000).toFixed(1)} s:`, !!reconexion, '| misma sala:', reconexion?.idSala === idSala, '| misma carta:', reconexion?.carta === cartaAntes, `(${reconexion?.carta})`, '| estado:', reconexion?.estado);
  await esperar(20000);
  console.log('después del reinicio llegaron:', [...new Set(eventosDespues)].join(', '));
  s.disconnect(); process.exit(0);
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
