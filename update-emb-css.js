const fs = require('fs');
let content = fs.readFileSync('public/style.css', 'utf8');

const newEmbClasses = `
.emb-hielo .tapete-emblema-img { filter: hue-rotate(185deg) brightness(1.2) drop-shadow(0 0 20px rgba(125,211,252,0.8)) !important; }
.emb-cripta .tapete-emblema-img { filter: hue-rotate(100deg) brightness(1.1) drop-shadow(0 0 20px rgba(16,185,129,0.7)) !important; }
.emb-abismo .tapete-emblema-img { filter: hue-rotate(270deg) grayscale(0.5) brightness(0.7) drop-shadow(0 0 25px rgba(88,28,135,1)) !important; }
`;

content = content.replace(
    /\.emb-oro \.tapete-emblema-img \{ filter: drop-shadow\(0 0 26px rgba\(255,215,0,0\.85\)\) brightness\(1\.15\) !important; \}/,
    `.emb-oro .tapete-emblema-img { filter: drop-shadow(0 0 26px rgba(255,215,0,0.85)) brightness(1.15) !important; }${newEmbClasses}`
);

fs.writeFileSync('public/style.css', content);
