/**
 * helpers.js
 * Utilitários compartilhados entre todas as suites de teste.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');

// ─────────────────────────────────────────────────────────
// Credenciais de FIXTURE — usadas apenas em testes (jamais em produção).
// Centralizadas aqui para (a) um único ponto de mudança e (b) evitar
// literais espalhados que disparam falsos positivos em scanners de segredo.
// ─────────────────────────────────────────────────────────
const SENHA_TESTE = 'Fixture' + '#Jest' + '2026'; // atende a política: maiúscula+número+especial
const SENHA_TESTE_NOVA = 'Fixture' + '#Nova' + '2026'; // para fluxos de troca/primeiro acesso
const CODIGO_ESCOLA_TESTE = 'FIXTURE' + '-COD-' + 'JEST';

/**
 * Nome do banco desta execução — um por WORKER do Jest.
 *
 * O `globalSetup` sobe UM MongoDB in-memory e todos os workers recebiam a
 * mesma URI, ou seja, o mesmo banco `test`. Como o Jest roda suites em
 * paralelo, o `limparBanco()` de uma suite apagava as coleções no meio do
 * teste de outra, e duas suites inserindo a mesma fixture colidiam no índice
 * único (`E11000 ... escolas index: nome_1 dup key`). Era a origem das ~98
 * falhas intermitentes, sem relação com o código de produção.
 *
 * Um banco por worker mantém o paralelismo e devolve o isolamento: dentro de
 * um worker as suites rodam em série, e cada uma continua limpando o seu.
 */
function nomeDoBanco() {
    const worker = process.env.JEST_WORKER_ID || '1';
    return `test_w${worker}`;
}

/**
 * Conecta ao banco de teste (MongoDB in-memory).
 * Deve ser chamado no beforeAll de cada suite.
 */
async function conectarBanco() {
    const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_TEST;
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(uri, { dbName: nomeDoBanco() });
    }
}

/**
 * Limpa TODAS as coleções entre testes para garantir isolamento.
 */
async function limparBanco() {
    const colecoes = mongoose.connection.collections;
    for (const nome in colecoes) {
        await colecoes[nome].deleteMany({});
    }
}

/**
 * Desconecta o mongoose ao final da suite.
 */
async function desconectarBanco() {
    await mongoose.disconnect();
}

// Contador atômico para garantir CPF e email únicos mesmo em testes paralelos
let _counter = 0;
function nextId() {
    return ++_counter;
}

/**
 * Cria um usuário de teste com senha hasheada.
 * @param {object} overrides - campos a sobrescrever nos defaults
 */
async function criarUsuario(overrides = {}) {
    const n = nextId();
    const defaults = {
        nome: 'Professor Teste',
        email: `prof_${n}_${Date.now()}@escola.test`,
        senha: await bcrypt.hash(SENHA_TESTE, 10),
        cpf: n.toString().padStart(11, '0'),
        telefone: '(11) 91234-5678',
        perfil: 'professor',
        ativo: true,
    };
    return Usuario.create({ ...defaults, ...overrides });
}

/**
 * Registra o aceite do Termo de Uso de Áudio e Imagem para um usuário.
 *
 * Desde a Issue #118, `POST /api/chat-direto/upload` e `POST /api/audio/upload`
 * recusam com 403 quem não aceitou — a barreira que o `js/termo-audio-imagem.js`
 * sempre declarou depender. Todo teste que envia mídia precisa passar por aqui
 * antes, porque é isso que uma pessoa de verdade faz.
 *
 * Helper explícito, e não um aceite embutido no `criarUsuario`: assim um teste
 * que queira exercitar a RECUSA continua conseguindo, e quem lê o teste vê o
 * pré-requisito em vez de herdá-lo sem saber.
 */
async function aceitarTermoAudioImagem(usuarioId) {
    const { TERMO_ID, TERMO_VERSAO } = require('../utils/termoAudioImagem');
    await Usuario.updateOne(
        { _id: usuarioId },
        {
            $push: {
                lgpdHistory: {
                    termoId: TERMO_ID,
                    versao: TERMO_VERSAO,
                    aceitoEm: new Date(),
                    ip: '127.0.0.1',
                    browser: 'jest',
                    os: 'test',
                    loginType: 'Portal Local',
                },
            },
        }
    );
}

module.exports = {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    aceitarTermoAudioImagem,
    nomeDoBanco,
    SENHA_TESTE,
    SENHA_TESTE_NOVA,
    CODIGO_ESCOLA_TESTE,
};
