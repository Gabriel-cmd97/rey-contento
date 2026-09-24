// Inactividad: sin jugar, el primer turno perdido lo juega el juego y el
// segundo seguido pasa a modo automático; "volverAJugar" devuelve el control.
// Tarda ~95 s. Correr a mano: NODE_PATH=/tmp/rey-tests/node_modules node tests/inactividad.js
const fetch = require('node-fetch'); const { io } = require('socket.io-client');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const esperar = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const u = 't_afk' + Date.now().toString(36).slice(-4) + '_a';
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const s = io(URL, { auth: { token }, reconnection: false }); await new Promise(r => s.once('connect', r));
  s.emit('crearSala', { configuracion: { vidas: 10, numBots: 1, maxJugadores: 2, eventos: false } });
  const id = await new Promise(r => s.once('salaCreada', r));
  const t0 = Date.now(); const reloj = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  let miTurnoDesde = null; const duraciones = [];
  const turno = d => { if (d.id === s.id) miTurnoDesde = Date.now(); else if (miTurnoDesde) { duraciones.push(((Date.now() - miTurnoDesde) / 1000).toFixed(1)); miTurnoDesde = null; } };
  s.on('juegoIniciado', turno); s.on('cambioDeTurno', turno);
  s.on('rondaTerminada', () => { if (miTurnoDesde) { duraciones.push(((Date.now() - miTurnoDesde) / 1000).toFixed(1)); miTurnoDesde = null; } });
  s.on('mensajeGlobal', m => { if (m.includes(u) && /jugó por|ausente|volvió/.test(m)) console.log(`[${reloj()}] ${m.replace(u, 'YO')}`); });
  s.on('modoAutomatico', d => console.log(`[${reloj()}] aviso modo automático → ${d.activo ? 'ACTIVO' : 'apagado'}`));
  s.emit('iniciarPartida', id);   // nunca juego
  await new Promise(r => s.on('modoAutomatico', d => d.activo && r()));
  await esperar(20000);
  console.log('duración de mis turnos (s):', duraciones.join(', '));
  s.emit('volverAJugar', id);
  await esperar(1500);
  s.emit('abandonarSala', id); s.disconnect(); process.exit(0);
})();
