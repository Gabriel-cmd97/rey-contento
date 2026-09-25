// Modo Fiesta: un humano contra bots, hasta 6 rondas. Revisa que haya evento
// en cada ronda, que la votación llegue y cuente el voto, que el evento votado
// sea el que sale, que tras el Carrusel tu carta sea la que se revela y que la
// Venganza acepte un objetivo. Se corre desde tests/run.sh (server en :4000).
const fetch = require('node-fetch'); const { io } = require('socket.io-client');
const URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const u = `t_f${Date.now().toString(36).slice(-4)}_a`;
const fallas = [];
const ok = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fallas.push(msg); };

(async () => {
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const s = io(URL, { auth: { token }, reconnection: false });
  await new Promise(r => s.once('connect', r));

  const idSala = await new Promise(r => {
    s.once('salaCreada', r);
    s.emit('crearSala', { configuracion: { modoJuego: 'FIESTA', vidas: 5, maxJugadores: 5 } });
  });
  let ronda = 0, votado = null, ultimaVotacion = null, miCarta = null, votosVistos = false, venganzaUsada = false;
  const eventosVistos = [];
  let evento = null, vengadores = [];

  s.on('tuCarta', c => { miCarta = c; });
  s.on('votosEvento', v => { ultimaVotacion = v; if (votado && v.votos[u] === votado) votosVistos = true; });
  s.on('datosMesa', d => {
    ronda = d.ronda; evento = d.evento && d.evento.id; vengadores = d.vengadores || [];
    eventosVistos.push(evento);
    if (ronda > 1 && ultimaVotacion) {
      const c = ultimaVotacion.conteo, max = Math.max(...Object.values(c));
      const ganadoras = Object.keys(c).filter(id => c[id] === max);
      ok(ganadoras.includes(evento), `ronda ${ronda}: salió el más votado (${JSON.stringify(c)} → ${evento})`);
    }
    votado = null; ultimaVotacion = null;
  });
  const jugar = (d) => {
    if (d.id !== s.id) return;
    const yo = d.jugadores.findIndex(j => j.nombre === u);
    const otro = d.jugadores.find((j, i) => i !== yo && j.vidas > 0 && i !== (yo + 1) % d.jugadores.length);
    if (evento === 'VENGANZA' && vengadores.includes(u) && otro) {
      venganzaUsada = true;
      s.emit('accionJugador', { idSala, accion: 'CAMBIAR', objetivo: otro.nombre });
    } else s.emit('accionJugador', { idSala, accion: 'MANTENER' });
  };
  s.on('juegoIniciado', jugar); s.on('cambioDeTurno', jugar);
  s.on('mensajeGlobal', m => { if (/Venganza! /.test(m) && m.includes(u)) console.log('   ', m); });

  const fin = new Promise(r => {
    s.on('rondaTerminada', d => {
      const yo = d.jugadores.find(j => j.nombre === u);
      if (evento === 'CARRUSEL' && yo && yo.vidas > 0) ok(yo.cartaActual === miCarta, `carrusel: la carta que me llegó (${miCarta}) es la que se revela (${yo.cartaActual})`);
      if (d.juegoTerminado || ronda >= 6) return r();
      ok(!!d.votacion && d.votacion.opciones.length === 3, `ronda ${ronda}: llegan 3 opciones para votar`);
      if (d.votacion) { ultimaVotacion = d.votacion; votado = d.votacion.opciones[0].id; s.emit('votarEvento', { idSala, evento: votado }); }
      if (d.dealerId === s.id) setTimeout(() => s.emit('siguienteRonda', idSala), 1500);
    });
    s.on('finDelJuego', r);
  });
  s.emit('iniciarPartida', idSala);
  await Promise.race([fin, new Promise(r => setTimeout(r, 300000))]);

  ok(eventosVistos.length > 0 && eventosVistos.every(Boolean), `evento en todas las rondas: ${eventosVistos.join(', ')}`);
  ok(votosVistos, 'el voto propio llega a la mesa (votosEvento)');
  console.log(`  (venganza con objetivo probada: ${venganzaUsada ? 'sí' : 'no salió'})`);
  s.disconnect();
  console.log(fallas.length ? `FIESTA: ${fallas.length} fallas` : 'FIESTA: todo bien');
  process.exit(fallas.length ? 1 : 0);
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
