const fs = require('fs');

const path = '/var/www/html/rey/public/iconos/';

const emblems = {
    'azul': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 10c-22.1 0-40 17.9-40 40s17.9 40 40 40c17.5 0 32.3-11.2 37.8-26.7-4.1 1.7-8.6 2.7-13.3 2.7-18.2 0-33-14.8-33-33 0-8.6 3.3-16.4 8.7-22.3C47 10.3 43.6 10 40 10z"/><circle fill="#fff" cx="75" cy="30" r="3"/><circle fill="#fff" cx="85" cy="45" r="2"/><circle fill="#fff" cx="65" cy="15" r="1.5"/></svg>`,
    'rojo': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M50 15C35 15 20 25 20 45c0 15 25 35 30 40 5-5 30-25 30-40 0-20-15-30-30-30z"/></svg>`,
    'morado': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M10 80h80v10H10zM15 70l5-40 15 20 15-30 15 30 15-20 5 40H15z"/></svg>`,
    'madera': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M30 10l-10 10v60l10 10h40l10-10V20L70 10H30zm0 10h40v60H30V20z"/><path fill="#fff" d="M40 30h20v40H40z"/></svg>`,
    'oro': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><path fill="#fff" d="M20 40h60v40H20zM20 45v5h60v-5zM45 55h10v10H45zM20 30c0-10 15-10 30-10s30 0 30 10v10H20V30z"/></svg>`
};

for (const [id, svg] of Object.entries(emblems)) {
    const filename = `${path}emblema-${id}.svg`;
    fs.writeFileSync(filename, svg);
    console.log(`Created ${filename}`);
}
