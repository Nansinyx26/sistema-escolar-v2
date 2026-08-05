/**
 * iaPolimento.test.js — Fase 5 (comandos rápidos e exportação).
 *
 * Dois pontos que importam de verdade aqui:
 *   1. a paleta só entrega ao cliente os comandos do cargo (é lista de
 *      servidor, não enfeite de front);
 *   2. a exportação usa o MESMO escopo de leitura da conversa — não há como
 *      baixar o histórico de outra pessoa.
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
const ExportadorConversa = require('../services/ia/ExportadorConversa');
const { comandosPara } = require('../services/ia/comandos');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

function provedorSimples(texto = 'resposta') {
    return {
        configurado: () => true,
        async *stream() {
            yield { tipo: 'texto', texto };
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

async function criarConversa(cookie, mensagem = 'primeira pergunta') {
    const res = await request(app).post('/api/ia/chat').set('Cookie', cookie).send({ mensagem });
    return eventosSSE(res.text).find(e => e.tipo === 'conversa');
}

beforeAll(async () => { await conectarBanco(); });

beforeEach(async () => {
    // Garante que ESTA suíte é dona do estado: uma escola ativa deixada
    // para trás por outra suíte faria `filtrarPorEscola` ver duas ativas e
    // deixar de resolver req.escolaId (ele exige escolha nesse caso).
    await Escola.deleteMany({});
    global.__provedorIA = provedorSimples();
    await Escola.create({ nome: 'EMEF Polimento', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => { await desconectarBanco(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/ia/comandos — paleta filtrada por cargo', () => {
    it('responsável NÃO recebe comandos de gestão', async () => {
        const { cookie } = await cookieDe('responsavel');
        const res = await request(app).get('/api/ia/comandos').set('Cookie', cookie);

        const nomes = res.body.data.map(c => c.nome);
        expect(nomes).not.toContain('logs');
        expect(nomes).not.toContain('professores');
        expect(nomes).not.toContain('dashboard');
        expect(nomes).not.toContain('relatorios');
        // Mas continua com o que lhe diz respeito.
        expect(nomes).toEqual(expect.arrayContaining(['ajuda', 'eventos', 'comunicados']));
    });

    it('professor não recebe /logs nem /configuracoes', async () => {
        const { cookie } = await cookieDe('professor');
        const res = await request(app).get('/api/ia/comandos').set('Cookie', cookie);

        const nomes = res.body.data.map(c => c.nome);
        expect(nomes).not.toContain('logs');
        expect(nomes).not.toContain('configuracoes');
        expect(nomes).toContain('turmas');
    });

    it('diretor recebe a lista completa', async () => {
        const { cookie } = await cookieDe('diretor');
        const res = await request(app).get('/api/ia/comandos').set('Cookie', cookie);

        const nomes = res.body.data.map(c => c.nome);
        expect(nomes).toEqual(expect.arrayContaining(['logs', 'dashboard', 'relatorios', 'configuracoes']));
    });

    it('a lista enviada ao cliente não expõe a regra de cargos', () => {
        // `cargos` é decisão de servidor; mandá-la ao front entregaria o mapa
        // de permissões de graça.
        for (const c of comandosPara('diretor')) {
            expect(c.cargos).toBeUndefined();
        }
    });

    it('exige autenticação', async () => {
        const res = await request(app).get('/api/ia/comandos');
        expect(res.status).toBe(401);
    });
});

describe('POST /api/ia/exportar/:id', () => {
    it('exporta em TXT com o conteúdo da conversa', async () => {
        const { cookie } = await cookieDe('diretor');
        const conversa = await criarConversa(cookie, 'pergunta exportável');

        const res = await request(app)
            .post(`/api/ia/exportar/${conversa.id}`)
            .set('Cookie', cookie)
            .send({ formato: 'txt' });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.headers['content-disposition']).toMatch(/attachment; filename=/);
        expect(res.text).toContain('pergunta exportável');
        expect(res.text).toContain('resposta');
    });

    it('exporta em DOCX (ZIP válido do Office Open XML)', async () => {
        const { cookie } = await cookieDe('diretor');
        const conversa = await criarConversa(cookie);

        const res = await request(app)
            .post(`/api/ia/exportar/${conversa.id}`)
            .set('Cookie', cookie)
            .buffer(true).parse((r, cb) => {
                const partes = [];
                r.on('data', (c) => partes.push(c));
                r.on('end', () => cb(null, Buffer.concat(partes)));
            })
            .send({ formato: 'docx' });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/wordprocessingml/);
        // PK\x03\x04 — assinatura de arquivo ZIP.
        expect(res.body.slice(0, 4).toString('hex')).toBe('504b0304');
    });

    it('exporta em PDF', async () => {
        const { cookie } = await cookieDe('diretor');
        const conversa = await criarConversa(cookie);

        const res = await request(app)
            .post(`/api/ia/exportar/${conversa.id}`)
            .set('Cookie', cookie)
            .buffer(true).parse((r, cb) => {
                const partes = [];
                r.on('data', (c) => partes.push(c));
                r.on('end', () => cb(null, Buffer.concat(partes)));
            })
            .send({ formato: 'pdf' });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/pdf/);
        expect(res.body.slice(0, 4).toString('utf8')).toBe('%PDF');
    });

    it('recusa formato desconhecido', async () => {
        const { cookie } = await cookieDe('diretor');
        const conversa = await criarConversa(cookie);

        const res = await request(app)
            .post(`/api/ia/exportar/${conversa.id}`)
            .set('Cookie', cookie)
            .send({ formato: 'exe' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/formato inválido/i);
    });

    it('NÃO exporta a conversa de outra pessoa', async () => {
        const dono = await cookieDe('diretor');
        const conversa = await criarConversa(dono.cookie, 'segredo do dono');

        const intruso = await cookieDe('diretor');
        const res = await request(app)
            .post(`/api/ia/exportar/${conversa.id}`)
            .set('Cookie', intruso.cookie)
            .send({ formato: 'txt' });

        expect(res.status).toBe(404);
        expect(res.text).not.toContain('segredo do dono');
    });

    it('não deixa o arquivo em cache intermediário', async () => {
        const { cookie } = await cookieDe('diretor');
        const conversa = await criarConversa(cookie);

        const res = await request(app)
            .post(`/api/ia/exportar/${conversa.id}`)
            .set('Cookie', cookie)
            .send({ formato: 'txt' });

        expect(res.headers['cache-control']).toMatch(/no-store/);
    });
});

describe('ExportadorConversa — detalhes de formato', () => {
    const conversa = {
        titulo: 'Título com acentuação & símbolos',
        resumo: '',
        mensagens: [
            { papel: 'usuario', texto: 'texto com <tag> e & comercial', em: new Date() },
            { papel: 'assistente', texto: 'linha 1\nlinha 2', em: new Date() }
        ]
    };

    it('gera nome de arquivo seguro a partir do título', () => {
        expect(ExportadorConversa.nomeArquivo('Título com acentuação & símbolos', 'pdf'))
            .toMatch(/^[a-zA-Z0-9-]+\.pdf$/);
        // Título vazio não gera um arquivo chamado só ".txt".
        expect(ExportadorConversa.nomeArquivo('', 'txt')).toBe('conversa.txt');
        expect(ExportadorConversa.nomeArquivo('///', 'txt')).toBe('conversa.txt');
    });

    it('o DOCX escapa o XML — uma tag no texto não corrompe o documento', async () => {
        const { buffer } = await ExportadorConversa.exportar(conversa, 'docx', 'Ana');
        const bruto = buffer.toString('latin1');

        // O conteúdo entra escapado; nenhuma tag crua do usuário sobrevive.
        expect(bruto).toContain('&lt;tag&gt;');
        expect(bruto).toContain('&amp;');
        expect(bruto).not.toContain('<tag>');
    });

    it('o TXT preserva as duas pontas da conversa', async () => {
        const { buffer } = await ExportadorConversa.exportar(conversa, 'txt', 'Ana');
        const texto = buffer.toString('utf8');

        expect(texto).toContain('Ana —');          // nome real de quem perguntou
        expect(texto).toContain('Assistente —');
        expect(texto).toContain('linha 1\nlinha 2');
    });

    it('o ZIP declara a quantidade certa de entradas', async () => {
        const { buffer } = await ExportadorConversa.exportar(conversa, 'docx', 'Ana');

        // End Of Central Directory: os últimos 22 bytes. O campo em 10 traz o
        // total de entradas — 3 partes obrigatórias do DOCX mínimo.
        const eocd = buffer.slice(buffer.length - 22);
        expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
        expect(eocd.readUInt16LE(10)).toBe(3);
    });
});
