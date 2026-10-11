const fs = require('fs');
let content = fs.readFileSync('public/style.css', 'utf8');

content = content.replace(/object-fit: cover;/g, 'object-fit: cover; mix-blend-mode: multiply;');

fs.writeFileSync('public/style.css', content);
