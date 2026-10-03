/**
 * iaRegexFerramentas.test.js — Issue #594
 *
 * `listarTurmas`, `listarEventos` e `atividadesPendentesCorrecao` montavam
 * `new RegExp` com o argumento do modelo — que copia o que a pessoa escreveu no
 * chat. Um padrão com retrocesso exponencial rodava no MongoDB, compartilhado
 * por todas as escolas, e um `(` solto derrubava a ferramenta com SyntaxError.
 *
 * O argumento agora é texto: metacaractere não amplia nem quebra o filtro, e o
 * filtro normal (prefixo, turma exata) segue como era.
 */

const Escola = require('../models/Escola');
const Turma = require('../models/Turma');
const CalendarioEscolar = require('../models/CalendarioEscolar');
const Atividade = require('../models/Atividade');
const ToolRegistry = require('../services/ia/ToolRegistry');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

let ctx;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    const escolaId = String(
        (await Escola.create({ nome: 'EMEF Regex', tipo: 'EMEF', ativo: true }))._id
    );
    ctx = ToolRegistry.construirContextoFerramenta({
        user: { id: 'dir1', perfil: 'diretor', email: 'dir@escola.test', nome: 'Direção' },
        escolaId,
        allowedTurmas: [],
    });

    await Turma.create([
        { escolaId, id: '1A', nome: '1A', periodo: 'manha' },
        { escolaId, id: '2B', nome: '2B', periodo: 'tarde' },
    ]);

    const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const base = {
        escolaId,
        dataInicio: amanha,
        dataFim: amanha,
        anoLetivo: amanha.getFullYear(),
        criadoPor: 'dir1',
    };
    await CalendarioEscolar.create([
        { ...base, titulo: 'Prova bimestral', tipo: 'prova' },
        { ...base, titulo: 'Feriado municipal', tipo: 'feriado' },
    ]);

    const pendente = [{ alunoId: 'a1', corrigida: false }];
    await Atividade.create([
        { escolaId, titulo: 'Redação', turma: '1A', criadoPor: 'p1', entregas: pendente },
        { escolaId, titulo: 'Frações', turma: '2B', criadoPor: 'p2', entregas: pendente },
    ]);
});

const chamar = (nome, params) => ToolRegistry.executar(nome, params, ctx);

// Metacaracteres que, sem escape, ampliavam o filtro, quebravam o RegExp ou
// faziam o MongoDB retroceder exponencialmente.
const PADROES = ['.*', '(', '[', '(a+)+$', '1A|2B'];

describe('listarTurmas — periodo', () => {
    it('prefixo continua funcionando', async () => {
        const r = await chamar('listarTurmas', { periodo: 'man' });
        expect(r.ok).toBe(true);
        expect(r.dados.turmas.map((t) => t.nome)).toEqual(['1A']);
    });

    it.each(PADROES)('"%s" é texto, não padrão', async (periodo) => {
        const r = await chamar('listarTurmas', { periodo });
        expect(r.ok).toBe(true);
        expect(r.dados.total).toBe(0);
    });
});

describe('listarEventos — tipo', () => {
    it('prefixo continua funcionando', async () => {
        const r = await chamar('listarEventos', { tipo: 'prov' });
        expect(r.ok).toBe(true);
        expect(r.dados.eventos.map((e) => e.tipo)).toEqual(['prova']);
    });

    it.each(PADROES)('"%s" é texto, não padrão', async (tipo) => {
        const r = await chamar('listarEventos', { tipo });
        expect(r.ok).toBe(true);
        expect(r.dados.total).toBe(0);
    });
});

describe('atividadesPendentesCorrecao — turma', () => {
    it('turma exata continua funcionando, sem diferença de caixa', async () => {
        const r = await chamar('atividadesPendentesCorrecao', { turma: '1a' });
        expect(r.ok).toBe(true);
        expect(r.dados.atividades.map((a) => a.turma)).toEqual(['1A']);
    });

    it.each(PADROES)('"%s" é texto, não padrão', async (turma) => {
        const r = await chamar('atividadesPendentesCorrecao', { turma });
        expect(r.ok).toBe(true);
        expect(r.dados.total).toBe(0);
    });
});
