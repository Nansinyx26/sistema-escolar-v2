#!/usr/bin/env node
/**
 * start-e2e-server.js — sobe o backend com um MongoDB em memória.
 *
 * Por que existe: `backend/src/index.js` chama `process.exit(1)` quando a
 * conexão com o banco falha (utils/db.js). Sem Mongo, o servidor simplesmente
 * não sobe, e o `webServer` do Playwright ficaria esperando para sempre.
 *
 * A alternativa seria declarar um serviço `mongo` no workflow, mas aí o e2e só
 * rodaria no CI — quem quisesse depurar na própria máquina precisaria instalar
 * MongoDB. `mongodb-memory-server` já é devDependency do backend (a suíte Jest
 * usa), então dá para ter o mesmo comportamento nos dois lugares, de graça.
 *
 * Usado por playwright.config.ts. Não use em produção.
 */

const crypto = require('node:crypto');
const path = require('node:path');

const BACKEND = path.resolve(__dirname, '..', 'backend');

async function main() {
    // Resolve a partir do backend: o pacote é devDependency de lá, não da raiz.
    const { MongoMemoryServer } = require(
        require.resolve('mongodb-memory-server', { paths: [BACKEND] })
    );

    console.log('[e2e] subindo MongoDB em memória…');
    const mongo = await MongoMemoryServer.create({
        instance: { dbName: 'e2e' },
    });

    const uri = mongo.getUri();
    console.log(`[e2e] Mongo pronto em ${uri}`);

    // Estas variáveis precisam existir ANTES do require do app: o
    // `validarAmbiente()` roda na primeira linha de src/index.js e encerra o
    // processo se faltar alguma obrigatória.
    process.env.MONGODB_URI = uri;
    process.env.MONGODB_DB_NAME = 'e2e';
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    // Sorteados a cada execução em vez de fixos: segredo escrito no
    // repositório é segredo versionado — o scanner abre incidente a cada push
    // e o alerta que importa se perde no meio dos falsos positivos. Nenhum
    // teste assina token por fora, então ninguém precisa saber o valor.
    process.env.JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
    process.env.SESSION_SECRET =
        process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    process.env.PORT = process.env.PORT || '3001';

    // Telemetria de teste não vai para provedor nenhum.
    process.env.OBSERVABILITY_DISABLED = 'true';

    const encerrar = async (sinal) => {
        console.log(`[e2e] ${sinal} — encerrando`);
        try {
            await mongo.stop();
        } catch (_e) {
            /* best-effort */
        }
        process.exit(0);
    };

    process.on('SIGINT', () => encerrar('SIGINT'));
    process.on('SIGTERM', () => encerrar('SIGTERM'));

    console.log('[e2e] iniciando backend…');
    require(path.join(BACKEND, 'src', 'index.js'));
}

main().catch((err) => {
    console.error('[e2e] falha ao subir o ambiente:', err);
    process.exit(1);
});
