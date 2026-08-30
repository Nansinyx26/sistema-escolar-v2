/**
 * vozBrianPadrao.test.js — Brian é a voz do assistente da escola.
 *
 * A narração passa por quatro pontos independentes, e basta UM continuar em
 * 'adam' para a pessoa ouvir a voz errada sem que nada quebre:
 *
 *   1. o modelo `Usuario`, que define a preferência de quem nunca escolheu;
 *   2. o `TTSService`, que resolve o nome da voz no id do provedor;
 *   3. a rota `/api/tts/speak`, quando o corpo não traz `voiceId`;
 *   4. a página do assistente, que normaliza o valor salvo no navegador.
 *
 * Por isso o teste cobre os quatro, e não só o serviço.
 */

const fs = require('node:fs');
const path = require('node:path');

const Usuario = require('../models/Usuario');
const TTSService = require('../services/TTSService');

const RAIZ = path.join(__dirname, '..', '..', '..');

/** Lê um arquivo do front-end como texto — ali não há require possível. */
function fonte(relativo) {
    return fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
}

describe('Voz padrão da narração', () => {
    it('nasce em Brian para quem nunca escolheu uma voz', () => {
        const novo = new Usuario({ nome: 'Fulano', email: 'f@escola.test', senha: 'x' });
        expect(novo.settings.elevenlabsVoice).toBe('brian');
    });

    it('resolve o nome "brian" no id premade do provedor', async () => {
        // A chamada só passa da barreira de credencial com a chave presente; o
        // que este teste mede é o ID escolhido, não a integração com o provedor.
        const chaveOriginal = process.env.ELEVENLABS_API_KEY;
        process.env.ELEVENLABS_API_KEY = 'chave-de-teste';

        const espiao = jest
            .spyOn(TTSService, '_synthesizeElevenLabs')
            .mockResolvedValue({ buffer: Buffer.from('') });

        try {
            await TTSService.synthesizeWithVoice('Bom dia');
            expect(espiao).toHaveBeenCalledWith('Bom dia', 'nPczCjzI2devNBz1zQrb');
        } finally {
            espiao.mockRestore();
            if (chaveOriginal === undefined) delete process.env.ELEVENLABS_API_KEY;
            else process.env.ELEVENLABS_API_KEY = chaveOriginal;
        }
    });

    it('narra em Brian quando o corpo da requisição não pede voz nenhuma', () => {
        // A rota exige autenticação e banco; o que importa aqui é o padrão
        // literal, e ele precisa aparecer no arquivo para valer em produção.
        expect(fonte('backend/src/routes/tts.js')).toContain("voiceId || 'brian'");
    });

    it('cai em Brian ao normalizar preferência antiga ou inválida do navegador', () => {
        const pagina = fonte('js/ia/pagina-ia-assistant.js');
        expect(pagina).toContain("if (v === 'female' || v === 'male') return 'brian';");
        expect(pagina).not.toMatch(/return 'adam';/);
    });

    it('deixa a narração automática ligada na página do assistente', () => {
        // A tela inteira é um orb de voz: uma resposta só escrita entrega
        // metade do que a página promete.
        expect(fonte('js/ia/pagina-ia-assistant.js')).toContain(
            "(localStorage.getItem('user_narrar_auto') ?? '1') !== '0'"
        );
    });

    it('oferece Brian como primeira opção nas telas de preferência', () => {
        const html = fonte('html/direcao/ia-assistant.html');
        expect(html.indexOf('value="brian"')).toBeLessThan(html.indexOf('value="adam"'));

        const gaveta = fonte('js/settings-drawer.js');
        expect(gaveta.indexOf('value="brian"')).toBeLessThan(gaveta.indexOf('value="adam"'));
    });
});
