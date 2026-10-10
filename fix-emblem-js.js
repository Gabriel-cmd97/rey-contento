const fs = require('fs');
let content = fs.readFileSync('public/main.js', 'utf8');

// The original logic is:
// if (emb) emb.classList.add(`emb-${eventoActual.id}`);
// else if (miLook?.tapete && miLook.tapete !== 'verde') ...

content = content.replace(/const emb = document.getElementById\('tapeteEmblemaFondo'\);/g, `const emb = document.getElementById('tapeteEmblemaFondo');
    const embImg = emb ? emb.querySelector('.tapete-emblema-img') : null;`);

content = content.replace(/if \(emb\) emb.classList.add\(\`emb-\$\{eventoActual.id\}\`\);/g, `if (emb) { emb.classList.add(\`emb-\${eventoActual.id}\`); if (embImg) embImg.src = \`/iconos/emblema-\${eventoActual.id}.svg\`; }`);

content = content.replace(/if \(emb\) emb.classList.add\(\`emb-\$\{miLook.tapete\}\`\);/g, `if (emb) { emb.classList.add(\`emb-\${miLook.tapete}\`); if (embImg) { const iconName = ['azul','rojo','morado','madera','oro','marmol','aurora','lava','abismo','hielo','cripta'].includes(miLook.tapete) ? miLook.tapete : 'mesa'; embImg.src = \`/iconos/emblema-\${iconName}.svg\`; } }`);

// Make sure to reset to default 'mesa' if it's 'verde' or not handled
content = content.replace(/\[\.\.\.emb.classList\].filter\(c => c.startsWith\('emb-'\)\).forEach\(c => emb.classList.remove\(c\)\);/g, `[...emb.classList].filter(c => c.startsWith('emb-')).forEach(c => emb.classList.remove(c));
        if (embImg) embImg.src = '/iconos/emblema-mesa.svg';`);

fs.writeFileSync('public/main.js', content);
