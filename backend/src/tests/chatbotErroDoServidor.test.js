/**
 * chatbotErroDoServidor.test.js
 *
 * O chatbot só lia o corpo quando `res.ok`; um 403 de
 * IA_DESLIGADA_NESTA_ESCOLA (Issue #401) virava "Não consegui processar sua
 * pergunta." e o usuário via só um 403 no console. Agora a mensagem do
 * servidor chega ao chat.
 */

const fs = require('node:fs');
const path = require('node:path');

const ARQUIVO = path.resolve(__dirname, '../../../js/chatbot-ia.js');
const src = fs.readFileSync(ARQUIVO, 'utf8');

function textoDaFuncao(nome) {
    const inicio = src.indexOf(`async function ${nome}(`);
    if (inicio < 0) throw new Error(`chatbot-ia.js não declara ${nome}`);
    let profundidade = 0;
    let fim = src.indexOf('{', inicio);
    for (; fim < src.length; fim++) {
        if (src[fim] === '{') profundidade++;
        if (src[fim] === '}' && --profundidade === 0) break;
    }
    return src.slice(inicio, fim + 1);
}

// eslint-disable-next-line no-new-func
const mensagemDeErro = new Function(`${textoDaFuncao('mensagemDeErro')}; return mensagemDeErro;`)();

const resposta = (status, corpo) => ({
    status,
    json: async () => {
        if (corpo === undefined) throw new SyntaxError('sem JSON');
        return corpo;
    },
});

describe('mensagemDeErro do chatbot', () => {
    it('mostra o motivo do servidor quando a IA está desligada na escola', async () => {
        const { RESPOSTA_DESLIGADA } = require('../services/ia/interruptor');
        expect(await mensagemDeErro(resposta(403, RESPOSTA_DESLIGADA))).toBe(
            RESPOSTA_DESLIGADA.error
        );
    });

    it('sem corpo JSON, cai num texto por status', async () => {
        expect(await mensagemDeErro(resposta(403))).toMatch(/acesso/);
        expect(await mensagemDeErro(resposta(401))).toMatch(/sessão/);
        expect(await mensagemDeErro(resposta(429))).toMatch(/Aguarde/);
    });

    it('erro desconhecido devolve null e o chat usa o texto genérico', async () => {
        expect(await mensagemDeErro(resposta(500))).toBeNull();
    });

    it('os dois envios do chat usam a mensagem do servidor', () => {
        expect(src.match(/responseText = await mensagemDeErro\(res\)/g)).toHaveLength(2);
    });
});
