/**
 * preferenciasVoz.test.js
 * POST /api/auth/settings/tts — persistência das preferências de narração.
 *
 * A tela de voz do copiloto envia NOME DE VOZ do provedor ('adam', 'brian',
 * 'eric', 'george') ou 'off'. O campo legado `voiceGender` do modelo tem
 * `enum: ['female','male']`, e o controller copiava `voicePreference` para lá
 * com `runValidators: true` — qualquer voz fora do enum reprovava o documento
 * e o update inteiro voltava 500, sem gravar NENHUMA das preferências.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../app');
const Usuario = require('../models/Usuario');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

async function sessao(perfil = 'diretor') {
    const user = await criarUsuario({ perfil });
    const token = jwt.sign(
        { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return { cookie: `escola_jwt=${token}`, user };
}

function salvar(cookie, corpo) {
    return request(app)
        .post('/api/auth/settings/tts')
        .set('Cookie', cookie)
        .send(corpo);
}

describe('POST /api/auth/settings/tts — vozes do provedor', () => {

    it('aceita nome de voz do provedor e grava em settings', async () => {
        const { cookie, user } = await sessao();

        const res = await salvar(cookie, {
            ttsProvider: 'elevenlabs',
            voicePreference: 'brian',
            elevenlabsVoice: 'brian'
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const salvo = await Usuario.findById(user._id).lean();
        expect(salvo.settings.elevenlabsVoice).toBe('brian');
        expect(salvo.settings.voicePreference).toBe('brian');
    });

    it('"off" desliga a narração sem derrubar o salvamento', async () => {
        const { cookie, user } = await sessao();

        const res = await salvar(cookie, { voicePreference: 'off', elevenlabsVoice: 'off' });

        expect(res.status).toBe(200);
        const salvo = await Usuario.findById(user._id).lean();
        expect(salvo.settings.elevenlabsVoice).toBe('off');
    });

    it('nome de voz NÃO contamina o campo legado de gênero', async () => {
        const { cookie, user } = await sessao();

        await salvar(cookie, { voicePreference: 'george', elevenlabsVoice: 'george' });

        const salvo = await Usuario.findById(user._id).lean();
        // Continua um valor do enum — 'george' iria reprovar na validação.
        expect(['male', 'female']).toContain(salvo.voiceGender);
    });

    it('ainda aceita o valor legado de gênero e o propaga ao campo antigo', async () => {
        const { cookie, user } = await sessao();

        await salvar(cookie, { voicePreference: 'female' });

        const salvo = await Usuario.findById(user._id).lean();
        expect(salvo.voiceGender).toBe('female');
    });

    it('grava a narração automática, inclusive quando desligada', async () => {
        const { cookie, user } = await sessao();

        await salvar(cookie, { narrarAuto: true });
        let salvo = await Usuario.findById(user._id).lean();
        expect(salvo.settings.narrarAuto).toBe(true);

        // `false` é valor legítimo: um `if (narrarAuto)` simples o descartaria
        // e a pessoa não conseguiria mais DESLIGAR a narração.
        await salvar(cookie, { narrarAuto: false });
        salvo = await Usuario.findById(user._id).lean();
        expect(salvo.settings.narrarAuto).toBe(false);
    });

    it('uma preferência não apaga as outras enviadas junto', async () => {
        const { cookie, user } = await sessao();

        const res = await salvar(cookie, {
            ttsProvider: 'elevenlabs',
            voicePreference: 'eric',
            elevenlabsVoice: 'eric',
            narrarAuto: true,
            speed: 1.2,
            narrationMode: 'texto_audio'
        });

        expect(res.status).toBe(200);
        const salvo = await Usuario.findById(user._id).lean();
        expect(salvo.settings.ttsProvider).toBe('elevenlabs');
        expect(salvo.settings.elevenlabsVoice).toBe('eric');
        expect(salvo.settings.narrarAuto).toBe(true);
        expect(salvo.settings.speed).toBe(1.2);
    });

    it('exige sessão', async () => {
        const res = await request(app)
            .post('/api/auth/settings/tts')
            .send({ voicePreference: 'adam' });

        expect(res.status).toBe(401);
    });
});
