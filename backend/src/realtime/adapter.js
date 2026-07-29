/**
 * realtime/adapter.js — adapter compartilhado do Socket.IO.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * -------------------------
 * O Socket.IO guarda as salas (`user:<id>`, `escola:<id>`, `role:<perfil>`) na
 * MEMÓRIA do processo. Com uma instância só isso funciona. Com duas ou mais,
 * cada uma enxerga apenas os sockets que se conectaram nela: a professora
 * atendida pela instância A manda mensagem, o `io.to('user:...')` roda em A, e
 * o diretor conectado na instância B nunca recebe. Mesma coisa para presença,
 * "digitando" e notificações do mural.
 *
 * O adapter faz as instâncias trocarem esses eventos entre si.
 *
 * POR QUE MONGO E NÃO REDIS
 * -------------------------
 * O MongoDB já é dependência do projeto e já está provisionado. Usar o adapter
 * de Mongo evita contratar e manter um Redis só para isso. Em troca, a latência
 * de propagação é um pouco maior que a do Redis — irrelevante na escala de uma
 * rede de escolas.
 *
 * DESLIGADO POR PADRÃO
 * --------------------
 * O deploy atual do Render é `plan: free`, que roda UMA instância — nesse
 * cenário o adapter só adicionaria escrita no banco sem benefício. Ele liga com
 * SOCKET_ADAPTER=mongo, que deve ser definido no MESMO momento em que o serviço
 * passar a ter mais de uma instância.
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Coleção própria, capped: o adapter só precisa dos eventos recentes, e o
// tamanho fixo evita crescimento indefinido sem precisar de job de limpeza.
const COLECAO = 'socket_io_adapter_events';
const TAMANHO_BYTES = 1024 * 1024; // 1 MB de janela de eventos

/**
 * Instala o adapter no servidor Socket.IO, se configurado.
 *
 * Nunca lança: falhar aqui não pode impedir o servidor de subir. Sem adapter o
 * realtime continua funcionando dentro de cada instância — degrada, não cai.
 *
 * @param {import('socket.io').Server} io
 * @returns {Promise<boolean>} true se o adapter foi instalado.
 */
async function instalarAdapter(io) {
    if (String(process.env.SOCKET_ADAPTER || '').toLowerCase() !== 'mongo') {
        return false;
    }

    try {
        const { createAdapter } = require('@socket.io/mongo-adapter');
        const db = mongoose.connection.db;

        if (!db) {
            logger.warn('⚠️ [Socket.IO] SOCKET_ADAPTER=mongo, mas o Mongoose ainda não conectou. Adapter não instalado.');
            return false;
        }

        // createCollection falha se ela já existe — o que é esperado a partir do
        // segundo boot e em toda instância que não foi a primeira a subir.
        try {
            await db.createCollection(COLECAO, {
                capped: true,
                size: TAMANHO_BYTES
            });
            logger.info(`🗂️ [Socket.IO] Coleção capped '${COLECAO}' criada para o adapter.`);
        } catch (err) {
            // 48 = NamespaceExists
            if (err.code !== 48) throw err;
        }

        io.adapter(createAdapter(db.collection(COLECAO)));
        logger.info('🔗 [Socket.IO] Adapter Mongo ativo — eventos propagam entre instâncias.');
        return true;
    } catch (err) {
        logger.error(`❌ [Socket.IO] Falha ao instalar o adapter Mongo: ${err.message}. Seguindo em memória (válido só para uma instância).`);
        return false;
    }
}

module.exports = { instalarAdapter, COLECAO };
