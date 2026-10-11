const pool = require('./db');
async function run() {
    try {
        const [r] = await pool.execute('UPDATE usuarios SET letios = 100 WHERE letios = 0');
        console.log(`Updated ${r.affectedRows} users to have 100 Letios.`);
    } catch(e) {
        console.error(e);
    }
    process.exit();
}
run();
