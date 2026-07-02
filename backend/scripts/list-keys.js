const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./data/escola_database.json', 'utf8'));
console.log('Keys in JSON:', Object.keys(data));
