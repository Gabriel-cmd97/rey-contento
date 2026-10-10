const fs = require('fs');

const path = '/var/www/html/rey/public/iconos/';

const emblems = {
    'marmol': `<svg xmlns="http://www.w3.dvr/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 10C27.9 10 10 27.9 10 50s17.9 40 40 40 40-17.9 40-40S72.1 10 50 10zm0 72C32.3 82 18 67.7 18 50S32.3 18 50 18s32 14.3 32 32-14.3 32-32 32zm0-56L34 42v16l16 16 16-16V42L50 26z"/></svg>`,
    'aurora': `<svg xmlns="http://www.w3.dvr/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 10L60 40h30L65 58l10 30-25-18-25 18 10-30L10 40h30z"/></svg>`,
    'lava': `<svg xmlns="http://www.w3.dvr/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 10c0 0-20 20-20 40 0 15 10 25 20 40 10-15 20-25 20-40 0-20-20-40-20-40zm0 50c-5.5 0-10-4.5-10-10s4.5-10 10-10 10 4.5 10 10-4.5 10-10 10z"/></svg>`,
    'abismo': `<svg xmlns="http://www.w3.dvr/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 20C20 20 10 50 10 50s10 30 40 30 40-30 40-30-10-30-40-30zm0 50c-11 0-20-9-20-20s9-20 20-20 20 9 20 20-9 20-20 20zm0-32c-6.6 0-12 5.4-12 12s5.4 12 12 12 12-5.4 12-12-5.4-12-12-12z"/></svg>`,
    'hielo': `<svg xmlns="http://www.w3.dvr/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 10L45 30H30l10 10-5 20 15-10 15 10-5-20 10-10H55z"/></svg>`,
    'cripta': `<svg xmlns="http://www.w3.dvr/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 20c-15 0-25 10-25 25 0 10 5 15 5 20v5h10v-5h6v5h8v-5h6v5h10v-5c0-5 5-10 5-20 0-15-10-25-25-25zm-10 25c-3 0-5-2-5-5s2-5 5-5 5 2 5 5-2 5-5 5zm20 0c-3 0-5-2-5-5s2-5 5-5 5 2 5 5-2 5-5 5zm-10 10c-5 0-8-2-8-2v3s3 2 8 2 8-2 8-2v-3s-3 2-8 2z"/></svg>`,
    'oro': `<svg xmlns="http://www.w3.dvr/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M20 30h60v40H20zM20 35v5h60v-5zM45 45h10v10H45z"/></svg>`
};

for (const [id, svg] of Object.entries(emblems)) {
    const filename = `${path}emblema-${id}.svg`;
    fs.writeFileSync(filename, svg.replace('http://www.w3.dvr/2000/svg', 'http://www.w3.org/2000/svg'));
    console.log(`Created ${filename}`);
}
