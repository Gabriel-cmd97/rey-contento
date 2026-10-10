const fs = require('fs');
let content = fs.readFileSync('public/style.css', 'utf8');

// Replace the keyframes blocks with cooler ones
const oldAzul = `.tapete-virtual.tapete-azul { animation: marea-azul 9s ease-in-out infinite alternate !important; }
@keyframes marea-azul {
    0% { background: radial-gradient(ellipse at 50% 30%, #3a78b8 0%, #1f4e79 45%, #0e2742 100%) !important; }
    50% { background: radial-gradient(ellipse at 47% 35%, #4688cf 0%, #235887 48%, #112d4d 100%) !important; }
    100% { background: radial-gradient(ellipse at 53% 26%, #336ea8 0%, #1a446a 45%, #0b2036 100%) !important; }
}`;
const newAzul = `.tapete-virtual.tapete-azul { 
    background-image: 
        radial-gradient(circle at 20% 30%, rgba(255,255,255,0.8) 1px, transparent 1px),
        radial-gradient(circle at 70% 60%, rgba(255,255,255,0.8) 1px, transparent 1px),
        radial-gradient(circle at 40% 80%, rgba(255,255,255,0.6) 1.5px, transparent 1.5px),
        radial-gradient(ellipse at 50% 30%, #29598a 0%, #11365c 55%, #041221 100%) !important;
    background-size: 150px 150px, 200px 200px, 100px 100px, 100% 100% !important;
    animation: marea-azul-cielo 15s linear infinite !important;
}
@keyframes marea-azul-cielo {
    0% { background-position: 0px 0px, 0px 0px, 0px 0px, 0% 0%; }
    100% { background-position: 150px 150px, 200px 200px, -100px 100px, 0% 0%; }
}`;
content = content.replace(oldAzul, newAzul);

const oldRojo = `.tapete-virtual.tapete-rojo { animation: pulso-rojo 7s ease-in-out infinite alternate !important; }
@keyframes pulso-rojo {
    0% { background: radial-gradient(ellipse at 50% 30%, #c0392b 0%, #8b1a1a 45%, #4a0b0b 100%) !important; }
    50% { background: radial-gradient(ellipse at 52% 34%, #d94435 0%, #9e1d1d 48%, #570d0d 100%) !important; }
    100% { background: radial-gradient(ellipse at 48% 27%, #b33225 0%, #7d1515 45%, #3d0808 100%) !important; }
}`;
const newRojo = `.tapete-virtual.tapete-rojo {
    background: 
        repeating-linear-gradient(45deg, rgba(0,0,0,0.05) 0, rgba(0,0,0,0.05) 2px, transparent 2px, transparent 6px),
        repeating-linear-gradient(-45deg, rgba(0,0,0,0.05) 0, rgba(0,0,0,0.05) 2px, transparent 2px, transparent 6px),
        radial-gradient(ellipse at 50% 30%, #e74c3c 0%, #b32113 50%, #630c04 100%) !important;
    background-size: 16px 16px, 16px 16px, 100% 100% !important;
}`;
content = content.replace(oldRojo, newRojo);

const oldMorado = `.tapete-virtual.tapete-morado { animation: velo-morado 8s ease-in-out infinite alternate !important; }
@keyframes velo-morado {
    0% { background: radial-gradient(ellipse at 50% 30%, #8e5bb5 0%, #5b2c83 45%, #2c1242 100%) !important; }
    50% { background: radial-gradient(ellipse at 48% 36%, #9d67c7 0%, #693396 48%, #361752 100%) !important; }
    100% { background: radial-gradient(ellipse at 52% 25%, #804fa6 0%, #502573 45%, #230d35 100%) !important; }
}`;
const newMorado = `.tapete-virtual.tapete-morado {
    background: 
        radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0.05) 0%, transparent 60%),
        radial-gradient(ellipse at 50% 30%, #8e44ad 0%, #5b2c83 45%, #2c1242 100%) !important;
    background-size: 8px 8px, 100% 100% !important;
    animation: pulso-terciopelo 4s infinite alternate ease-in-out !important;
}
@keyframes pulso-terciopelo {
    100% { background-position: 4px 4px, 0% 0%; filter: brightness(1.1); }
}`;
content = content.replace(oldMorado, newMorado);

const oldOro = `.tapete-virtual.tapete-oro { animation: brillo-oro-tapete 8s ease-in-out infinite alternate !important; }
@keyframes brillo-oro-tapete {
    0% { background: radial-gradient(ellipse at 50% 30%, #f7dc6f 0%, #d4ac0d 45%, #7d6608 100%) !important; }
    50% { background: radial-gradient(ellipse at 53% 36%, #fff176 0%, #e1b714 48%, #8c7309 100%) !important; }
    100% { background: radial-gradient(ellipse at 47% 26%, #f5d75d 0%, #c7a10a 45%, #6e5906 100%) !important; }
}`;
const newOro = `.tapete-virtual.tapete-oro { 
    background: 
        linear-gradient(45deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 60%),
        radial-gradient(ellipse at 50% 30%, #f1c40f 0%, #d4ac0d 40%, #7d6608 100%) !important;
    background-size: 200% 200%, 100% 100% !important;
    animation: destello-oro 6s infinite linear !important;
}
@keyframes destello-oro {
    0% { background-position: 200% 0, 0 0; }
    100% { background-position: -200% 0, 0 0; }
}`;
content = content.replace(oldOro, newOro);

const oldMadera = `.tapete-virtual.tapete-madera { background: repeating-linear-gradient(90deg, rgba(0,0,0,.08) 0 3px, transparent 3px 22px),
                                    repeating-linear-gradient(0deg, rgba(0,0,0,.04) 0 2px, transparent 2px 14px),
                                    linear-gradient(135deg, #5c3a21 0%, #3e2723 50%, #2e1a12 100%) !important; }`;
const newMadera = `.tapete-virtual.tapete-madera { 
    background: 
        repeating-linear-gradient(90deg, rgba(0,0,0,0.15) 0 2px, transparent 2px 30px),
        repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0 1px, transparent 1px 15px),
        radial-gradient(ellipse at 50% 30%, #6e4629 0%, #4a2e1b 50%, #2e1a12 100%) !important; 
    box-shadow: inset 0 0 60px rgba(0,0,0,0.8);
}`;
content = content.replace(oldMadera, newMadera);

// Now we add the dorso madera
content += `\n/* Dorso Madera */\n.dorso-madera { background: repeating-linear-gradient(90deg, rgba(0,0,0,0.15) 0 2px, transparent 2px 12px), radial-gradient(circle at 50% 50%, #6e4629 0%, #3e2723 100%) !important; border-color: #2e1a12 !important; }`;

fs.writeFileSync('public/style.css', content);
