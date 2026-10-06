/**
 * resumoDiarioPorEscola.test.js — Issue #685
 *
 * O resumo diário das 16h juntava os títulos de TODOS os comunicados do dia,
 * de todas as escolas e de todos os públicos, e mandava para a rede inteira,
 * famílias incluídas. Agora há um resumo por escola, só com os comunicados da
 * escola endereçados a `todos` e já publicados.
 */
const Escola = require('../models/Escola');
const Comunicado = require('../models/Comunicado');
const Notificacao = require('../models/Notificacao');
const { enviarDigest } = require('../jobs/DailyDigestJob');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

let A;
let B;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    B = String((await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: true }))._id);
});

function comunicado(escolaId, titulo, destinatarios, extra = {}) {
    return Comunicado.create({
        escolaId,
        titulo,
        conteudo: 'Texto',
        diretorId: 'diretor-teste',
        diretorNome: 'Direção',
        destinatarios,
        ativo: true,
        ...extra,
    });
}

const resumoDa = (escolaId) => Notificacao.findOne({ tipo: 'resumo_diario', escolaId }).lean();

it('cada escola recebe o próprio resumo, só com os comunicados para todos', async () => {
    await comunicado(A, 'Festa junina da Alfa', ['todos']);
    await comunicado(A, 'Conselho de classe: caso do aluno', ['professores']);
    await comunicado(A, 'Passeio da 1A', ['turma:1A']);
    await comunicado(A, 'Recado para uma família', ['usuario:abc']);
    await comunicado(B, 'Festa da Beta', ['todos']);

    const r = await enviarDigest();

    expect(r.executou).toBe(true);
    const daA = await resumoDa(A);
    const daB = await resumoDa(B);
    expect(daA.mensagem).toContain('Festa junina da Alfa');
    for (const fora of [
        'Conselho de classe',
        'Passeio da 1A',
        'Recado para uma família',
        'Festa da Beta',
    ]) {
        expect(daA.mensagem).not.toContain(fora);
    }
    expect(daB.mensagem).toContain('Festa da Beta');
    expect(daB.mensagem).not.toContain('Festa junina da Alfa');
});

it('nenhum resumo sai sem escola', async () => {
    await comunicado(A, 'Festa junina da Alfa', ['todos']);

    await enviarDigest();

    const resumos = await Notificacao.find({ tipo: 'resumo_diario' }).lean();
    expect(resumos).toHaveLength(2);
    expect(resumos.map((n) => n.escolaId).sort()).toEqual([A, B].sort());
});

it('comunicado agendado para depois não aparece antes da hora', async () => {
    await comunicado(A, 'Reunião que ainda não saiu', ['todos'], {
        dataAgendada: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
    await comunicado(A, 'Aviso já publicado', ['todos']);

    await enviarDigest();

    const daA = await resumoDa(A);
    expect(daA.mensagem).toContain('Aviso já publicado');
    expect(daA.mensagem).not.toContain('Reunião que ainda não saiu');
});

it('escola inativa não recebe resumo', async () => {
    await Escola.updateOne({ _id: B }, { ativo: false });

    await enviarDigest();

    expect(await resumoDa(A)).toBeTruthy();
    expect(await resumoDa(B)).toBeNull();
});
