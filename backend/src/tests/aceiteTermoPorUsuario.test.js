/**
 * aceiteTermoPorUsuario.test.js — o aceite é do TITULAR, nunca do dispositivo.
 *
 * O DEFEITO RELATADO
 * ------------------
 * "Quando o diretor aceita os termos, essa informação passa a valer para as
 * outras contas (professor, secretaria)." Na mesma máquina, o professor entrava
 * depois e a tela de aceite não aparecia para ele.
 *
 * A gravação sempre foi por usuário: `registrarAceite` escreve em
 * `Usuario.lgpdHistory` do `_id` que veio do JWT, e `consultarAceite` lê o
 * documento desse mesmo `_id`. O que estava compartilhado era a RESPOSTA HTTP —
 * a URL `/api/moderacao/aceite-termo` é igual para todo mundo e nenhuma
 * resposta de `/api` trazia `Cache-Control`, então o navegador reaproveitava a
 * do diretor para a conta seguinte (corrigido em `backend/src/app.js`,
 * `js/termo-audio-imagem.js` e `js/api-config.js`).
 *
 * Estes testes travam a metade que mora no controller: a consulta e a gravação
 * têm de endereçar a conta autenticada e mais nenhuma. Se alguém trocar o
 * `idDe(req)` por um estado de módulo, um cache por versão do Termo ou qualquer
 * coisa "global", é aqui que quebra.
 */
