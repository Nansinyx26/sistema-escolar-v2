const path = require('path');
const dotenv = require('dotenv');

// Carrega variáveis de ambiente do .env do backend (apenas para dev local, Render usa o painel)
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = require('./app');
const connectDB = require('./utils/db');
const { startKeepAlive } = require('./utils/keepAlive');                          // MELHORIA: Previne cold start (Roadmap #5)
const { startAnonimizacaoAutomatica } = require('./utils/anonimizacaoAutomatica'); // MELHORIA: LGPD cron (Roadmap #14)

const PORT = process.env.PORT || 3001;

const startServer = async () => {
    try {
        // 1. Conectar ao Banco de Dados primeiro
        await connectDB();

        // 2. Iniciar Servidor somente se o banco estiver OK
        const server = app.listen(PORT, () => {
            console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
            // 3. Ativa keep-alive para prevenir cold start no Render Free
            startKeepAlive();
            // 4. Ativa cron de anonimização automática (LGPD)
            startAnonimizacaoAutomatica();
        });

        // Tratamento de Rejeições Não Tratadas
        process.on('unhandledRejection', (err, promise) => {
            console.error(`Unhandled Rejection: ${err.message}`);
            server.close(() => process.exit(1));
        });

    } catch (err) {
        console.error(`❌ Erro fatal ao iniciar o servidor: ${err.message}`);
        process.exit(1);
    }
};

startServer();
