/**
 * iaFerramentas.test.js — Fase 2 do copiloto (ferramentas de leitura).
 *
 * O que estes testes protegem, em ordem de importância:
 *   1. isolamento multi-escola nas consultas das ferramentas;
 *   2. as DUAS barreiras de autorização (catálogo por cargo + PermissionGuard);
 *   3. o recorte por turma do professor e por filho do responsável;
 *   4. o laço de tool calling do controller.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

global.__provedorIA = null;

jest.mock('../services/ia/AIProvider', () => {
    const real = jest.requireActual('../services/ia/AIProvider');
    return { ...real, obterProvider: () => global.__provedorIA };
});

const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Turma = require('../models/Turma');
const Professor = require('../models/Professor');
const Nota = require('../models/Nota');
const ToolRegistry = require('../services/ia/ToolRegistry');
const { filtroDaEscola, ErroPermissao } = require('../services/ia/PermissionGuard');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

// ── Dublês do provedor ───────────────────────────────────────────────────────

/** Responde direto, sem chamar ferramenta. */
function provedorSimples(texto = 'ok') {
    return {
        mensagensRecebidas: null,
        ferramentasRecebidas: undefined,
        configurado: () => true,
        async *stream(mensagens, ferramentas) {
            this.mensagensRecebidas = mensagens;
            this.ferramentasRecebidas = ferramentas;
            yield { tipo: 'texto', texto };
            yield { tipo: 'fim', motivo: 'completo' };
        }
    };
}

/**
 * Pede UMA ferramenta na primeira volta e, na segunda, responde com o resultado
 * que recebeu — é assim que verificamos o laço inteiro de ponta a ponta.
 */
function provedorQueChamaFerramenta(nome, argumentos = {}) {
    return {
        voltas: 0,
        resultadoRecebido: null,
        configurado: () => true,
        async *stream(mensagens) {
            this.voltas++;
            if (this.voltas === 1) {
                yield { tipo: 'ferramenta', chamadas: [{ id: 'c1', nome, argumentos }] };
                yield { tipo: 'fim', motivo: 'completo' };
                return;
            }
            const retorno = [...mensagens].reverse().find(m => m.papel === 'ferramenta');
            this.resultadoRecebido = retorno ? retorno.resultado : null;
            yield { tipo: 'texto', texto: JSON.stringify(this.resultadoRecebido) };
            yield { tipo: 'fim', motivo: 'completo' };
        }
    };
}

// ── Utilitários ──────────────────────────────────────────────────────────────

