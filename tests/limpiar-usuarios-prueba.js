// Borra de la base los usuarios que crean las pruebas (t_<sufijo>_a / _b).
// Las pruebas pegan a la base de producción (RDS), así que esto se corre
// siempre al terminar: lo hace tests/run.sh.
//
//   yarn node tests/limpiar-usuarios-prueba.js           # borra
//   yarn node tests/limpiar-usuarios-prueba.js --ver     # solo lista
//
// Solo toca nombres con el patrón exacto de las pruebas y sin victorias,
// para no borrar por accidente a un jugador real que se llame parecido.
const pool = require('../db');

const PATRON = /^t_[a-z0-9]+_[a-z]+$/;

(async () => {
    const soloVer = process.argv.includes('--ver');
    try {
        const [candidatos] = await pool.query(
            "SELECT username FROM usuarios WHERE username LIKE 't\\_%' AND victorias = 0");
        const nombres = candidatos.map(f => f.username).filter(n => PATRON.test(n));
        console.log(`Usuarios de prueba encontrados: ${nombres.length}`);
        if (!soloVer && nombres.length) {
            const [r] = await pool.query(
                'DELETE FROM usuarios WHERE victorias = 0 AND username IN (?)', [nombres]);
            console.log(`Borrados: ${r.affectedRows}`);
            // Sus partidas y logros también (tablas historial y logros).
            for (const tabla of ['historial', 'logros', 'decisiones']) {
                await pool.query(`DELETE FROM ${tabla} WHERE username IN (?)`, [nombres]).catch(() => {});
            }
        }
    } catch (e) {
        console.error('Error limpiando usuarios de prueba:', e.message);
        process.exitCode = 1;
    } finally {
        await new Promise(r => setTimeout(r, 100)); // deja terminar el chequeo de arranque de db.js
        await pool.end();
    }
})();
