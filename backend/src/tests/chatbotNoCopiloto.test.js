/**
 * @jest-environment jsdom
 */

/**
 * chatbotNoCopiloto.test.js — Issue #702
 *
 * O chatbot das telas da equipe (`js/chatbot-ia.js`) ia ao `/api/ia/chatbot`,
 * que entendia a pergunta por palavras-chave. Agora conversa com o assistente
 * (`POST /api/ia/chat`), em que o Gemini entende a pergunta e consulta o
 * sistema por ferramentas filtradas por perfil. Estes testes rodam o script
 * real com o `fetch` simulado devolvendo o stream do servidor.
 */

const { TextDecoder, TextEncoder } = require('node:util');
// Forma da resposta de `services/ia/interruptor.js` (o jsdom não carrega o
// Mongoose; o vínculo com o objeto real está em chatbotErroDoServidor.test.js).
const RESPOSTA_DESLIGADA = {
    success: false,
    codigo: 'IA_DESLIGADA_NESTA_ESCOLA',
    error: 'O assistente está desligado nesta escola. A direção pode ligá-lo na página do Assistente de IA.',
};

global.TextDecoder = global.TextDecoder || TextDecoder;

let chamadas;
let proximaResposta;

/** Resposta de `fetch` com o corpo SSE montado a partir dos eventos. */
function streamDe(eventos) {
    const encoder = new TextEncoder();
    // Um evento partido em dois pedaços cobre o buffer entre leituras.
    const texto = eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const pedacos = [texto.slice(0, 25), texto.slice(25)].map((t) => encoder.encode(t));
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () =>
                    pedacos.length ? { done: false, value: pedacos.shift() } : { done: true },
            }),
        },
    };
}

beforeAll(() => {
    localStorage.setItem('user_preferencia_narracao', 'texto'); // sem narração no teste
    window.auth = { getCurrentUser: () => ({ nome: 'Ana Souza', perfil: 'professor' }) };
    window.fetch = jest.fn(async (url, opcoes) => {
        chamadas.push({ url, corpo: JSON.parse(opcoes.body) });
        return proximaResposta;
    });
    require('../../../js/chatbot-ia.js');
});

beforeEach(() => {
    chamadas = [];
    document.getElementById('chatbot-clear').click();
});

const input = () => document.getElementById('chat-input-ia');
const respostas = () =>
    [...document.querySelectorAll('.msg-ai .msg-texto')].map((e) => e.textContent);
const ultimaResposta = () => respostas().at(-1);

async function perguntar(texto) {
    input().value = texto;
    document.getElementById('chat-form').dispatchEvent(new Event('submit', { cancelable: true }));
    // A entrada fica travada enquanto a resposta chega.
    for (let i = 0; i < 50 && input().disabled; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));
}

it('pergunta ao assistente e junta o stream numa resposta só', async () => {
    proximaResposta = streamDe([
        { tipo: 'inicio', conversa: { id: 'c1' } },
        { tipo: 'ferramenta', nome: 'consultarNotas' },
        { tipo: 'delta', texto: 'O João tem ' },
        { tipo: 'delta', texto: 'média 8,5.' },
        { tipo: 'fim', motivo: 'completo' },
        { tipo: 'conversa', id: 'c1', titulo: 'Notas do João' },
    ]);
    const antes = respostas().length;

    await perguntar('Notas do João');

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toMatch(/\/api\/ia\/chat$/);
    expect(chamadas[0].corpo).toEqual({ mensagem: 'Notas do João' });
    expect(respostas().length).toBe(antes + 1);
    expect(ultimaResposta()).toBe('O João tem média 8,5.');
});

it('a pergunta seguinte continua a mesma conversa; limpar abre uma nova', async () => {
    proximaResposta = streamDe([
        { tipo: 'inicio', conversa: { id: 'c7' } },
        { tipo: 'delta', texto: 'Oi.' },
        { tipo: 'fim', motivo: 'completo' },
    ]);
    await perguntar('Oi');
    await perguntar('E as faltas?');
    document.getElementById('chatbot-clear').click();
    await perguntar('Recomeçar');

    expect(chamadas.map((c) => c.corpo.conversaId)).toEqual([undefined, 'c7', undefined]);
});

it('com a IA desligada na escola, mostra o motivo do servidor', async () => {
    proximaResposta = { ok: false, status: 403, json: async () => RESPOSTA_DESLIGADA };

    await perguntar('Notas do João');

    expect(ultimaResposta()).toBe(RESPOSTA_DESLIGADA.error);
});

it('erro no meio do stream aparece no chat', async () => {
    proximaResposta = streamDe([
        { tipo: 'erro', mensagem: 'O assistente está sobrecarregado agora.' },
    ]);

    await perguntar('Resumo');

    expect(ultimaResposta()).toBe('O assistente está sobrecarregado agora.');
    expect(input().disabled).toBe(false);
});

it('marcação vinda do modelo não vira elemento na tela', async () => {
    proximaResposta = streamDe([
        { tipo: 'delta', texto: 'Veja <img src=x onerror="window.__xss=1">' },
        { tipo: 'fim', motivo: 'completo' },
    ]);

    await perguntar('Teste');

    expect(document.querySelector('.msg-ai .msg-texto img')).toBeNull();
    expect(window.__xss).toBeUndefined();
});

it('chip de tema vira pergunta ao assistente', async () => {
    proximaResposta = streamDe([
        { tipo: 'delta', texto: 'No menu Meu Horário.' },
        { tipo: 'fim', motivo: 'completo' },
    ]);
    const chip = [...document.querySelectorAll('.chatbot-option-btn')].find(
        (b) => b.dataset.rotulo === 'Onde fica cada coisa no sistema?'
    );

    chip.click();
    for (let i = 0; i < 50 && input().disabled; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 20));

    expect(chamadas[0].corpo).toEqual({ mensagem: 'Onde fica cada coisa no sistema?' });
    expect(ultimaResposta()).toBe('No menu Meu Horário.');
});
