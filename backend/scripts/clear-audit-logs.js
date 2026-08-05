require('dotenv').config();
const mongoose = require('mongoose');

async function clearLogs() {
    console.log('🔌 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao banco de dados.');

    const db = mongoose.connection.db;
    
    // Deleta os registros da coleção audit_logs
    const result = await db.collection('audit_logs').deleteMany({});
    console.log(`✅ Removidos ${result.deletedCount} registros de auditoria em 'audit_logs'.`);

    await mongoose.disconnect();
    console.log('Desconectado.');
}

clearLogs().catch(console.error);
