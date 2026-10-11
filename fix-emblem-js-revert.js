const fs = require('fs');
let content = fs.readFileSync('public/main.js', 'utf8');

// Replace the block inside aplicarTapete with the original simple logic.
// Original logic:
// if (emb) { [...emb.classList]... }
// if (eventoActual) { t.classList.add...; if (emb) emb.classList.add(...) }
// else if (miLook) { t.classList.add...; if (emb) emb.classList.add(...) }

content = content.replace(/const emb = document\.getElementById\('tapeteEmblemaFondo'\);\s*const embImg = emb \? emb\.querySelector\('\.tapete-emblema-img'\) : null;\s*if \(emb\) \{\s*\[\.\.\.emb\.classList\]\.filter\(c => c\.startsWith\('emb-'\)\)\.forEach\(c => emb\.classList\.remove\(c\)\);\s*if \(embImg\) embImg\.src = '\/iconos\/emblema-mesa\.svg';\s*\}\s*if \(eventoActual\) \{\s*t\.classList\.add\(\`tema-\$\{eventoActual\.id\}\`\);\s*if \(emb\) \{ emb\.classList\.add\(\`emb-\$\{eventoActual\.id\}\`\); if \(embImg\) embImg\.src = \`\/iconos\/emblema-\$\{eventoActual\.id\}\.svg\`; \}\s*\} else if \(miLook\?\.tapete && miLook\.tapete !== 'verde'\) \{\s*t\.classList\.add\(\`tapete-\$\{miLook\.tapete\}\`\);\s*if \(emb\) \{ emb\.classList\.add\(\`emb-\$\{miLook\.tapete\}\`\); if \(embImg\) \{ const iconName = \['azul','rojo','morado','madera','oro','marmol','aurora','lava','abismo','hielo','cripta'\]\.includes\(miLook\.tapete\) \? miLook\.tapete : 'mesa'; embImg\.src = \`\/iconos\/emblema-\$\{iconName\}\.svg\`; \} \}\s*\}/, 
`const emb = document.getElementById('tapeteEmblemaFondo');
    if (emb) {
        [...emb.classList].filter(c => c.startsWith('emb-')).forEach(c => emb.classList.remove(c));
    }
    if (eventoActual) {
        t.classList.add(\`tema-\${eventoActual.id}\`);
        if (emb) emb.classList.add(\`emb-\${eventoActual.id}\`);
    } else if (miLook?.tapete && miLook.tapete !== 'verde') {
        t.classList.add(\`tapete-\${miLook.tapete}\`);
        if (emb) emb.classList.add(\`emb-\${miLook.tapete}\`);
    }`);

fs.writeFileSync('public/main.js', content);
