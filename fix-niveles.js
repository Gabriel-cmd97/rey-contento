const fs = require('fs');
let content = fs.readFileSync('public/main.js', 'utf8');

const lockLogic = `
        _tienda.nivel = data.nivel?.nivel || 1;
        
        // Bloquear modos de juego por nivel
        const selectModo = document.getElementById('selectModoJuego');
        if (selectModo) {
            const modos = {
                'CLASICO': 1,
                'JEFE': 2,
                'FIESTA': 3,
                'GUERRA_ARCANA': 4,
                'CONSPIRACION': 5
            };
            Array.from(selectModo.options).forEach(opt => {
                const req = modos[opt.value] || 1;
                if (_tienda.nivel < req) {
                    opt.disabled = true;
                    opt.textContent = opt.textContent.replace(/\\s\\(Nivel \\d+\\)$/, '') + \` (Nivel \${req})\`;
                } else {
                    opt.disabled = false;
                    opt.textContent = opt.textContent.replace(/\\s\\(Nivel \\d+\\)$/, '');
                }
            });
            // If current selected is disabled, fallback to CLASICO
            if (selectModo.options[selectModo.selectedIndex]?.disabled) {
                selectModo.value = 'CLASICO';
                if (typeof actualizarResumenConfig === 'function') actualizarResumenConfig();
            }
        }`;

content = content.replace(/_tienda\.nivel = data\.nivel\?\.nivel \|\| 1;/g, lockLogic);

fs.writeFileSync('public/main.js', content);
