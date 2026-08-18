/**
 * migracaoAlunosTurma.test.js — a migração 1771286400000, exercitada de verdade.
 *
 * POR QUE ESTE TESTE EXISTE
 * ------------------------
 * Esta migração roda UMA vez, em produção, contra a base inteira de alunos —
 * dado pessoal de criança que ninguém quer reconstituir. O momento de descobrir
 * que ela tem laço infinito, que apaga o campo errado ou que não é idempotente
 * é aqui, não no deploy.
 *
 * O que precisa ser verdade:
 *   1. `nomeNormalizado` é preenchido em TODOS os alunos legados — inclusive
 *      além do primeiro bloco de 500, que é onde um laço mal paginado trava.
 *   2. Os defaults dos campos novos entram sem tocar em quem já os tinha.
 *   3. Os índices são criados, e o TTL de `importacoes_alunos` existe.
 *   4. Rodar de novo não faz nada (idempotência).
 *   5. `down()` remove SÓ o que a migração introduziu — RA, nome, nascimento e
 *      matrículas continuam intactos.
 *
 * ⚠️ Fixtures 100% SINTÉTICAS (§7.8).
 */
const mongoose = require('mongoose');

const Aluno = require('../models/Aluno');
const Matricula = require('../models/Matricula');
const migracao = require('../../migrations/1771286400000-alunos-turma-importacao');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

// Acima de 500 de propósito: é o tamanho do bloco da migração. Com 600 o laço
// precisa dar duas voltas e avançar o cursor corretamente — um `$gt` errado
// aqui vira laço infinito em produção.
const TOTAL_LEGADOS = 600;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

/**
 * Insere alunos no formato ANTERIOR à migração.
 *
 * Vai direto pela collection, sem passar pelo Mongoose: é a única forma de
 * simular documento legado de verdade — sem `nomeNormalizado`, sem `raUf`, sem
 * `situacao` —, porque o `pre('save')` do model preencheria tudo e o teste
 * passaria sem testar nada.
 */
async function semearAlunosLegados(quantidade) {
    const documentos = [];
    for (let i = 1; i <= quantidade; i++) {
        documentos.push({
            _id: new mongoose.Types.ObjectId().toString(),
            escolaId: 'escola-sintetica-1',
            nome: `ALUNO SINTÉTICO NÚMERO ${i}`,
            sobrenome: 'DA SILVA',
            matricula: `90000000${String(i).padStart(4, '0')}`,
            nascimento: new Date(Date.UTC(2014, 2, 10)),
            ativo: true,
            codigoSecreto: `COD${String(i).padStart(7, '0')}`,
        });
    }
    await Aluno.collection.insertMany(documentos);
    return documentos;
}

