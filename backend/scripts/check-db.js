const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const checkDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('CONECTADO:', process.env.MONGODB_URI.replace(/:([^@]+)@/, ':****@'));

        // Definir Schema explicitamente para evitar erros de model não registrado
        const AvaliacaoSchema = new mongoose.Schema({}, { strict: false, collection: 'avaliacaosistemas' });
        const Avaliacao = mongoose.models.AvaliacaoSistema || mongoose.model('AvaliacaoSistema', AvaliacaoSchema);
        
        // Check Usuarios in test
        const Users = mongoose.connection.db.collection('usuarios');
        const users = await Users.find({}).limit(5).toArray();
        console.log('USERS_test_COUNT:', users.length);
        console.log('USERS_test_DATA:', JSON.stringify(users.map(u => ({ nome: u.nome, foto: u.foto, fotoGoogle: u.fotoGoogle })), null, 2));

        // Check GridFS files in test
        const files = await mongoose.connection.db.collection('uploads.files').find({}).limit(5).toArray();
        console.log('GRIDFS_FILES_test:', JSON.stringify(files.map(f => ({ filename: f.filename, id: f._id })), null, 2));
        await mongoose.disconnect();
    } catch (err) {
        console.error('ERRO_FATAL:', err.message);
        process.exit(1);
    }
};

checkDB();
