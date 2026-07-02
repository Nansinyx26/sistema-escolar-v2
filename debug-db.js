const mongoose = require('mongoose');
require('dotenv').config();

const Comunicado = require('./backend/src/models/Comunicado');
const Usuario = require('./backend/src/models/Usuario');

async function checkData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sistema-escolar');
        console.log('Connected to MongoDB');

        const lastComunicado = await Comunicado.findOne().sort({ dataCriacao: -1 }).lean();
        if (!lastComunicado) {
            console.log('No comunicados found');
            return;
        }

        console.log('Last Comunicado:');
        console.log('ID:', lastComunicado._id);
        console.log('diretorId:', lastComunicado.diretorId, 'Type:', typeof lastComunicado.diretorId);
        console.log('diretorId is ObjectId:', lastComunicado.diretorId instanceof mongoose.Types.ObjectId);
        console.log('diretorNome:', lastComunicado.diretorNome);
        console.log('diretorFoto:', lastComunicado.diretorFoto);

        const diretor = await Usuario.findById(lastComunicado.diretorId).lean();
        console.log('\nFound Diretor:', diretor ? 'Yes' : 'No');
        if (diretor) {
            console.log('Diretor Name:', diretor.nome);
            console.log('Diretor Foto:', diretor.foto);
            console.log('Diretor FotoGoogle:', diretor.fotoGoogle);
        }

        const populated = await Comunicado.findOne({ _id: lastComunicado._id }).populate('diretorId').lean();
        console.log('\nPopulated Diretor:', populated.diretorId && typeof populated.diretorId === 'object' ? 'Success' : 'Failed');

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkData();
