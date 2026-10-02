/**
 * vozesFemininas.test.js — Issue #564.
 *
 * O narrador ganhou vozes femininas. O que importa no servidor é que o nome
 * escolhido resolva no id certo e que, se a voz falhar no provedor, a troca
 * caia primeiro numa voz do MESMO gênero: quem escolheu Sarah e ouve Brian
 * acha que a escolha não pegou.
 */

const TTSService = require('../services/TTSService');

const IDS = {
    brian: 'nPczCjzI2devNBz1zQrb',
    sarah: 'EXAVITQu4vr4xnSDxMaL',
    alice: 'Xb7hH8MSUJpSbSDYk0k2',
};

let chaveOriginal;

beforeEach(() => {
    chaveOriginal = process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_KEY = 'chave-de-teste';
});

afterEach(() => {
    jest.restoreAllMocks();
    if (chaveOriginal === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = chaveOriginal;
});

describe('Vozes femininas do narrador', () => {
    it('o catálogo tem quatro vozes de cada gênero, sem expor ids do provedor', () => {
        const catalogo = TTSService.catalogo();
        expect(catalogo.filter((v) => v.genero === 'female')).toHaveLength(4);
        expect(catalogo.filter((v) => v.genero === 'male')).toHaveLength(4);
        for (const voz of catalogo) expect(Object.keys(voz).sort()).toEqual(['genero', 'nome']);
    });

    it('resolve "sarah" no id premade da Sarah', async () => {
        const espiao = jest
            .spyOn(TTSService, '_synthesizeElevenLabs')
            .mockResolvedValue({ buffer: Buffer.from('') });

        await TTSService.synthesizeWithVoice('Bom dia', 'sarah');
        expect(espiao).toHaveBeenCalledWith('Bom dia', IDS.sarah);
    });

    it('voz feminina indisponível cai em outra feminina antes de qualquer masculina', async () => {
        const tentadas = [];
        jest.spyOn(TTSService, '_synthesizeElevenLabs').mockImplementation(async (_t, id) => {
            tentadas.push(id);
            if (id === IDS.sarah) throw new Error('voice not found (404)');
            return { buffer: Buffer.from('') };
        });

        await TTSService.synthesizeWithVoice('Bom dia', 'sarah');

        // 1ª tentativa: a escolhida. Depois o fallback, que pula Sarah de novo
        // (404) e para na próxima feminina — nunca em Brian.
        expect(tentadas[0]).toBe(IDS.sarah);
        expect(tentadas.at(-1)).toBe(IDS.alice);
        expect(tentadas).not.toContain(IDS.brian);
    });

    it('sem gênero pedido, o fallback continua começando por Brian', async () => {
        const espiao = jest
            .spyOn(TTSService, '_synthesizeElevenLabs')
            .mockResolvedValue({ buffer: Buffer.from('') });

        await TTSService.synthesize('Bom dia');
        expect(espiao).toHaveBeenCalledWith('Bom dia', IDS.brian);
    });
});
