const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const modelsDir = path.join(__dirname, '../src/models');
fs.readdirSync(modelsDir).forEach(file => {
    if (file.endsWith('.js')) {
        try {
            require(path.join(modelsDir, file));
        } catch (err) {
            console.error(`Erro ao carregar model ${file}:`, err.message);
        }
    }
});

const mapped = [];
Object.keys(mongoose.models).forEach(modelName => {
    mapped.push({
        model: modelName,
        collection: mongoose.models[modelName].collection.name
    });
});

fs.writeFileSync(path.join(__dirname, 'collections.json'), JSON.stringify(mapped, null, 2), 'utf8');
console.log('Wrote collections.json successfully');
process.exit(0);
