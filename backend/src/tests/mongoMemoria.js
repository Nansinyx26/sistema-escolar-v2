/**
 * mongoMemoria.js — sobe o MongoDB em memória das suítes de forma tolerante a carga.
 *
 * Com a máquina ocupada (gate rodando lint, typecheck e Jest ao mesmo tempo),
 * o `mongod` demorava mais que os 10 s padrão do `mongodb-memory-server` para
 * escrever "waiting for connections": a subida estourava em `MongoInstance.ts`
 * ("Instance failed to start within 10000ms") ou o `replSetInitiate` batia na
 * porta antes de ela abrir (ECONNREFUSED). Nenhuma das duas falhas diz nada
 * sobre o código — e derrubavam a suíte inteira, que nem chegava a rodar.
 *
 * Aqui a subida ganha:
 *   - prazo de lançamento maior (`TESTE_MONGO_LAUNCH_TIMEOUT_MS`, padrão 60 s);
 *   - novas tentativas (`TESTE_MONGO_TENTATIVAS`, padrão 3), derrubando a
 *     instância que ficou pela metade antes de tentar de novo, com uma porta
 *     nova a cada vez.
 *
 * Se todas as tentativas falharem, o último erro sobe intacto: uma falha que
 * se repete três vezes não é carga, e precisa aparecer.
 */
const { MongoMemoryServer, MongoMemoryReplSet } = require('mongodb-memory-server');

function inteiroDoAmbiente(nome, padrao, minimo) {
    const valor = Number.parseInt(process.env[nome], 10);
    return Number.isFinite(valor) && valor >= minimo ? valor : padrao;
}

const LAUNCH_TIMEOUT_MS = inteiroDoAmbiente('TESTE_MONGO_LAUNCH_TIMEOUT_MS', 60000, 1000);
const TENTATIVAS = inteiroDoAmbiente('TESTE_MONGO_TENTATIVAS', 3, 1);

/**
 * Tempo máximo que uma subida pode levar, somando todas as tentativas.
 * Por tentativa: o lançamento de cada `mongod` mais os 30 s fixos que a
 * biblioteca espera pela eleição do primário no replica set, com folga.
 */
const PRAZO_SUBIDA_MS = TENTATIVAS * (LAUNCH_TIMEOUT_MS + 45000);

async function subirComTentativas(criar, descricao) {
    let ultimoErro;
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
        const instancia = criar();
        try {
            await instancia.start();
            return instancia;
        } catch (err) {
            ultimoErro = err;
            // Derruba o que chegou a subir, senão o processo órfão segura a
            // porta e a memória da próxima tentativa.
            await instancia.stop({ doCleanup: true, force: true }).catch(() => {});
            if (tentativa < TENTATIVAS) {
                console.warn(
                    `[mongoMemoria] ${descricao}: tentativa ${tentativa}/${TENTATIVAS} falhou ` +
                        `(${err?.message}); tentando de novo.`
                );
            }
        }
    }
    throw ultimoErro;
}

/** MongoDB avulso — o banco compartilhado do `globalSetup`. */
function criarServidor() {
    return subirComTentativas(
        () => new MongoMemoryServer({ instance: { launchTimeout: LAUNCH_TIMEOUT_MS } }),
        'MongoMemoryServer'
    );
}

/** Replica set — para o que depende de change streams/capped (adapter do Socket.IO). */
function criarReplicaSet(count = 1) {
    return subirComTentativas(
        () =>
            new MongoMemoryReplSet({
                replSet: { count },
                instanceOpts: Array.from({ length: count }, () => ({
                    launchTimeout: LAUNCH_TIMEOUT_MS,
                })),
            }),
        'MongoMemoryReplSet'
    );
}

module.exports = { criarServidor, criarReplicaSet, PRAZO_SUBIDA_MS };
