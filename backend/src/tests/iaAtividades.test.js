/**
 * iaAtividades.test.js — domínio de Atividade e ProjetoMaker.
 *
 * Estes modelos nasceram para sustentar as ferramentas que a especificação
 * pedia e que antes não tinham onde ler nem gravar. O que os testes protegem é
 * o mesmo de sempre: isolamento por escola e recorte de turma do professor.
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
const Turma = require('../models/Turma');
const Atividade = require('../models/Atividade');
const ProjetoMaker = require('../models/ProjetoMaker');
const IaConversa = require('../models/IaConversa');
const ToolRegistry = require('../services/ia/ToolRegistry');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

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
            const retorno = [...mensagens].reverse().find(m => m.papel === 'ferramenta');
            this.resultadoRecebido = retorno ? retorno.resultado : null;
            yield { tipo: 'texto', texto: 'ok' };
            yield { tipo: 'fim', motivo: 'completo' };
        }
    };
}

async function cookieDe(perfil, extras = {}) {
    const user = await criarUsuario({ perfil, ...extras });
    const token = jwt.sign(
        { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
        process.env.JWT_SECRET, { expiresIn: '1h' }
    );
    return { cookie: `escola_jwt=${token}`, user };
}

function eventosSSE(texto) {
    return texto.split('\n').filter(l => l.startsWith('data:'))
        .map(l => JSON.parse(l.slice(5).trim()));
}

async function pedirAcao(cookie, ferramenta, argumentos) {
    global.__provedorIA = provedorQueChamaFerramenta(ferramenta, argumentos);
    const res = await request(app).post('/api/ia/chat').set('Cookie', cookie).send({ mensagem: 'faça' });
    return {
        confirmacao: eventosSSE(res.text).find(e => e.tipo === 'confirmacao'),
        resultado: global.__provedorIA.resultadoRecebido
    };
}

const confirmar = (cookie, confirmToken) =>
    request(app).post('/api/ia/confirmar').set('Cookie', cookie).send({ confirmToken });

/** Professor com vínculo real — é o que o horizontalFilter usa para as turmas. */
async function professorCom(turmas) {
    const { cookie, user } = await cookieDe('professor');
    const Professor = require('../models/Professor');
    await Professor.create({
        nome: user.nome, email: user.email, idUsuario: String(user._id),
        turmas, salaPrincipal: turmas[0], ativo: true
    });
    return { cookie, user };
}

let escola;
let outra;

beforeAll(async () => { await conectarBanco(); });

