const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../data/escola_database.json');
try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log('KEYS:', Object.keys(data));
    if (data.lessonlogs) {
        console.log('LESSONLOGS COUNT:', data.lessonlogs.length);
        console.log('SAMPLE LESSONLOG:', data.lessonlogs[0]);
    }
    if (data.special_reports) {
        console.log('SPECIAL_REPORTS COUNT:', data.special_reports.length);
        console.log('SAMPLE SPECIAL_REPORT:', data.special_reports[0]);
    }
} catch (e) {
    console.error(e.message);
}
