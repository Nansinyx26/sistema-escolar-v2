const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../data/escola_database.json');
try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);

    const search = (obj, keyPath = '') => {
        if (typeof obj === 'string') {
            if (obj.includes('Artes') || obj.includes('Inglês') || obj.includes('Especial')) {
                console.log(`Found in [${keyPath}]: ${obj.substring(0, 100)}`);
            }
        } else if (Array.isArray(obj)) {
            obj.forEach((item, i) => search(item, `${keyPath}[${i}]`));
        } else if (obj && typeof obj === 'object') {
            Object.keys(obj).forEach(key => search(obj[key], `${keyPath}.${key}`));
        }
    };

    search(data);
    console.log('Search complete.');
} catch (e) {
    console.error(e.message);
}
