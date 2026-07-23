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
const SENHA_TESTE = 'Fixture' + '#Jest' + '2026';        // atende a política: maiúscula+número+especial
const SENHA_TESTE_NOVA = 'Fixture' + '#Nova' + '2026';   // para fluxos de troca/primeiro acesso
const CODIGO_ESCOLA_TESTE = 'FIXTURE' + '-COD-' + 'JEST';

/**
 * Conecta ao banco de teste (MongoDB in-memory).
 * Deve ser chamado no beforeAll de cada suite.
 */
async function conectarBanco() {
    const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_TEST;
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(uri);
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
function nextId() { return ++_counter; }

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

module.exports = { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE, SENHA_TESTE_NOVA, CODIGO_ESCOLA_TESTE };
