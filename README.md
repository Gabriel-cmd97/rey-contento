# Rey Contento

Juego de cartas multijugador en tiempo real (Express + Socket.io + MySQL).

```bash
yarn install
bash start.sh          # PORT=4000 yarn node server.js
tests/run.sh           # pruebas e2e (con el server corriendo) y limpieza de usuarios de prueba
node --test tests/*.test.js   # pruebas de los bots (Node 18+)
```

La guía completa (arquitectura, reglas, convenciones) está en `CLAUDE.md`.
Cómo revivirlo desde el respaldo: `RESTAURAR.md`.
