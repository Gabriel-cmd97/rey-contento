const fs = require('fs');
let content = fs.readFileSync('public/main.js', 'utf8');

const regex = /const figurasCartas = \{\s*0: "\/iconos\/0\.svg", 1: "\/iconos\/1\.svg", 2: "\/iconos\/2\.svg", 3: "\/iconos\/3\.svg",\s*4: "\/iconos\/4\.svg", 5: "\/iconos\/5\.svg", 6: "\/iconos\/6\.svg", 7: "\/iconos\/7\.svg",\s*8: "\/iconos\/8\.svg", 9: "\/iconos\/9\.svg"\s*\};/g;

const newFiguras = `const figurasCartas = {
    0: "/iconos/char_0.jpg", 1: "/iconos/char_1.jpg", 2: "/iconos/char_2.jpg", 3: "/iconos/char_3.jpg",
    4: "/iconos/char_4.jpg", 5: "/iconos/char_5.jpg", 6: "/iconos/char_6.jpg", 7: "/iconos/char_7.jpg",
    8: "/iconos/char_8.jpg", 9: "/iconos/char_9.jpg"
};`;

content = content.replace(regex, newFiguras);
fs.writeFileSync('public/main.js', content);
