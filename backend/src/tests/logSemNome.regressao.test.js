/**
 * logSemNome.regressao.test.js — Issue #410
 *
 * O `logSanitizer` mascara por NOME DE CHAVE: `{ nome: 'Maria Silva' }` vira
 * `M. S.`. Texto livre ele não tem como mascarar — e era exatamente ali que o
 * nome da criança entrava, interpolado na mensagem e na descrição do
 * `AuditLog`.
 *
 * Duas travas:
 *   1. varredura do código-fonte: nenhuma chamada de log interpola nome;
 *   2. caminho real: cadastrar e editar aluno não deixa o nome dele no log.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const logSanitizer = require('../utils/logSanitizer');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const RAIZ = path.join(__dirname, '..');
const IGNORAR = new Set(['tests', 'node_modules']);

/** Linhas que produzem log: descrição de auditoria e chamadas do logger. */
const LINHA_DE_LOG = /descricao:|logger\.(info|warn|error|debug)\(/;

/**
 * Interpolação de nome de PESSOA. Nome de turma, de escola, de disciplina ou
 * de ferramenta continua liberado — o que não pode sair é o nome de quem o
 * sistema protege.
 */
const OBJETO_PESSOA =
    /\b(aluno|alunos|student|crianca|responsavel|usuario|user|conta|prof|professor|professora|funcionario|titular|destinatario|remetente|solicitante|autor|pessoa)\w*\??\.(nome|nomeCompleto|primeiroNome)\b/i;
const VARIAVEL_NOME =
    /(^|[\s([{,+])(nome|nomeCompleto|primeiroNome|alunoNome|nomeAluno|responsavelNome|funcionarioNome)\b/;

function citaNomeDePessoa(expr) {
    return OBJETO_PESSOA.test(expr) || VARIAVEL_NOME.test(expr);
}

function arquivosJs(dir) {
    const achados = [];
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entrada.isDirectory()) {
            if (IGNORAR.has(entrada.name)) continue;
            achados.push(...arquivosJs(path.join(dir, entrada.name)));
        } else if (entrada.name.endsWith('.js')) {
            achados.push(path.join(dir, entrada.name));
        }
    }
    return achados;
}

/** Devolve as expressões `${...}` de uma linha. */
function interpolacoes(linha) {
    return [...linha.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]);
}

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

describe('nenhuma chamada de log interpola nome de pessoa', () => {
    it('varre backend/src e reprova quem voltar a interpolar', () => {
        const ofensas = [];
        for (const arquivo of arquivosJs(RAIZ)) {
            const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
            linhas.forEach((linha, i) => {
                if (!LINHA_DE_LOG.test(linha)) return;
                for (const expr of interpolacoes(linha)) {
                    if (citaNomeDePessoa(expr)) {
                        ofensas.push(
                            `${path.relative(RAIZ, arquivo)}:${i + 1} → \${${expr.trim()}}`
                        );
                    }
                }
            });
        }
        expect(ofensas).toEqual([]);
    });

    it('o sanitizador mascara nome em CHAVE e não tem como mascarar em texto livre', () => {
        expect(logSanitizer.sanitize({ nome: 'Maria Silva' }).nome).not.toContain('Maria');
        // É por isto que a varredura acima existe:
        expect(logSanitizer.sanitize({ msg: 'Aluna Maria Silva faltou' }).msg).toContain('Maria');
    });
});

describe('o nome do aluno não chega ao AuditLog', () => {
    let escola;
    let secretaria;

    beforeAll(async () => {
        await conectarBanco();
    });
    afterAll(async () => {
        await desconectarBanco();
    });
    beforeEach(async () => {
        await limparBanco();
        escola = await Escola.create({ nome: 'EMEF Log', tipo: 'EMEF', ativo: true });
        secretaria = await criarUsuario({
            email: 'secretaria@escola.test',
            perfil: 'secretaria',
            escolaId: String(escola._id),
        });
        invalidarCacheEscolas();
    });

    it('cadastro e edição registram id e campos, nunca o nome nem a ficha', async () => {
        const criado = await request(app)
            .post('/api/secretaria/alunos')
            .set('Cookie', cookieDe(secretaria))
            .send({ nome: 'Marina Fixture', turma: '1A', cpfAluno: '00000000191' });
        expect(criado.status).toBeLessThan(300);

        const aluno = await Aluno.findOne({ nome: 'Marina Fixture' }).lean();
        expect(aluno).toBeTruthy();

        const editado = await request(app)
            .put(`/api/secretaria/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(secretaria))
            .send({ observacoes: 'texto qualquer' });
        expect(editado.status).toBeLessThan(300);

        const logs = await AuditLog.find({ recurso: 'Alunos' }).lean();
        expect(logs.length).toBeGreaterThanOrEqual(2);

        const texto = JSON.stringify(logs.map((l) => l.detalhes));
        expect(texto).not.toContain('Marina');
        expect(texto).not.toContain('00000000191');
        expect(texto).toContain(String(aluno._id));

        const edicao = logs.find((l) => l.acao === 'UPDATE_STUDENT');
        expect(edicao.detalhes.valorNovo).toEqual({ camposAlterados: ['observacoes'] });
    });
});
