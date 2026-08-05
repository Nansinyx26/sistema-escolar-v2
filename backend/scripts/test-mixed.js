const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function checkMixed() {
    try {
        await mongoose.connect(MONGODB_URI);
        
        // Define a temporary schema with Mixed _id to test save compatibility
        const TestSchema = new mongoose.Schema({
            _id: { type: mongoose.Schema.Types.Mixed },
            nome: String,
            codigoSecreto: String
        }, { collection: 'alunos' });
        
        const TestModel = mongoose.models.TestModel || mongoose.model('TestModel', TestSchema);
        
        const student = await TestModel.findOne({ nome: 'aluno teste' });
        console.log('Found student with Mixed Schema:', student._id, typeof student._id);
        
        student.codigoSecreto = 'XYZ123';
        await student.save();
        console.log('Save SUCCESSFUL with Mixed _id!');
        
        await mongoose.disconnect();
    } catch (err) {
        console.error('Error with Mixed _id:', err);
    }
}

checkMixed();
