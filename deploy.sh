#!/usr/bin/env bash
# Despliega el juego Rey Contento (servidor Node: Express + Socket.io, puerto 4000).
# A diferencia de un sitio estático, esto es un PROCESO en vivo gestionado por pm2,
# así que "deploy" = instalar dependencias + reiniciar el proceso.
#
# Uso:
#   bash deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")"

# --- Verificar herramientas (yarn 4 PnP + pm2, provistas por mise) ---
if ! command -v yarn >/dev/null 2>&1; then
  echo "❌ 'yarn' no está en el PATH. Abrí una terminal de login o activá mise."
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then
  echo "❌ 'pm2' no está en el PATH. Abrí una terminal de login o activá mise."
  exit 1
fi

echo "▶ yarn: $(yarn -v) | pm2: $(pm2 -v)"
echo "▶ Carpeta: $(pwd)"
echo

echo "▶ Instalando dependencias..."
yarn install

echo
echo "▶ Reiniciando el proceso en pm2 (rey-contento)..."
# Si el proceso existe lo reinicia; si no, lo crea con la misma config (start.sh vía bash).
if pm2 describe rey-contento >/dev/null 2>&1; then
  pm2 restart rey-contento --update-env
else
  pm2 start start.sh --name rey-contento --interpreter bash
fi
pm2 save >/dev/null 2>&1 || true

echo
echo "▶ Estado:"
pm2 describe rey-contento 2>/dev/null | grep -iE "status|restarts|exec cwd" || true

# --- Health check: esperar a que el puerto responda ---
echo
echo -n "▶ Verificando http://localhost:4000/ ... "
ok=""
for i in $(seq 1 10); do
  if curl -sf -o /dev/null -m 3 http://localhost:4000/; then ok="1"; break; fi
  sleep 1
done
if [ -n "$ok" ]; then
  echo "OK ✅"
  echo
  echo "✅ Rey Contento desplegado y respondiendo en el puerto 4000."
else
  echo "SIN RESPUESTA ⚠️"
  echo
  echo "⚠️  El proceso no respondió. Revisá los logs con:"
  echo "     pm2 logs rey-contento --lines 40"
  exit 1
fi
