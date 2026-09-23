#!/usr/bin/env bash
# Corre las pruebas e2e contra el server en :4000 y SIEMPRE borra después
# los usuarios de prueba que crearon (pasen o fallen).
cd "$(dirname "$0")/.."
NODE_PATH=/tmp/rey-tests/node_modules node tests/e2e.js
codigo=$?
yarn node tests/limpiar-usuarios-prueba.js 2>&1 | grep -v -e dotenv -e INFO
exit $codigo