async function cookieDe(perfil, extras = {}) {
    const user = await criarUsuario({ perfil, ...extras });
    const token = jwt.sign(
        { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return { cookie: `escola_jwt=${token}`, user };
}

function eventosSSE(texto) {
    return texto.split('\n').filter(l => l.startsWith('data:'))
        .map(l => JSON.parse(l.slice(5).trim()));
}

/** Contexto de ferramenta equivalente ao que o controller monta. */
function ctxDe({ perfil, escolaId, allowedTurmas = [], user = {} }) {
    const req = {
        user: { id: user.id || 'u1', perfil, email: user.email || 'x@escola.test', nome: 'Fulano', ...user },
        escolaId,
        allowedTurmas
    };
    return ToolRegistry.construirContextoFerramenta(req);
}

async function chamar(nome, params, ctx) {
    return ToolRegistry.executar(nome, params, ctx);
}

// ── Ciclo de vida ────────────────────────────────────────────────────────────

let minhaEscola;
let outraEscola;

beforeAll(async () => { await conectarBanco(); });

beforeEach(async () => {
    // Garante que ESTA suíte é dona do estado: uma escola ativa deixada
    // para trás por outra suíte faria `filtrarPorEscola` ver duas ativas e
    // deixar de resolver req.escolaId (ele exige escolha nesse caso).
    await Escola.deleteMany({});
    global.__provedorIA = provedorSimples();
    minhaEscola = await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true });
    outraEscola = await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: false });
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => { await desconectarBanco(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('ToolRegistry — primeira barreira (catálogo por cargo)', () => {
    it('gestão recebe todas as ferramentas de leitura', () => {
        const esperadas = [
            'atividadesPendentesCorrecao', 'buscarAluno', 'consultarFrequencia',
            'consultarNotas', 'contarAlunos', 'listarComunicados', 'listarEventos',
            'listarProfessores', 'listarTurmas', 'resumoDashboard'
        ];
        // Lista explícita em vez de contagem: quando uma ferramenta nova entra,
        // o teste diz QUAL apareceu, em vez de só "esperava 9, veio 10".
        expect(ToolRegistry.nomesPara('diretor').sort()).toEqual(esperadas);
        expect(ToolRegistry.nomesPara('secretaria').sort()).toEqual(esperadas);
        expect(ToolRegistry.nomesPara('admin').sort()).toEqual(esperadas);
    });

    it('professor não recebe as ferramentas administrativas', () => {
        const nomes = ToolRegistry.nomesPara('professor');
        expect(nomes).not.toContain('listarProfessores');
        expect(nomes).not.toContain('resumoDashboard');
        expect(nomes).toContain('contarAlunos');
    });

    it('responsável não recebe nada que exponha a escola inteira', () => {
        const nomes = ToolRegistry.nomesPara('responsavel');
        expect(nomes).not.toContain('contarAlunos');
        expect(nomes).not.toContain('listarTurmas');
        expect(nomes).not.toContain('listarProfessores');
        expect(nomes).not.toContain('resumoDashboard');
        // Mas continua podendo falar dos próprios filhos e da rotina da escola.
        expect(nomes).toEqual(expect.arrayContaining(['buscarAluno', 'consultarNotas', 'listarEventos']));
    });

    it('nenhuma ferramenta aceita escolaId como parâmetro', () => {
        // O registry recusa isso no carregamento; aqui garantimos que nenhuma
        // declaração publicada tem o campo.
        for (const f of ToolRegistry.declaracoesPara('admin')) {
            expect(f.schema?.properties?.escolaId).toBeUndefined();
        }
    });

    it('a Fase 2 não expõe nenhuma ferramenta de escrita', () => {
        for (const f of ToolRegistry.declaracoesPara('admin')) {
            expect(f.name).not.toMatch(/^criar|^enviar|^gerar/);
        }
    });
});

describe('PermissionGuard — segunda barreira', () => {
    it('recusa a ferramenta mesmo se o modelo a chamar sem estar no catálogo', async () => {
        // Simula alucinação: responsável pedindo contagem da escola inteira.
        const ctx = ctxDe({ perfil: 'responsavel', escolaId: String(minhaEscola._id) });
        const r = await chamar('contarAlunos', {}, ctx);

        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/não tem acesso/i);
        // A recusa é redigida para o modelo repassar com cordialidade.
        expect(r.erro).toMatch(/cordialidade|explique/i);
    });

    it('falha FECHADA quando não há escola resolvida na sessão', () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: null });
        // Sem escola não devolvemos filtro vazio: filtro vazio varreria a rede.
        expect(() => filtroDaEscola(ctx)).toThrow(ErroPermissao);
    });

    it('ferramenta inexistente não derruba a conversa', async () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('deletarTudo', {}, ctx);

        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/não existe/i);
    });
});

