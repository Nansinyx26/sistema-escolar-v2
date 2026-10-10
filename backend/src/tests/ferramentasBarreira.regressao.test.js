/**
 * ferramentasBarreira.regressao.test.js — Issue #727 (Etapa 2 da #720)
 *
 * As ferramentas que dependem da direção passam pela barreira no BACKEND: o
 * professor sem autorização recebe 403 mesmo montando a requisição à mão, e
 * passa na hora em que a direção autoriza. O diretor não é verificado. As
 * ações do assistente que criam atividade ficam atrás de "Geração de
 * atividades com IA": o modelo nem recebe a ação, e o preview e a confirmação
 * conferem de novo.
 */
const request = require('supertest');

global.__provedorIA = null;

jest.mock('../services/ia/AIProvider', () => {
    const real = jest.requireActual('../services/ia/AIProvider');
    return { ...real, obterProvider: () => global.__provedorIA };
});

const app = require('../app');
const Escola = require('../models/Escola');
const Turma = require('../models/Turma');
const Professor = require('../models/Professor');
const Atividade = require('../models/Atividade');
const IaAcaoPendente = require('../models/IaAcaoPendente');
const interruptor = require('../services/ia/interruptor');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

/** Provedor que responde texto e guarda as ferramentas que recebeu. */
function provedorQueResponde() {
    return {
        voltas: 0,
        declaradas: null,
        configurado: () => true,
        async *stream(_mensagens, ferramentas) {
            this.voltas++;
            this.declaradas = (ferramentas || []).map((f) => f.name);
            yield { tipo: 'texto', texto: 'Olá!' };
            yield { tipo: 'fim', motivo: 'completo' };
        },
    };
}

/** Provedor que pede `nome` na primeira volta e guarda o retorno dela. */
function provedorQueChamaFerramenta(nome, argumentos) {
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
            const retorno = [...mensagens].reverse().find((m) => m.papel === 'ferramenta');
            this.resultadoRecebido = retorno ? retorno.resultado : null;
            yield { tipo: 'texto', texto: 'ok' };
            yield { tipo: 'fim', motivo: 'completo' };
        },
    };
}

function eventosSSE(texto) {
    return texto
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => JSON.parse(l.slice(5).trim()));
}

let escola;
let diretor;
let prof;
let padraoAnterior;

