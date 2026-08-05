const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

// Registrar o schema diretamente
const NotificacaoSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    tipo: { type: String, required: true },
    titulo: { type: String, required: true },
    mensagem: { type: String, required: true },
    destinatarios: { type: String, required: true },
    dataCriacao: { type: Date, default: Date.now },
    dataEnvio: { type: Date, default: Date.now },
    status: { type: String, enum: ['enviado', 'agendado'], default: 'enviado' },
    lido: [{ type: String }],
    confirmacao: [{ type: String }],
    ocultadoPor: [{ type: String }],
    escolaId: { type: String, required: true, default: 'default' }
});

const Notificacao = mongoose.model('Notificacao', NotificacaoSchema);

const insertNotif = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
        console.log('✅ Conectado ao MongoDB');

        // Remove duplicados antigos se existirem
        await Notificacao.deleteMany({ titulo: /Reunião pedagógica/i });

        const notif = new Notificacao({
            id: 'notif_reuniao_pedagogica_semanal',
            tipo: 'reuniao',
            titulo: 'Reunião pedagógica às 15h na Biblioteca.',
            mensagem: 'Toda segunda-feira das 15:00 às 18:00 — reunião pedagógica obrigatória na Biblioteca.',
            destinatarios: 'professores',
            status: 'enviado',
            escolaId: 'default',
            dataCriacao: new Date()
        });

        await notif.save();
        console.log('✅ Aviso de reunião pedagógica inserido com sucesso!');

        await mongoose.disconnect();
    } catch (e) {
        console.error(e);
    }
};

insertNotif();
