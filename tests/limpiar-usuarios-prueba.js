// Borra de la base los usuarios que crean las pruebas (t_<sufijo>_a / _b).
// Las pruebas pegan a la base de producción (RDS), así que esto se corre
// siempre al terminar: lo hace tests/run.sh.
//
//   yarn node tests/limpiar-usuarios-prueba.js           # borra
//   yarn node tests/limpiar-usuarios-prueba.js --ver     # solo lista
//
// Solo toca nombres con el patrón exacto de las pruebas (t_<letras y números>_<letra>).
// También borra rastros huérfanos (historial, logros, decisiones) de pruebas
// cuyos usuarios ya no existen, y a los de prueba que ganaron alguna partida
// (antes se saltaban y se quedaban en el ranking y el panel).
const pool = require('../db');

const PATRON = /^t_[a-z0-9]+_[a-z]+$/;

(async () => {
    const soloVer = process.argv.includes('--ver');
    try {
        const [candidatos] = await pool.query("SELECT username FROM usuarios WHERE username LIKE 't\\_%'");
        const nombres = candidatos.map(f => f.username).filter(n => PATRON.test(n));
        const huerfanos = new Set();
        for (const tabla of ['historial', 'logros', 'decisiones']) {
            const [f] = await pool.query(`SELECT DISTINCT username FROM ${tabla} WHERE username LIKE 't\\_%'`).catch(() => [[]]);
            f.map(x => x.username).filter(n => PATRON.test(n)).forEach(n => huerfanos.add(n));
        }
        const todos = [...new Set([...nombres, ...huerfanos])];
        console.log(`Usuarios de prueba encontrados: ${nombres.length} (con rastros en estadísticas: ${todos.length})`);
        if (!soloVer && todos.length) {
            if (nombres.length) {
                const [r] = await pool.query('DELETE FROM usuarios WHERE username IN (?)', [nombres]);
                console.log(`Borrados: ${r.affectedRows}`);
            }
            for (const tabla of ['historial', 'logros', 'decisiones']) {
                await pool.query(`DELETE FROM ${tabla} WHERE username IN (?)`, [todos]).catch(() => {});
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
