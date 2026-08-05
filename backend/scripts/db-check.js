const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function check() {
    try {
        console.log('Connecting to database...');
        await mongoose.connect(MONGODB_URI);
        console.log('Connected!');

        const Aluno = require('../src/models/Aluno');

        const total = await Aluno.countDocuments({});
        console.log('Total students:', total);

        const noCode = await Aluno.countDocuments({
            $or: [
                { codigoSecreto: { $exists: false } },
                { codigoSecreto: null },
                { codigoSecreto: '' },
                { codigoSecreto: 'N/A' },
                { codigoSecreto: 'n/a' }
            ]
        });
        console.log('Students without valid code:', noCode);

        const allStudents = await Aluno.find({});
        const codes = {};
        const duplicates = [];
        for (const s of allStudents) {
            if (s.codigoSecreto) {
                if (codes[s.codigoSecreto]) {
                    duplicates.push(s.codigoSecreto);
                }
                codes[s.codigoSecreto] = true;
            }
        }
        console.log('Duplicate secret codes:', duplicates);

        await mongoose.disconnect();
        console.log('Disconnected!');
    } catch (err) {
        console.error('Error:', err);
    }
}

check();
