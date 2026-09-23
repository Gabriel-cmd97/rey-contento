// db.js
const mysql = require('mysql2/promise');
require('dotenv').config(); // Carga las variables del archivo .env
const log = require('./logger');

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
        log.info('Conectado a AWS RDS MariaDB');
        connection.release();
    })
    .catch(err => {
        log.error('Fallo fatal conectando a RDS', { error: err.message, host: process.env.DB_HOST });
    });

module.exports = pool;
