# Cómo revivir `rey` (Rey Contento)

Última revisión: 11/09/2026. Apagado el 10/09/2026 (estaba en ciclo de reinicio).
Archivado el 11/09/2026 en `/var/backups/archivo/rey-20260911.zip`.

## Qué es

Juego/servidor Node (Express) que vivía en `/var/www/html/rey`, puerto **4000**,
levantado por PM2 con el nombre `rey-contento` mediante `start.sh`
(`PORT=4000 yarn node server.js`). Gestor de paquetes: **yarn** (`yarn.lock`).

## Lo que el zip sí trae

- Todo el código, `public/`, `tests/`, `package.json`, `yarn.lock`.
- **El repositorio `.git` completo** — importante: `rey` **no tiene remoto
  configurado**, su historia solo existe en este zip. Último commit archivado:
  `c5b9dd0 chore: incluir archivos de proyecto y documentar convenciones de hardening`.
- **El archivo `.env`** (está en `.gitignore`, no se recupera de ningún otro lado).

Lo único que se excluyó es `node_modules/`, que se reinstala con `yarn install`.

## Base de datos

**No vive en este servidor**: es MySQL en RDS de AWS
(`dbcurso-cluster.cluster-ctv5zzt4khoa.us-east-1.rds.amazonaws.com`,
base `rey_contento_db`, usuario `ddpcv`). Nada que respaldar aquí, pero tampoco
nada que restaurar: si ese clúster de RDS se apaga o se borra, los datos se
pierden por fuera de este zip. Las credenciales están en el `.env` del zip.

## Pasos para revivir

```bash
cd /var/backups/archivo
unzip rey-20260911.zip -d /var/www/html/     # deja /var/www/html/rey
cd /var/www/html/rey
yarn install
pm2 start start.sh --name rey-contento
pm2 save
curl -I http://localhost:4000/
```

No tenía vhost propio de Apache: se servía por el puerto 4000 directo.
Antes de darlo por bueno, `pm2 logs rey-contento` — se caía en bucle y esa causa
nunca se diagnosticó.
