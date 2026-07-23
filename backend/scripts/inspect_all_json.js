const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../../data');
const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));

files.forEach(file => {
    try {
        const filePath = path.join(dataDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        console.log(`FILE: ${file}`);
        if (Array.isArray(data)) {
            console.log(`  Type: Array, Count: ${data.length}`);
            if (data.length > 0) console.log(`  Sample Keys: ${Object.keys(data[0])}`);
        } else {
            console.log(`  Type: Object, Keys: ${Object.keys(data)}`);
            Object.keys(data).forEach(k => {
                if (Array.isArray(data[k])) {
                    console.log(`    Key [${k}] Count: ${data[k].length}`);
                }
            });
        }
    } catch (e) {
        console.error(`Error reading ${file}: ${e.message}`);
    }
});