describe('contarAlunos — isolamento por escola e por turma', () => {
    beforeEach(async () => {
        await Aluno.create([
            { nome: 'Ana Minha', turma: '1A', escolaId: String(minhaEscola._id) },
            { nome: 'Bia Minha', turma: '1A', escolaId: String(minhaEscola._id) },
            { nome: 'Caio Minha', turma: '2B', escolaId: String(minhaEscola._id) },
            { nome: 'Dora Outra', turma: '1A', escolaId: String(outraEscola._id) },
            { nome: 'Elo Outra', turma: '2B', escolaId: String(outraEscola._id) }
        ]);
    });

    it('conta apenas os alunos da escola da sessão', async () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('contarAlunos', {}, ctx);

        expect(r.ok).toBe(true);
        expect(r.dados.total).toBe(3); // nunca 5
    });

    it('filtra por turma dentro da própria escola', async () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('contarAlunos', { turma: '1A' }, ctx);

        expect(r.dados.total).toBe(2); // não inclui a "1A" da outra escola
    });

    it('professor conta somente dentro das próprias turmas', async () => {
        const ctx = ctxDe({
            perfil: 'professor',
            escolaId: String(minhaEscola._id),
            allowedTurmas: ['1A']
        });
        const r = await chamar('contarAlunos', {}, ctx);

        expect(r.dados.total).toBe(2); // 1A apenas, não os 3 da escola
    });

    it('professor que pede uma turma que não é dele não recebe o número dela', async () => {
        const ctx = ctxDe({
            perfil: 'professor',
            escolaId: String(minhaEscola._id),
            allowedTurmas: ['1A']
        });
        const r = await chamar('contarAlunos', { turma: '2B' }, ctx);

        expect(r.dados.total).toBe(0); // o recorte de turma prevalece sobre o pedido
    });

    it('professor sem turma atribuída recebe recusa explicativa', async () => {
        const ctx = ctxDe({ perfil: 'professor', escolaId: String(minhaEscola._id), allowedTurmas: [] });
        const r = await chamar('contarAlunos', {}, ctx);

        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/turmas atribuídas/i);
    });
});

describe('buscarAluno — recorte por vínculo', () => {
    beforeEach(async () => {
        await Aluno.create([
            { nome: 'Joao Silva', turma: '1A', escolaId: String(minhaEscola._id), responsavel: 'mae@escola.test' },
            { nome: 'Joao Souza', turma: '2B', escolaId: String(minhaEscola._id), responsavel: 'outra@escola.test' },
            { nome: 'Joao Alheio', turma: '1A', escolaId: String(outraEscola._id) }
        ]);
    });

    it('diretor encontra os alunos da própria escola', async () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('buscarAluno', { termo: 'Joao' }, ctx);

        expect(r.dados.total).toBe(2);
        expect(r.dados.alunos.map(a => a.nome)).not.toContain('Joao Alheio');
    });

    it('responsável encontra apenas o próprio filho', async () => {
        const ctx = ctxDe({
            perfil: 'responsavel',
            escolaId: String(minhaEscola._id),
            user: { email: 'mae@escola.test' }
        });
        const r = await chamar('buscarAluno', { termo: 'Joao' }, ctx);

        expect(r.dados.total).toBe(1);
        expect(r.dados.alunos[0].nome).toBe('Joao Silva');
    });

    it('professor encontra apenas alunos das próprias turmas', async () => {
        const ctx = ctxDe({
            perfil: 'professor',
            escolaId: String(minhaEscola._id),
            allowedTurmas: ['1A']
        });
        const r = await chamar('buscarAluno', { termo: 'Joao' }, ctx);

        expect(r.dados.total).toBe(1);
        expect(r.dados.alunos[0].nome).toBe('Joao Silva');
    });

    it('termo curto demais é recusado em vez de varrer a escola', async () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('buscarAluno', { termo: 'J' }, ctx);

        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/2 caracteres/i);
    });

    it('metacaractere de regex no termo não quebra nem vaza a busca', async () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('buscarAluno', { termo: '.*' }, ctx);

        // Tratado como texto literal: nenhum aluno se chama ".*"
        expect(r.ok).toBe(true);
        expect(r.dados.total).toBe(0);
    });
});

