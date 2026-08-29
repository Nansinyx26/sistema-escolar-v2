/**
 * termoAudioImagemBarreira.test.js — Issue #118
 *
 * A cláusula 2.1 do Termo promete que "o envio da primeira mensagem de áudio ou
 * imagem no chat só é liberado após o aceite expresso". O aceite era
 * REGISTRADO, mas nunca EXIGIDO: nenhum middleware da rota de upload o
 * consultava, e quem chamasse o endpoint por fora do navegador enviava mídia
 * sem ter aceitado nada.
 *
 * O `js/termo-audio-imagem.js` já dizia no cabeçalho que a tela não é a
 * barreira e que "a barreira de verdade é do servidor". Estes testes cobrem
 * essa contraparte.
 */
jest.mock('../models/Usuario', () => ({ findById: jest.fn() }));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    alert: jest.fn(),
}));

const fs = require('node:fs');
const path = require('node:path');

const Usuario = require('../models/Usuario');
const exigirAceiteTermo = require('../middleware/exigirAceiteTermo');
const { TERMO_ID, TERMO_VERSAO, aceiteVigente } = require('../utils/termoAudioImagem');

/** `findById(...).select(...).lean()` — a cadeia que o middleware usa. */
function respondeComHistorico(lgpdHistory) {
    Usuario.findById.mockReturnValue({
        select: () => ({ lean: async () => (lgpdHistory === undefined ? null : { lgpdHistory }) }),
    });
}

function respostaFalsa() {
    const res = {
        statusCode: null,
        corpo: null,
        status(c) {
            res.statusCode = c;
            return res;
        },
        json(c) {
            res.corpo = c;
            return res;
        },
    };
    return res;
}

const aceiteDe = (versao, quando = '2026-01-01') => ({
    termoId: TERMO_ID,
    versao,
    aceitoEm: new Date(quando),
});

describe('barreira do Termo de áudio e imagem (Issue #118)', () => {
    const req = { user: { id: '507f1f77bcf86cd799439011' } };

    beforeEach(() => jest.clearAllMocks());

    test('sem aceite nenhum: 403 com código estável, e não segue para o upload', async () => {
        respondeComHistorico([]);
        const res = respostaFalsa();
        const next = jest.fn();

        await exigirAceiteTermo(req, res, next);

        expect(res.statusCode).toBe(403);
        expect(res.corpo.code).toBe('TERMO_NAO_ACEITO');
        expect(next).not.toHaveBeenCalled();
    });

    test('com aceite vigente: passa adiante', async () => {
        respondeComHistorico([aceiteDe(TERMO_VERSAO)]);
        const res = respostaFalsa();
        const next = jest.fn();

        await exigirAceiteTermo(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.statusCode).toBeNull();
    });

    test('aceite de versão ANTERIOR não vale — cláusula 2.4 pede novo aceite', async () => {
        respondeComHistorico([aceiteDe('0.9')]);
        const res = respostaFalsa();
        const next = jest.fn();

        await exigirAceiteTermo(req, res, next);

        expect(res.statusCode).toBe(403);
        expect(res.corpo.versao).toBe(TERMO_VERSAO); // diz qual versão falta
        expect(next).not.toHaveBeenCalled();
    });

    test('aceite de OUTRO termo não libera este', async () => {
        respondeComHistorico([
            { termoId: 'privacy_policy', versao: TERMO_VERSAO, aceitoEm: new Date() },
        ]);
        const res = respostaFalsa();
        const next = jest.fn();

        await exigirAceiteTermo(req, res, next);

        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('falha ao consultar o banco FECHA — 503, nunca deixa passar', async () => {
        Usuario.findById.mockReturnValue({
            select: () => ({
                lean: async () => {
                    throw new Error('banco fora');
                },
            }),
        });
        const res = respostaFalsa();
        const next = jest.fn();

        await exigirAceiteTermo(req, res, next);

        expect(res.statusCode).toBe(503);
        expect(res.corpo.code).toBe('TERMO_INDISPONIVEL');
        expect(next).not.toHaveBeenCalled();
    });

    test('sem identidade na requisição: 401, e não passa', async () => {
        const res = respostaFalsa();
        const next = jest.fn();

        await exigirAceiteTermo({ user: {} }, res, next);

        expect(res.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('aceiteVigente escolhe o registro mais recente da versão atual', () => {
        const escolhido = aceiteVigente([
            aceiteDe(TERMO_VERSAO, '2026-01-01'),
            aceiteDe('0.9', '2026-06-01'),
            aceiteDe(TERMO_VERSAO, '2026-03-01'),
        ]);

        expect(escolhido.aceitoEm).toEqual(new Date('2026-03-01'));
    });
});

describe('as rotas de mídia estão atrás da barreira (Issue #118)', () => {
    const RAIZ = path.join(__dirname, '..');
    const leia = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
    /**
     * Lê a cadeia de middlewares de uma rota a partir da fonte. Tolerante à
     * formatação — o Biome pode reagrupar os argumentos a qualquer momento, e o
     * que se afirma aqui é a ORDEM, não o recuo.
     */
    function cadeiaDaRota(fonte, caminhoDaRota) {
        const inicio = fonte.indexOf(`'${caminhoDaRota}'`);
        expect(inicio).toBeGreaterThan(-1);
        const daiPraFrente = fonte.slice(inicio);
        const fim = daiPraFrente.search(/async \(req, res\)|Controller\.|\)\s*;/);
        return daiPraFrente.slice(0, fim === -1 ? 400 : fim);
    }

    test('/chat-direto/upload exige o aceite ANTES do multer', () => {
        const cadeia = cadeiaDaRota(leia('routes/api.js'), '/chat-direto/upload');

        expect(cadeia).toContain('exigirAceiteTermo');
        // Antes de `receberAnexosChat`: recusar depois seria receber o arquivo
        // de quem não aceitou para então descartá-lo.
        expect(cadeia.indexOf('exigirAceiteTermo')).toBeLessThan(
            cadeia.indexOf('receberAnexosChat')
        );
    });

    test('/api/audio/upload exige o aceite ANTES do multer', () => {
        const cadeia = cadeiaDaRota(leia('routes/audio.js'), '/upload');

        expect(cadeia).toContain('exigirAceiteTermo');
        expect(cadeia.indexOf('exigirAceiteTermo')).toBeLessThan(cadeia.indexOf('audioUpload'));
    });
});