jest.mock('../models/Usuario', () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock('../utils/auditHelper', () => ({ logAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    alert: jest.fn(),
}));

const Usuario = require('../models/Usuario');
const ModeracaoController = require('../controllers/ModeracaoController');
const { TERMO_ID, TERMO_VERSAO } = require('../utils/termoAudioImagem');
const { CONSENTIMENTO_ID, CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');

const ID_DIRETOR = '507f1f77bcf86cd799439011';
const ID_PROFESSOR = '507f1f77bcf86cd799439022';

/** O banco fake: um documento por `_id`, como no Mongo de verdade. */
function bancoCom(documentosPorId) {
    Usuario.findById.mockImplementation((id) => ({
        select: () => ({ lean: async () => documentosPorId[String(id)] || null }),
    }));
}

function requisicaoDe(usuarioId, perfil) {
    return {
        user: { id: usuarioId, perfil },
        ip: '203.0.113.7',
        headers: { 'user-agent': 'jest' },
        body: {},
    };
}

function respostaFalsa() {
    const res = {
        statusCode: 200,
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

const assinaturaDoTermo = {
    termoId: TERMO_ID,
    versao: TERMO_VERSAO,
    aceitoEm: new Date('2026-02-10T12:00:00Z'),
};

const assinaturaDoConsentimento = {
    termoId: CONSENTIMENTO_ID,
    versao: CONSENTIMENTO_VERSAO,
    aceitoEm: new Date('2026-02-10T12:00:00Z'),
};

beforeEach(() => {
    jest.clearAllMocks();
    Usuario.updateOne.mockResolvedValue({ acknowledged: true });
});

describe('GET /api/moderacao/aceite-termo — o aceite não vaza entre contas', () => {
    it('devolve aceito para o diretor que assinou e pendente para o professor que não assinou', async () => {
        bancoCom({
            [ID_DIRETOR]: { lgpdHistory: [assinaturaDoTermo, assinaturaDoConsentimento] },
            [ID_PROFESSOR]: { lgpdHistory: [] },
        });

        const resDiretor = respostaFalsa();
        await ModeracaoController.consultarAceite(requisicaoDe(ID_DIRETOR, 'diretor'), resDiretor);

        const resProfessor = respostaFalsa();
        await ModeracaoController.consultarAceite(
            requisicaoDe(ID_PROFESSOR, 'professor'),
            resProfessor
        );

        expect(resDiretor.corpo.data.aceito).toBe(true);
        expect(resDiretor.corpo.data.consentimentoLgpd.aceito).toBe(true);

        // A conta do professor continua pendente — é o que faz o modal aparecer
        // para ele mesmo depois de o diretor ter aceitado no mesmo navegador.
        expect(resProfessor.corpo.data.aceito).toBe(false);
        expect(resProfessor.corpo.data.consentimentoLgpd.aceito).toBe(false);
    });

    it('consulta pelo id da conta autenticada, e não por perfil nem por escola', async () => {
        bancoCom({ [ID_PROFESSOR]: { lgpdHistory: [] } });

        await ModeracaoController.consultarAceite(
            requisicaoDe(ID_PROFESSOR, 'professor'),
            respostaFalsa()
        );

        expect(Usuario.findById).toHaveBeenCalledTimes(1);
        expect(Usuario.findById).toHaveBeenCalledWith(ID_PROFESSOR);
    });

    it('a conta sem documento no banco aparece como pendente, não como aceita', async () => {
        // Falha para o lado de PEDIR o aceite: uma leitura que não encontrou
        // nada não é prova de consentimento.
        bancoCom({});

        const res = respostaFalsa();
        await ModeracaoController.consultarAceite(requisicaoDe(ID_PROFESSOR, 'professor'), res);

        expect(res.corpo.data.aceito).toBe(false);
        expect(res.corpo.data.consentimentoLgpd.aceito).toBe(false);
    });
});

describe('POST /api/moderacao/aceite-termo — grava na conta que assinou', () => {
    it('escreve o aceite no _id do professor e não toca em outra conta', async () => {
        bancoCom({
            [ID_DIRETOR]: { lgpdHistory: [assinaturaDoTermo, assinaturaDoConsentimento] },
            [ID_PROFESSOR]: { lgpdHistory: [] },
        });

        const res = respostaFalsa();
        await ModeracaoController.registrarAceite(requisicaoDe(ID_PROFESSOR, 'professor'), res);

        expect(res.statusCode).toBe(201);
        expect(Usuario.updateOne).toHaveBeenCalledTimes(1);

        const [filtro, atualizacao] = Usuario.updateOne.mock.calls[0];
        expect(filtro).toEqual({ _id: ID_PROFESSOR });

        const assinaturas = atualizacao.$push.lgpdHistory.$each;
        expect(assinaturas.map((a) => a.termoId).sort()).toEqual(
            [CONSENTIMENTO_ID, TERMO_ID].sort()
        );
        expect(atualizacao.$set.consentimentoVersao).toBe(CONSENTIMENTO_VERSAO);
    });

    it('não reaproveita a assinatura do diretor: a do professor é gravada do zero', async () => {
        bancoCom({
            [ID_DIRETOR]: { lgpdHistory: [assinaturaDoTermo, assinaturaDoConsentimento] },
            [ID_PROFESSOR]: { lgpdHistory: [] },
        });

        // O diretor assina de novo: idempotente, nada a gravar.
        await ModeracaoController.registrarAceite(
            requisicaoDe(ID_DIRETOR, 'diretor'),
            respostaFalsa()
        );
        expect(Usuario.updateOne).not.toHaveBeenCalled();

        // O professor assina: agora há gravação, e é na conta dele.
        await ModeracaoController.registrarAceite(
            requisicaoDe(ID_PROFESSOR, 'professor'),
            respostaFalsa()
        );
        expect(Usuario.updateOne).toHaveBeenCalledTimes(1);
        expect(Usuario.updateOne.mock.calls[0][0]).toEqual({ _id: ID_PROFESSOR });
    });

    it('a resposta do aceite descreve a conta que acabou de assinar', async () => {
        bancoCom({ [ID_PROFESSOR]: { lgpdHistory: [] } });

        const res = respostaFalsa();
        await ModeracaoController.registrarAceite(requisicaoDe(ID_PROFESSOR, 'professor'), res);

        expect(res.corpo.data.aceito).toBe(true);
        expect(res.corpo.data.versao).toBe(TERMO_VERSAO);
        expect(res.corpo.data.aceitoEm).toBeInstanceOf(Date);
        expect(res.corpo.data.consentimentoLgpd.aceito).toBe(true);
    });
});
