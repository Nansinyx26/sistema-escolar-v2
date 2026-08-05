const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function checkSave() {
    try {
        await mongoose.connect(MONGODB_URI);
        const Aluno = require('../src/models/Aluno');
        const student = await Aluno.findOne({});
        console.log('Student found:', student._id, student.nome);
        student.codigoSecreto = 'ABCDEF';
        await student.save();
        console.log('Save successful!');
        await mongoose.disconnect();
    } catch (err) {
        console.error('Error during save test:', err);
    }
}

checkSave();