describe('migração 1771286400000 — alunos por turma / importação', () => {
    it('preenche nomeNormalizado em todos os alunos, além do primeiro bloco', async () => {
        await semearAlunosLegados(TOTAL_LEGADOS);

        // Antes: nenhum documento tem a chave de busca.
        expect(await Aluno.countDocuments({ nomeNormalizado: { $exists: true } })).toBe(0);

        const resultado = await migracao.up();

        expect(resultado.nomeNormalizadoPreenchido).toBe(TOTAL_LEGADOS);
        expect(await Aluno.countDocuments({ nomeNormalizado: { $exists: false } })).toBe(0);
        expect(await Aluno.countDocuments({ nomeNormalizado: '' })).toBe(0);

        // Acento e caixa realmente normalizados — é o que faz a busca achar.
        const primeiro = await Aluno.findOne({ matricula: '900000000001' }).lean();
        expect(primeiro.nomeNormalizado).toBe('aluno sintetico numero 1 da silva');

        // O último do segundo bloco é o que denuncia paginação quebrada.
        const raDoUltimo = `90000000${String(TOTAL_LEGADOS).padStart(4, '0')}`;
        const ultimo = await Aluno.findOne({ matricula: raDoUltimo }).lean();
        expect(ultimo).not.toBeNull();
        expect(ultimo.nomeNormalizado).toBe(`aluno sintetico numero ${TOTAL_LEGADOS} da silva`);
    }, 60000);

    it('preenche os defaults dos campos novos sem sobrescrever quem já os tinha', async () => {
        await semearAlunosLegados(3);
        // Um aluno que já veio de importação não pode ser reescrito como manual.
        await Aluno.collection.insertOne({
            _id: new mongoose.Types.ObjectId().toString(),
            escolaId: 'escola-sintetica-1',
            nome: 'ALUNO SINTÉTICO JÁ IMPORTADO',
            matricula: '900000009999',
            raUf: 'MG',
            situacao: 'transferido',
            origemCadastro: 'importacao_pdf',
            ativo: true,
        });

        await migracao.up();

        const legado = await Aluno.findOne({ matricula: '900000000001' }).lean();
        expect(legado.raUf).toBe('SP');
        expect(legado.situacao).toBe('ativo');
        expect(legado.origemCadastro).toBe('manual');

        const preexistente = await Aluno.findOne({ matricula: '900000009999' }).lean();
        expect(preexistente.raUf).toBe('MG');
        expect(preexistente.situacao).toBe('transferido');
        expect(preexistente.origemCadastro).toBe('importacao_pdf');
    }, 30000);

    it('cria os índices novos, incluindo o TTL de importacoes_alunos', async () => {
        await semearAlunosLegados(2);
        await migracao.up();

        const nomesDe = (indices) => indices.map((indice) => indice.name);

        const indicesAluno = nomesDe(await Aluno.collection.indexes());
        expect(indicesAluno).toEqual(expect.arrayContaining(['escolaId_1_nomeNormalizado_1']));
        // A última linha de defesa contra RA duplicado precisa continuar de pé.
        expect(indicesAluno).toEqual(expect.arrayContaining(['escolaId_1_matricula_1']));

        const indicesMatricula = nomesDe(await Matricula.collection.indexes());
        expect(indicesMatricula).toEqual(
            expect.arrayContaining(['escolaId_1_turmaId_1_anoLetivo_1'])
        );

        // TTL: é o que garante que a cópia temporária de dado de criança não
        // fica para sempre no banco. A migração falha explicitamente se faltar.
        const indicesImportacao = await mongoose.connection.db
            .collection('importacoes_alunos')
            .indexes();
        const ttl = indicesImportacao.find((indice) => indice.expireAfterSeconds !== undefined);
        expect(ttl).toBeDefined();
        expect(ttl.key).toHaveProperty('expiraEm');
        expect(ttl.expireAfterSeconds).toBe(0);
    }, 30000);

    it('é idempotente — rodar de novo não refaz nada', async () => {
        await semearAlunosLegados(5);

        const primeira = await migracao.up();
        expect(primeira.nomeNormalizadoPreenchido).toBe(5);

        const segunda = await migracao.up();
        expect(segunda.nomeNormalizadoPreenchido).toBe(0);
        expect(segunda.raUfPreenchido).toBe(0);
        expect(segunda.situacaoPreenchida).toBe(0);
        expect(segunda.origemCadastroPreenchida).toBe(0);

        expect(await Aluno.countDocuments({})).toBe(5);
    }, 30000);

    it('down() remove só os campos novos e preserva todo o dado real', async () => {
        await semearAlunosLegados(4);
        await Matricula.collection.insertOne({
            _id: new mongoose.Types.ObjectId().toString(),
            escolaId: 'escola-sintetica-1',
            alunoId: 'aluno-sintetico-1',
            turmaId: 'turma-sintetica-1',
            anoLetivo: 2026,
            serie: '5',
            importacaoId: 'lote-sintetico-1',
            status: 'cursando',
        });

        await migracao.up();
        const antes = await Aluno.findOne({ matricula: '900000000002' }).lean();
        expect(antes.nomeNormalizado).toBeTruthy();

        const resultado = await migracao.down();
        expect(resultado.alunosAfetados).toBeGreaterThan(0);

        const depois = await Aluno.findOne({ matricula: '900000000002' }).lean();
        // Campos da migração: removidos.
        expect(depois.nomeNormalizado).toBeUndefined();
        expect(depois.raUf).toBeUndefined();
        expect(depois.situacao).toBeUndefined();
        expect(depois.origemCadastro).toBeUndefined();
        expect(depois.importacaoId).toBeUndefined();
        // Dado real: intacto. Nada de aluno perdido num rollback.
        expect(depois.nome).toBe('ALUNO SINTÉTICO NÚMERO 2');
        expect(depois.matricula).toBe('900000000002');
        expect(depois.nascimento).toEqual(new Date(Date.UTC(2014, 2, 10)));
        expect(depois.codigoSecreto).toBe('COD0000002');
        expect(await Aluno.countDocuments({})).toBe(4);

        // A matrícula continua existindo; só os campos novos saem dela.
        const matricula = await Matricula.findOne({ alunoId: 'aluno-sintetico-1' }).lean();
        expect(matricula).toBeTruthy();
        expect(matricula.turmaId).toBe('turma-sintetica-1');
        expect(matricula.anoLetivo).toBe(2026);
        expect(matricula.serie).toBeUndefined();
        expect(matricula.importacaoId).toBeUndefined();

        // A collection temporária de importações some — minimização de dado.
        const colecoes = await mongoose.connection.db.listCollections().toArray();
        expect(colecoes.map((c) => c.name)).not.toContain('importacoes_alunos');
    }, 30000);

    it('roda em base vazia sem quebrar', async () => {
        const resultado = await migracao.up();
        expect(resultado.nomeNormalizadoPreenchido).toBe(0);
        await expect(migracao.down()).resolves.toBeTruthy();
    }, 30000);
});
