// Logger minimal con timestamp ISO, nivel y contexto estructurado.
// Formato: "<ISO> <NIVEL> <msg> key=value key=value ..."
// Parseable por herramientas de log (PM2, CloudWatch, grep) y legible humano.
// Sin dependencias externas. Activar nivel DEBUG con DEBUG_LOG=1 en el .env.
function writeLog(level, msg, ctx) {
    const ts = new Date().toISOString();
    const ctxStr = ctx && Object.keys(ctx).length
        ? ' ' + Object.entries(ctx).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')
        : '';
    const out = `${ts} ${level} ${msg}${ctxStr}`;
    (level === 'ERROR' ? console.error : console.log)(out);
}

module.exports = {
    info:  (msg, ctx) => writeLog('INFO',  msg, ctx),
    warn:  (msg, ctx) => writeLog('WARN',  msg, ctx),
    error: (msg, ctx) => writeLog('ERROR', msg, ctx),
    debug: (msg, ctx) => process.env.DEBUG_LOG && writeLog('DEBUG', msg, ctx),
};