beforeAll(async () => {
    await conectarBanco();
    padraoAnterior = process.env.IA_ESCOLAS_PADRAO;
});
afterAll(async () => {
    process.env.IA_ESCOLAS_PADRAO = padraoAnterior;
    interruptor.limparCache();
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    // A chave da ESCOLA ligada: o que se testa aqui é a do professor.
    process.env.IA_ESCOLAS_PADRAO = 'ligada';
    interruptor.limparCache();
    global.__provedorIA = provedorQueResponde();

    escola = await Escola.create({ nome: 'EMEF Barreira', tipo: 'EMEF', ativo: true });
    await Turma.create({ nome: '6A', escolaId: String(escola._id), periodo: 'manha' });
    invalidarCacheEscolas();

    diretor = await criarUsuario({
        nome: 'Diretora',
        email: 'dir.barreira@escola.test',
        perfil: 'diretor',
        escolaId: String(escola._id),
    });
    prof = await criarUsuario({
        nome: 'Professor',
        email: 'prof.barreira@escola.test',
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(prof._id),
        nome: 'Professor',
        email: prof.email,
        salaPrincipal: '6A',
        turmas: ['6A'],
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
});

function decidir(ferramentaId, autorizado) {
    return request(app)
        .put('/api/ferramentas/autorizacoes')
        .set('Cookie', cookieDe(diretor))
        .send({ alteracoes: [{ professorId: String(prof._id), ferramentaId, autorizado }] });
}

function conversar(quem, mensagem = 'Bom dia') {
    return request(app).post('/api/ia/chat').set('Cookie', cookieDe(quem)).send({ mensagem });
}

function esperarNegado(res, ferramentaId) {
    expect(res.status).toBe(403);
    expect(res.body.codigo).toBe('FERRAMENTA_NAO_AUTORIZADA');
    expect(res.body.ferramenta.id).toBe(ferramentaId);
}

describe('Assistente de IA', () => {
    it('professor sem autorização recebe 403 e nada vai ao provedor', async () => {
        const res = await conversar(prof);
        esperarNegado(res, 'ia.assistente');
        expect(global.__provedorIA.voltas).toBe(0);
    });

    it('a direção autoriza e o professor conversa na próxima requisição', async () => {
        expect((await decidir('ia.assistente', true)).status).toBe(200);
        const res = await conversar(prof);
        expect(res.status).toBe(200);
        expect(res.text).toContain('Olá!');
    });

    it('a direção revoga e o professor perde o acesso na hora', async () => {
        await decidir('ia.assistente', true);
        await decidir('ia.assistente', false);
        esperarNegado(await conversar(prof), 'ia.assistente');
    });

    it('o diretor não depende de autorização', async () => {
        expect((await conversar(diretor)).status).toBe(200);
    });

    it('o chatbot antigo também passa pela barreira', async () => {
        const res = await request(app)
            .post('/api/ia/chatbot')
            .set('Cookie', cookieDe(prof))
            .send({ message: 'oi' });
        esperarNegado(res, 'ia.assistente');
    });

    it('o professor continua lendo o próprio histórico', async () => {
        const res = await request(app).get('/api/ia/conversas').set('Cookie', cookieDe(prof));
        expect(res.status).toBe(200);
    });
});

describe('Plano de aula e plano de estudo', () => {
    it('sem autorização, cada um é negado com a sua ferramenta', async () => {
        const aula = await request(app)
            .post('/api/ia/plano-aula')
            .set('Cookie', cookieDe(prof))
            .send({ tema: 'Frações', turma: '6A' });
        esperarNegado(aula, 'ia.plano-aula');

        const estudo = await request(app)
            .post('/api/ia/plano-estudo')
            .set('Cookie', cookieDe(prof))
            .send({ alunoId: 'qualquer', objetivos: 'melhorar' });
        esperarNegado(estudo, 'ia.plano-estudo');
    });

    it('o assistente autorizado não libera o plano de aula', async () => {
        await decidir('ia.assistente', true);
        const aula = await request(app)
            .post('/api/ia/plano-aula')
            .set('Cookie', cookieDe(prof))
            .send({ tema: 'Frações', turma: '6A' });
        esperarNegado(aula, 'ia.plano-aula');
    });
});

describe('Geração de atividades com IA', () => {
    const atividade = {
        titulo: 'Lista de frações',
        turma: '6A',
        tipo: 'tarefa',
        materia: 'Matemática',
        dataEntrega: '2026-12-10',
    };

    it('sem a ferramenta, o modelo não recebe a ação de criar atividade', async () => {
        await decidir('ia.assistente', true);
        await conversar(prof);
        expect(global.__provedorIA.declaradas).not.toContain('criarAtividade');
        expect(global.__provedorIA.declaradas).not.toContain('criarProjetoMaker');

        await decidir('ia.atividades', true);
        await conversar(prof);
        expect(global.__provedorIA.declaradas).toContain('criarAtividade');
    });

    it('sem a ferramenta, o pedido da ação é recusado e nada fica pendente', async () => {
        await decidir('ia.assistente', true);
        global.__provedorIA = provedorQueChamaFerramenta('criarAtividade', atividade);
        const res = await conversar(prof, 'crie a atividade');

        expect(eventosSSE(res.text).find((e) => e.tipo === 'confirmacao')).toBeUndefined();
        expect(global.__provedorIA.resultadoRecebido.ok).toBe(false);
        expect(global.__provedorIA.resultadoRecebido.erro).toMatch(/autorização da direção/);
        expect(await IaAcaoPendente.countDocuments()).toBe(0);
    });

    it('revogada entre o preview e a confirmação, a ação não executa', async () => {
        await decidir('ia.assistente', true);
        await decidir('ia.atividades', true);
        global.__provedorIA = provedorQueChamaFerramenta('criarAtividade', atividade);
        const res = await conversar(prof, 'crie a atividade');
        const confirmacao = eventosSSE(res.text).find((e) => e.tipo === 'confirmacao');
        expect(confirmacao).toBeDefined();

        await decidir('ia.atividades', false);
        const confirmar = await request(app)
            .post('/api/ia/confirmar')
            .set('Cookie', cookieDe(prof))
            .send({ confirmToken: confirmacao.confirmToken });

        expect(confirmar.status).toBe(422);
        expect(await Atividade.countDocuments()).toBe(0);
    });
});