describe('consultarNotas — acesso por aluno', () => {
    let filho;
    let alheio;

    beforeEach(async () => {
        [filho, alheio] = await Aluno.create([
            { nome: 'Filho Meu', turma: '1A', escolaId: String(minhaEscola._id), responsavel: 'mae@escola.test' },
            { nome: 'Filho Alheio', turma: '1A', escolaId: String(minhaEscola._id), responsavel: 'outra@escola.test' }
        ]);
        await Nota.create([
            { alunoId: String(filho._id), escolaId: String(minhaEscola._id), materiaId: 'Matematica', bimestre: 1, nota: 8 },
            { alunoId: String(filho._id), escolaId: String(minhaEscola._id), materiaId: 'Matematica', bimestre: 2, nota: 6 },
            { alunoId: String(alheio._id), escolaId: String(minhaEscola._id), materiaId: 'Matematica', bimestre: 1, nota: 10 }
        ]);
    });

    it('responsável vê as notas do próprio filho', async () => {
        const ctx = ctxDe({
            perfil: 'responsavel',
            escolaId: String(minhaEscola._id),
            user: { email: 'mae@escola.test' }
        });
        const r = await chamar('consultarNotas', { alunoId: String(filho._id) }, ctx);

        expect(r.ok).toBe(true);
        expect(r.dados.aluno.nome).toBe('Filho Meu');
        expect(r.dados.mediaGeral).toBe(7);
    });

    it('responsável é barrado no filho de outra pessoa', async () => {
        const ctx = ctxDe({
            perfil: 'responsavel',
            escolaId: String(minhaEscola._id),
            user: { email: 'mae@escola.test' }
        });
        const r = await chamar('consultarNotas', { alunoId: String(alheio._id) }, ctx);

        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/não vinculado/i);
        expect(r.dados).toBeUndefined();
    });

    it('nota não numérica (registro legado) não contamina a média', async () => {
        // O schema atual declara `nota: Number`, então o Mongoose barra a
        // string. Mas o comentário do model diz "ou String" e a base tem
        // histórico de lançamentos conceituais — que chegam por gravação
        // direta, sem validação. É esse documento que simulamos aqui, e é
        // exatamente o caso que o `Number.isFinite` da ferramenta protege.
        await Nota.collection.insertOne({
            _id: 'nota-legada-conceito',
            alunoId: String(filho._id), escolaId: String(minhaEscola._id),
            materiaId: 'Matematica', bimestre: 3, nota: 'Satisfatório'
        });

        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('consultarNotas', { alunoId: String(filho._id) }, ctx);

        expect(r.dados.mediaGeral).toBe(7);          // segue (8+6)/2
        expect(r.dados.totalLancamentos).toBe(3);    // mas o lançamento aparece
    });
});

describe('listarTurmas e listarProfessores', () => {
    beforeEach(async () => {
        await Turma.create([
            { nome: '1A', escolaId: String(minhaEscola._id), periodo: 'manha' },
            { nome: '2B', escolaId: String(minhaEscola._id), periodo: 'tarde' },
            { nome: '9Z', escolaId: String(outraEscola._id), periodo: 'manha' }
        ]);
        await Aluno.create([
            { nome: 'A1', turma: '1A', escolaId: String(minhaEscola._id) },
            { nome: 'A2', turma: '1A', escolaId: String(minhaEscola._id) }
        ]);
    });

    it('lista só as turmas da escola, com a contagem de alunos', async () => {
        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('listarTurmas', {}, ctx);

        expect(r.dados.total).toBe(2);
        expect(r.dados.turmas.map(t => t.nome)).not.toContain('9Z');
        expect(r.dados.turmas.find(t => t.nome === '1A').alunos).toBe(2);
    });

    it('professor vê apenas as próprias turmas', async () => {
        const ctx = ctxDe({
            perfil: 'professor', escolaId: String(minhaEscola._id), allowedTurmas: ['1A']
        });
        const r = await chamar('listarTurmas', {}, ctx);

        expect(r.dados.total).toBe(1);
        expect(r.dados.turmas[0].nome).toBe('1A');
    });

    it('listarProfessores é negado a professor e a responsável', async () => {
        for (const perfil of ['professor', 'responsavel']) {
            const ctx = ctxDe({ perfil, escolaId: String(minhaEscola._id), allowedTurmas: ['1A'] });
            const r = await chamar('listarProfessores', {}, ctx);
            expect(r.ok).toBe(false);
            expect(r.erro).toMatch(/não tem acesso/i);
        }
    });

    it('listarProfessores traz só o quadro da escola da sessão', async () => {
        await Professor.create([
            { nome: 'Prof Meu', vinculos: [{ escolaId: String(minhaEscola._id) }], materias: ['Matematica'] },
            { nome: 'Prof Outro', vinculos: [{ escolaId: String(outraEscola._id) }], materias: ['Matematica'] }
        ]);

        const ctx = ctxDe({ perfil: 'diretor', escolaId: String(minhaEscola._id) });
        const r = await chamar('listarProfessores', {}, ctx);

        expect(r.dados.professores.map(p => p.nome)).toEqual(['Prof Meu']);
    });
});