beforeEach(async () => {
    // Garante que ESTA suíte é dona do estado: uma escola ativa deixada
    // para trás por outra suíte faria `filtrarPorEscola` ver duas ativas e
    // deixar de resolver req.escolaId (ele exige escolha nesse caso).
    await Escola.deleteMany({});
    escola = await Escola.create({ nome: 'EMEF Atividades', tipo: 'EMEF', ativo: true });
    outra = await Escola.create({ nome: 'EMEF Vizinha', tipo: 'EMEF', ativo: false });
    await Turma.create([
        { nome: '6A', escolaId: String(escola._id), periodo: 'manha' },
        { nome: '6B', escolaId: String(escola._id), periodo: 'manha' },
        { nome: '9Z', escolaId: String(outra._id), periodo: 'tarde' }
    ]);
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => { await desconectarBanco(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('criarAtividade', () => {
    it('professor cria atividade na própria turma', async () => {
        const { cookie, user } = await professorCom(['6A']);

        const { confirmacao } = await pedirAcao(cookie, 'criarAtividade', {
            titulo: 'Lista de frações', turma: '6A', tipo: 'tarefa',
            materia: 'Matemática', dataEntrega: '2026-09-10'
        });

        expect(confirmacao.resumo).toMatch(/6A/);
        expect(confirmacao.resumo).toMatch(/10\/09\/2026/);

        const res = await confirmar(cookie, confirmacao.confirmToken);
        expect(res.status).toBe(200);

        const atividade = await Atividade.findOne({ titulo: 'Lista de frações' }).lean();
        expect(atividade.escolaId).toBe(String(escola._id));
        expect(atividade.turma).toBe('6A');
        expect(atividade.criadoPor).toBe(String(user._id));
        // Sem deslocamento de fuso: dia 10, não 9.
        expect(atividade.dataEntrega.getDate()).toBe(10);
    });

    it('professor NÃO cria atividade em turma que não é dele', async () => {
        const { cookie } = await professorCom(['6A']);

        const { confirmacao, resultado } = await pedirAcao(cookie, 'criarAtividade', {
            titulo: 'Prova indevida', turma: '6B'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultado.erro).toMatch(/não está entre as suas/i);
        expect(await Atividade.countDocuments()).toBe(0);
    });

    it('recusa turma que não existe na escola', async () => {
        const { cookie } = await cookieDe('diretor');

        const { confirmacao, resultado } = await pedirAcao(cookie, 'criarAtividade', {
            titulo: 'Teste', turma: '7X'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultado.erro).toMatch(/não encontrei a turma/i);
    });

    it('não alcança turma de outra escola', async () => {
        const { cookie } = await cookieDe('diretor');

        const { confirmacao, resultado } = await pedirAcao(cookie, 'criarAtividade', {
            titulo: 'Invasora', turma: '9Z'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultado.erro).toMatch(/não encontrei a turma/i);
    });

    it('aceita a grafia com "º" e grava o nome canônico da turma', async () => {
        const { cookie } = await cookieDe('diretor');

        const { confirmacao } = await pedirAcao(cookie, 'criarAtividade', {
            titulo: 'Leitura', turma: '6ºA'
        });
        await confirmar(cookie, confirmacao.confirmToken);

        const atividade = await Atividade.findOne({ titulo: 'Leitura' }).lean();
        expect(atividade.turma).toBe('6A'); // o nome como está cadastrado
    });
});

describe('atividadesPendentesCorrecao', () => {
    it('lista só o que tem entrega aguardando correção', async () => {
        const { cookie, user } = await professorCom(['6A']);

        await Atividade.create([
            {
                titulo: 'Com pendência', escolaId: String(escola._id), turma: '6A',
                criadoPor: String(user._id),
                entregas: [
                    { alunoId: 'a1', corrigida: false },
                    { alunoId: 'a2', corrigida: true }
                ]
            },
            {
                titulo: 'Tudo corrigido', escolaId: String(escola._id), turma: '6A',
                criadoPor: String(user._id),
                entregas: [{ alunoId: 'a3', corrigida: true }]
            },
            {
                titulo: 'Sem entregas', escolaId: String(escola._id), turma: '6A',
                criadoPor: String(user._id), entregas: []
            }
        ]);

        const ctx = ToolRegistry.construirContextoFerramenta({
            user: { id: String(user._id), perfil: 'professor', nome: user.nome, email: user.email },
            escolaId: String(escola._id),
            allowedTurmas: ['6A']
        });
        const r = await ToolRegistry.executar('atividadesPendentesCorrecao', {}, ctx);

        expect(r.ok).toBe(true);
        expect(r.dados.total).toBe(1);
        expect(r.dados.atividades[0].titulo).toBe('Com pendência');
        expect(r.dados.totalEntregasAguardando).toBe(1);
    });

    it('professor não vê as atividades de outro professor na mesma turma', async () => {
        const meu = await professorCom(['6A']);
        const colega = await cookieDe('professor');

        await Atividade.create({
            titulo: 'Do colega', escolaId: String(escola._id), turma: '6A',
            criadoPor: String(colega.user._id),
            entregas: [{ alunoId: 'a1', corrigida: false }]
        });

        const ctx = ToolRegistry.construirContextoFerramenta({
            user: { id: String(meu.user._id), perfil: 'professor', nome: meu.user.nome, email: meu.user.email },
            escolaId: String(escola._id),
            allowedTurmas: ['6A']
        });
        const r = await ToolRegistry.executar('atividadesPendentesCorrecao', {}, ctx);

        expect(r.dados.total).toBe(0);
    });

    it('gestão vê a escola inteira, mas nunca a vizinha', async () => {
        const { cookie, user } = await cookieDe('diretor');

        await Atividade.create([
            {
                titulo: 'Minha escola', escolaId: String(escola._id), turma: '6A',
                criadoPor: 'qualquer', entregas: [{ alunoId: 'a1', corrigida: false }]
            },
            {
                titulo: 'Escola vizinha', escolaId: String(outra._id), turma: '9Z',
                criadoPor: 'qualquer', entregas: [{ alunoId: 'z1', corrigida: false }]
            }
        ]);

        const ctx = ToolRegistry.construirContextoFerramenta({
            user: { id: String(user._id), perfil: 'diretor', nome: user.nome, email: user.email },
            escolaId: String(escola._id),
            allowedTurmas: []
        });
        const r = await ToolRegistry.executar('atividadesPendentesCorrecao', {}, ctx);

        expect(r.dados.total).toBe(1);
        expect(r.dados.atividades[0].titulo).toBe('Minha escola');
        expect(cookie).toBeTruthy();
    });
});

describe('criarProjetoMaker', () => {
    it('cria o projeto com as turmas envolvidas', async () => {
        const { cookie, user } = await cookieDe('diretor');

        const { confirmacao } = await pedirAcao(cookie, 'criarProjetoMaker', {
            titulo: 'Horta automatizada', area: 'sustentabilidade',
            turmas: ['6A', '6B'], materiais: ['Arduino', 'sensor de umidade'],
            dataInicio: '2026-09-01', dataPrevistaFim: '2026-11-30'
        });

        expect(confirmacao.resumo).toMatch(/sustentabilidade/);
        expect(confirmacao.resumo).toMatch(/6A, 6B/);

        const res = await confirmar(cookie, confirmacao.confirmToken);
        expect(res.status).toBe(200);

        const projeto = await ProjetoMaker.findOne({ titulo: 'Horta automatizada' }).lean();
        expect(projeto.escolaId).toBe(String(escola._id));
        expect(projeto.turmas).toEqual(['6A', '6B']);
        expect(projeto.situacao).toBe('planejamento');
        expect(projeto.responsavelId).toBe(String(user._id));
        expect(projeto.materiais).toHaveLength(2);
    });

    it('professor não envolve turma que não é dele', async () => {
        const { cookie } = await professorCom(['6A']);

        const { confirmacao, resultado } = await pedirAcao(cookie, 'criarProjetoMaker', {
            titulo: 'Projeto amplo', turmas: ['6A', '6B']
        });

        expect(confirmacao).toBeUndefined();
        expect(resultado.erro).toMatch(/não estão entre as suas/i);
        expect(await ProjetoMaker.countDocuments()).toBe(0);
    });

    it('recusa término anterior ao início', async () => {
        const { cookie } = await cookieDe('diretor');

        const { confirmacao, resultado } = await pedirAcao(cookie, 'criarProjetoMaker', {
            titulo: 'Datas trocadas', dataInicio: '2026-11-30', dataPrevistaFim: '2026-09-01'
        });

        expect(confirmacao).toBeUndefined();
        expect(resultado.erro).toMatch(/anterior ao início/i);
    });

    it('área desconhecida vira "outro" em vez de falhar', async () => {
        const { cookie } = await cookieDe('diretor');

        const { confirmacao } = await pedirAcao(cookie, 'criarProjetoMaker', {
            titulo: 'Projeto livre', area: 'astrofisica-quantica'
        });
        await confirmar(cookie, confirmacao.confirmToken);

        const projeto = await ProjetoMaker.findOne({ titulo: 'Projeto livre' }).lean();
        expect(projeto.area).toBe('outro');
    });
});

describe('Retenção das conversas — sincronização do índice TTL', () => {
    it('alinha o índice quando o valor configurado muda', async () => {
        const { sincronizarRetencao } = require('../models/IaConversa');
        await IaConversa.init();

        // Simula um índice criado com retenção diferente (o cenário real: a
        // variável de ambiente foi alterada depois da primeira execução).
        await IaConversa.collection.conn.db.command({
            collMod: IaConversa.collection.collectionName,
            index: { name: 'ttl_retencao_conversa', expireAfterSeconds: 12345 }
        });

        const r = await sincronizarRetencao();

        expect(r.acao).toBe('atualizado');
        expect(r.de).toBe(12345);
        expect(r.para).toBe(90 * 24 * 60 * 60);

        const indices = await IaConversa.collection.indexes();
        const ttl = indices.find(i => i.name === 'ttl_retencao_conversa');
        expect(ttl.expireAfterSeconds).toBe(90 * 24 * 60 * 60);
    });

    it('não faz nada quando já está alinhado', async () => {
        const { sincronizarRetencao } = require('../models/IaConversa');
        await IaConversa.init();

        const r = await sincronizarRetencao();
        expect(r.acao).toBe('ja-alinhado');
    });
});
