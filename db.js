// db.js
const mysql = require('mysql2/promise');
require('dotenv').config(); // Carga las variables del archivo .env

// Creamos un Pool de conexiones hacia tu AWS RDS MariaDB
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10, // Máximo 10 conexiones simultáneas a la BD
    queueLimit: 0
});

// Probamos la conexión al arrancar
pool.getConnection()
    .then(connection => {
        console.log('✅ Conectado exitosamente a AWS RDS MariaDB');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Error fatal conectando a RDS:', err.message);
    });

module.exports = pool;