describe('POST /api/ia/chat — laço de tool calling', () => {
    it('executa a ferramenta e devolve o resultado ao modelo', async () => {
        await Aluno.create([
            { nome: 'X1', turma: '1A', escolaId: String(minhaEscola._id) },
            { nome: 'X2', turma: '1A', escolaId: String(minhaEscola._id) }
        ]);

        global.__provedorIA = provedorQueChamaFerramenta('contarAlunos', {});
        const { cookie } = await cookieDe('diretor');

        const res = await request(app)
            .post('/api/ia/chat')
            .set('Cookie', cookie)
            .send({ mensagem: 'quantos alunos temos?' });

        expect(res.status).toBe(200);
        expect(global.__provedorIA.voltas).toBe(2);
        expect(global.__provedorIA.resultadoRecebido.ok).toBe(true);
        expect(global.__provedorIA.resultadoRecebido.dados.total).toBe(2);

        // A interface é avisada da consulta em curso.
        const eventos = eventosSSE(res.text);
        expect(eventos.find(e => e.tipo === 'ferramenta')).toEqual({
            tipo: 'ferramenta', nome: 'contarAlunos'
        });
    });

    it('declara ao modelo apenas as ferramentas do cargo', async () => {
        global.__provedorIA = provedorSimples();
        const { cookie } = await cookieDe('responsavel');

        await request(app).post('/api/ia/chat').set('Cookie', cookie).send({ mensagem: 'oi' });

        const nomes = global.__provedorIA.ferramentasRecebidas.map(f => f.name);
        expect(nomes).not.toContain('contarAlunos');
        expect(nomes).toContain('consultarNotas');
    });

    it('recusa de ferramenta volta como dado, sem derrubar o streaming', async () => {
        global.__provedorIA = provedorQueChamaFerramenta('contarAlunos', {});
        const { cookie } = await cookieDe('responsavel');

        const res = await request(app)
            .post('/api/ia/chat')
            .set('Cookie', cookie)
            .send({ mensagem: 'quantos alunos tem a escola?' });

        expect(res.status).toBe(200);
        const resultado = global.__provedorIA.resultadoRecebido;
        expect(resultado.ok).toBe(false);
        expect(resultado.erro).toMatch(/não tem acesso/i);

        // A conversa termina normalmente — a recusa é conteúdo, não falha.
        const eventos = eventosSSE(res.text);
        expect(eventos.some(e => e.tipo === 'erro')).toBe(false);
        expect(eventos.some(e => e.tipo === 'fim')).toBe(true);
        // E o turno é gravado como qualquer outro (evento 'conversa', Fase 3).
        expect(eventos[eventos.length - 1].tipo).toBe('conversa');
    });

    it('o prompt manda consultar as ferramentas em vez de responder de memória', async () => {
        global.__provedorIA = provedorSimples();
        const { cookie } = await cookieDe('diretor');

        await request(app).post('/api/ia/chat').set('Cookie', cookie).send({ mensagem: 'oi' });

        const sistema = global.__provedorIA.mensagensRecebidas[0].texto;
        expect(sistema).toMatch(/CHAME a ferramenta/i);
        expect(sistema).toMatch(/buscarAluno/);
    });
});
