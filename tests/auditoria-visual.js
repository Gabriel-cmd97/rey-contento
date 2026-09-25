// Auditoría visual: juega partidas reales en un navegador sin pantalla y,
// cada 150 ms, busca elementos de la mesa encimados, textos cortados y flujos
// fuera de orden (reloj corriendo con la carta de evento o el versus, dos
// banners a la vez, resumen con reloj). No es parte de tests/run.sh.
//
// Requiere puppeteer y chrome-headless-shell con sus librerías (ver el
// historial del 24/09/2026 en CLAUDE.md). Uso:
//   CHROME=<ruta a chrome-headless-shell> LD_LIBRARY_PATH=<libs> TAM=360x740 \
//   node tests/auditoria-visual.js            # SOLO=6 | 33 | F | 3 para un escenario
// Encimados esperados: miCarta × miPerfil, aviso × pila, marcador × reloj/turno
// (el marcador vive dentro del cuadro del reloj).
const puppeteer = require('puppeteer');
const S = process.env.S, URL = 'http://localhost:4000';
const post = (r, b) => fetch(URL + r, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(x => x.json());
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Se inyecta: toma una muestra de la pantalla.
function muestra() {
  const vis = el => { if (!el) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05 || el.closest('.hidden')) return null;
    const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? r : null; };
  const piezas = [];
  const add = (nombre, el) => { const r = vis(el); if (r) piezas.push({ nombre, r: { l: r.left, t: r.top, r: r.right, b: r.bottom } }); };
  document.querySelectorAll('.silla:not(.hidden)').forEach(s => {
    const n = s.querySelector('.perfil-oponente')?.innerText.split('\n')[0].slice(-8) || s.id;
    add('asiento:' + n, s.querySelector('.perfil-oponente'));
    add('carta:' + n, s.querySelector('.perfil-carta-reverso, .mini-carta-frente'));
  });
  add('miPerfil', document.getElementById('miPerfil')); add('miCarta', document.getElementById('miCarta'));
  add('reloj/turno', document.getElementById('focoTurno')); add('mazo', document.getElementById('mazoFlotante'));
  add('pila', document.getElementById('pilaCentro')); add('marcador', document.getElementById('marcadorEquipos'));
  add('chipEvento', document.getElementById('chipEvento')); add('bannerEquipo', document.getElementById('bannerEquipo'));
  add('bannerObjetivo', document.getElementById('bannerObjetivo'));
  add('btnMenu', document.getElementById('btnMenuMesa')); add('btnBitacora', document.getElementById('btnBitacoraMesa'));
  add('aviso', document.querySelector('#toastContainer .toast-mensaje'));
  const pie = vis(document.getElementById('panelAccionesPartida'));
  const ov = [];
  for (let i = 0; i < piezas.length; i++) for (let j = i + 1; j < piezas.length; j++) {
    const a = piezas[i].r, b = piezas[j].r;
    const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    // Asiento y su propia carta van juntos a propósito.
    const mismoAsiento = piezas[i].nombre.split(':')[1] && piezas[i].nombre.split(':')[1] === piezas[j].nombre.split(':')[1];
    const par = [piezas[i].nombre, piezas[j].nombre].sort().join(' × ');
    const permitido = mismoAsiento || par === 'miCarta × miPerfil' || par === 'aviso × pila' || par === 'marcador × reloj/turno';
    if (w > 4 && h > 4 && !permitido) ov.push(par.replace(/:[^ ×]+/g, ''));
  }
  // Tapado por el panel de abajo
  if (pie) piezas.forEach(p => { if (p.r.b - pie.top > 6 && !['aviso'].includes(p.nombre)) ov.push(`${p.nombre.replace(/:.*/, '')} × panel de abajo`); });
  // Textos cortados
  const cortados = [];
  document.querySelectorAll('#tapeteVistas *, #panelAccionesPartida *, #toastContainer *').forEach(el => {
    if (!vis(el) || !el.childNodes.length || ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
    const cs = getComputedStyle(el);
    if ((cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') && el.scrollWidth > el.clientWidth + 1)
      cortados.push(`${el.id || el.className || el.tagName}: "${el.textContent.trim().slice(0, 30)}"`);
  });
  const estado = {
    relojCorre: !!vis(document.getElementById('contenedorReloj')),
    cartaEvento: !!vis(document.getElementById('cartaEvento')) && !document.getElementById('cartaEvento').classList.contains('saliendo'),
    duelo: !!vis(document.getElementById('presentacionDuelo')),
    resumen: !!vis(document.getElementById('panelResumenRonda')),
    banners: ['bannerEquipo', 'bannerObjetivo'].filter(id => vis(document.getElementById(id))),
  };
  return { ov, cortados, estado };
}

async function escenario(browser, nombre, config, w, h, duracionMs) {
  const u = 't_au' + Date.now().toString(36).slice(-5) + '_a';
  await post('/registro', { username: u, password: 'pass1234' });
  const { token } = await post('/login', { username: u, password: 'pass1234' });
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true });
  const errores = []; page.on('pageerror', e => errores.push(e.message));
  await page.evaluateOnNewDocument((t, n) => { localStorage.setItem('reyToken', t); localStorage.setItem('reyUsername', n); localStorage.setItem('reyGuias', 'on'); }, token, u);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#btnCrearSala:not([disabled])', { visible: true });
  await page.evaluate(() => { window._ev = []; const t0 = performance.now();
    ['datosMesa', 'juegoIniciado', 'cambioDeTurno', 'rondaTerminada', 'nuevaRondaIniciada'].forEach(ev => socket.on(ev, () => window._ev.push([ev, performance.now() - t0]))); });
  await page.evaluate(c => { socket.emit('crearSala', { configuracion: c }); }, config);
  await page.waitForSelector('#btnEmpezar', { visible: true }); await page.click('#btnEmpezar');
  const overlaps = new Map(), cortes = new Map(), flujos = new Map();
  const nota = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  const fin = Date.now() + duracionMs; let anterior = null, resumenDesde = null;
  while (Date.now() < fin) {
    if (await page.$('#pantallaVictoria:not(.hidden)')) break;
    const m = await page.evaluate(muestra);
    m.ov.forEach(x => nota(overlaps, x)); m.cortados.forEach(x => nota(cortes, x));
    const e = m.estado;
    if (e.relojCorre && e.cartaEvento) nota(flujos, 'reloj de turno corriendo con la carta de evento a la vista');
    if (e.relojCorre && e.duelo) nota(flujos, 'reloj de turno corriendo durante el versus del duelo');
    if (e.resumen && e.relojCorre) nota(flujos, 'reloj de turno visible con el resumen abierto');
    if (e.banners.length > 1) nota(flujos, 'dos banners a la vez: ' + e.banners.join(' + '));
    if (e.cartaEvento && e.duelo) nota(flujos, 'carta de evento encima del versus');
    // jugar: mantener en mi turno, siguiente ronda si soy dealer
    await page.keyboard.press('m').catch(() => {});
    const b = await page.$('#btnSiguienteRondaResumen:not(.hidden)'); if (b && Math.random() < 0.2) await b.evaluate(x => x.click()).catch(() => {});
    await esperar(150);
  }
  // Resumen antes de que termine la revelación: se revisa con la línea de tiempo del cliente
  const orden = await page.evaluate(() => window._ev);
  for (let i = 0; i < orden.length - 1; i++) {
    if (orden[i][0] === 'datosMesa' && ['cambioDeTurno'].includes(orden[i + 1][0])) nota(flujos, 'cambioDeTurno antes de juegoIniciado tras repartir');
  }
  console.log(`\n=== ${nombre} (${w}×${h}) — ${orden.filter(x => x[0] === 'rondaTerminada').length} rondas`);
  console.log('  encimados:', overlaps.size ? [...overlaps].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join('\n             ') : 'ninguno');
  console.log('  textos cortados:', cortes.size ? [...cortes].map(([k, n]) => `${k} ×${n}`).join('\n                   ') : 'ninguno');
  console.log('  flujos fuera de orden:', flujos.size ? [...flujos].map(([k, n]) => `${k} ×${n}`).join('\n                         ') : 'ninguno');
  console.log('  errores JS:', errores.length ? errores : 'ninguno');
  await page.evaluate(() => { try { socket.emit('abandonarSala', miSalaActual); } catch {} });
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
  const [w, h] = (process.env.TAM || '390x844').split('x').map(Number);
  if (!process.env.SOLO || process.env.SOLO === '6') await escenario(browser, '6 jugadores, eventos y poderes', { vidas: 3, maxJugadores: 6, numBots: 5, eventos: true, poderes: true, frecuenciaReyes: 'LOCURA', modoRey: 'DECLARADO' }, w, h, 110000);
  if (!process.env.SOLO || process.env.SOLO === '33') await escenario(browser, '3 contra 3', { vidas: 3, equipos: 3, eventos: true }, w, h, 90000);
  if (!process.env.SOLO || process.env.SOLO === 'F') await escenario(browser, 'Fiesta 5 jugadores', { vidas: 3, maxJugadores: 5, modoJuego: 'FIESTA' }, w, h, 110000);
  if (!process.env.SOLO || process.env.SOLO === '3') await escenario(browser, 'mesa de 3 (duelo)', { vidas: 2, maxJugadores: 3, numBots: 2, eventos: false }, w, h, 90000);
  await browser.close(); process.exit(0);
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
