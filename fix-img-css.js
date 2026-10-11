const fs = require('fs');
let content = fs.readFileSync('public/style.css', 'utf8');

content = content.replace(/#figuraCarta img \{ width: var\(--carta-fig, 50px\); height: var\(--carta-fig, 50px\); \}/, 
`#figuraCarta img { width: var(--carta-fig, 50px); height: var(--carta-fig, 50px); border-radius: 6px; box-shadow: 0 0 6px rgba(0,0,0,0.5); object-fit: cover; }`);

content = content.replace(/\.carta-en-pila \.pila-fig \{ width: 62%; height: auto; \}/,
`.carta-en-pila .pila-fig { width: 62%; height: 62%; border-radius: 4px; object-fit: cover; box-shadow: 0 0 4px rgba(0,0,0,0.5); }`);

content += `\n/* Estilos para las nuevas mini-cartas con imágenes JPG */\n.mini-carta-frente img, .resumen-carta-cara img, .carta-oraculo img, .carta-duelo img { border-radius: 3px; object-fit: cover; box-shadow: 0 0 4px rgba(0,0,0,0.5); }\n`;

fs.writeFileSync('public/style.css', content);
