// Partida rápida: 2 jugadores caen en la misma mesa y arranca sola con bots
// a los 45 s; 4 jugadores la llenan y arranca al instante.
// Se corre desde tests/run.sh (necesita el server en :4000).
const fetch = require('node-fetch'); const { io } = require('socket.io-client');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const suf = Date.now().toString(36).slice(-4);
async function jugador(letra) {
  const u = `t_r${suf}${letra}_a`;
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const s = io(URL, { auth: { token }, reconnection: false });
  await new Promise(r => s.once('connect', r));
  return s;
}
const unirse = (s) => new Promise(r => { s.once('rapidaUnido', r); s.emit('partidaRapida'); });
const mesa = (s, ms) => new Promise((r, x) => { const t = setTimeout(() => x(new Error('sin datosMesa')), ms); s.once('datosMesa', d => { clearTimeout(t); r(d); }); });
(async () => {
  // 1) dos jugadores → misma sala, arranca sola con bots
  const [a, b] = [await jugador('a'), await jugador('b')];
  const ua = await unirse(a); const t0 = Date.now(); const ub = await unirse(b);
  console.log('misma sala:', ua.idSala === ub.idSala, '| faltan', Math.round(ua.faltanMs / 1000), 's');
  const d = await mesa(a, 50000);
  console.log(`arrancó a los ${((Date.now() - t0) / 1000).toFixed(1)} s con ${d.jugadores.length} jugadores:`, d.jugadores.map(j => j.nombre + (j.esBot ? '(bot)' : '')).join(', '));
  a.disconnect(); b.disconnect();
  // 2) cuatro jugadores → arranca en cuanto se llena
  const js = []; for (const l of ['c', 'd', 'e', 'f']) js.push(await jugador(l));
  const salas = []; for (const s of js.slice(0, 3)) salas.push((await unirse(s)).idSala);
  const t1 = Date.now(); const p = mesa(js[0], 5000); salas.push((await unirse(js[3])).idSala);
  const d2 = await p;
  console.log('4 humanos en la misma sala:', new Set(salas).size === 1, `| arrancó en ${Date.now() - t1} ms`, '| bots:', d2.jugadores.filter(j => j.esBot).length);
  js.forEach(s => s.disconnect()); process.exit(0);
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
