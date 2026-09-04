/**
 * iaSemEmoji.test.js — o emoji não chega à tela NEM ao banco.
 *
 * `semEmoji.test.js` cobre a unidade. Aqui a pergunta é outra: o filtro está
 * LIGADO no caminho real do copiloto (`POST /api/ia/chat`), e no ponto certo
 * dele. O ponto certo importa porque há dois consumidores do mesmo texto — o
 * stream que a pessoa lê e o documento que vai para o Mongo. Filtrar só na
 * saída SSE deixaria o emoji gravado no histórico, de onde ele voltaria
 * inteiro ao reabrir a conversa e ao exportá-la.
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
const IaConversa = require('../models/IaConversa');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const TEM_EMOJI = /\p{Extended_Pictographic}/u;

// ── Dublês ───────────────────────────────────────────────────────────────────

/**
 * Provedor que emite os pedaços EXATAMENTE como recebidos.
 *
 * Emitir pedaço a pedaço (em vez de um texto só) é o ponto do dublê: é assim
 * que o Gemini entrega, e é a única forma de exercitar o corte de um emoji
 * entre dois deltas.
 *
 * @param {string[]} pedacos
 */
function provedorEmPedacos(pedacos) {
    return {
        configurado: () => true,
        async *stream() {
            for (const p of pedacos) yield { tipo: 'texto', texto: p };
            yield { tipo: 'fim', motivo: 'completo' };
        }
    };
}

// ── Utilitários ──────────────────────────────────────────────────────────────

async function cookieDe(perfil) {
    const user = await criarUsuario({ perfil });
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

/** Junta os deltas na ordem — o texto que a pessoa efetivamente leu. */
function textoNaTela(res) {
    return eventosSSE(res.text)
        .filter(e => e.tipo === 'delta')
        .map(e => e.texto)
        .join('');
}

/** Última mensagem do assistente gravada na conversa do turno. */
async function respostaGravada(res) {
    const evento = eventosSSE(res.text).find(e => e.tipo === 'conversa');
    const conversa = await IaConversa.findById(evento.id).lean();
    const doAssistente = conversa.mensagens.filter(m => m.papel === 'assistente');
    return doAssistente[doAssistente.length - 1].texto;
}

// ── Ciclo de vida ────────────────────────────────────────────────────────────

beforeAll(async () => { await conectarBanco(); });

beforeEach(async () => {
    // Mesma razão de `iaMemoria.test.js`: duas escolas ativas fazem
    // `filtrarPorEscola` deixar de resolver req.escolaId.
    await Escola.deleteMany({});
    await Escola.create({ nome: 'EMEF Sem Emoji', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => { await desconectarBanco(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/ia/chat — resposta sem emoji', () => {
    it('remove o emoji do stream E do que fica gravado', async () => {
        global.__provedorIA = provedorEmPedacos(['Olá! 😊 ', 'A média é 7,5.']);
        const { cookie } = await cookieDe('diretor');

        const res = await request(app).post('/api/ia/chat')
            .set('Cookie', cookie).send({ mensagem: 'qual a média?' });

        expect(res.status).toBe(200);
        expect(textoNaTela(res)).toBe('Olá! A média é 7,5.');
        expect(await respostaGravada(res)).toBe('Olá! A média é 7,5.');
    });

    it('emoji cortado entre dois deltas não deixa resíduo', async () => {
        // O caso que motivou o filtro com estado: cada metade, vista sozinha,
        // não casa com a sequência inteira.
        const emoji = '👨‍🏫';
        global.__provedorIA = provedorEmPedacos([
            `Professores ${emoji.slice(0, 2)}`,
            `${emoji.slice(2)} da turma.`,
        ]);
        const { cookie } = await cookieDe('diretor');

        const res = await request(app).post('/api/ia/chat')
            .set('Cookie', cookie).send({ mensagem: 'quem leciona?' });

        const tela = textoNaTela(res);
        expect(tela).not.toMatch(TEM_EMOJI);
        expect(tela).toBe('Professores da turma.');
        expect(await respostaGravada(res)).toBe('Professores da turma.');
    });

    it('não perde o fim da resposta — a cauda retida é liberada', async () => {
        // Uma resposta que termina em dígito exercita o pior caso do filtro: o
        // "5" fica retido como possível base de keycap e só sai no drenar.
        global.__provedorIA = provedorEmPedacos(['A turma tem ', '25']);
        const { cookie } = await cookieDe('diretor');

        const res = await request(app).post('/api/ia/chat')
            .set('Cookie', cookie).send({ mensagem: 'quantos alunos?' });

        expect(textoNaTela(res)).toBe('A turma tem 25');
        expect(await respostaGravada(res)).toBe('A turma tem 25');
    });

    it('o último delta chega ANTES do evento de fim', async () => {
        // Se o drenar rodasse depois do 'fim', o front já teria fechado a bolha
        // e o trecho final apareceria só ao reabrir a conversa.
        global.__provedorIA = provedorEmPedacos(['Resposta final 9']);
        const { cookie } = await cookieDe('diretor');

        const res = await request(app).post('/api/ia/chat')
            .set('Cookie', cookie).send({ mensagem: 'e a nota?' });

        const tipos = eventosSSE(res.text).map(e => e.tipo);
        expect(tipos.lastIndexOf('delta')).toBeLessThan(tipos.indexOf('fim'));
    });

    it('texto sem emoji passa intacto', async () => {
        global.__provedorIA = provedorEmPedacos(['Frequência de 92% no 3º ano — ok.']);
        const { cookie } = await cookieDe('professor');

        const res = await request(app).post('/api/ia/chat')
            .set('Cookie', cookie).send({ mensagem: 'como está a frequência?' });

        expect(textoNaTela(res)).toBe('Frequência de 92% no 3º ano — ok.');
    });
});
