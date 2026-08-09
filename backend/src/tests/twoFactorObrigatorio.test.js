/**
 * twoFactorObrigatorio.test.js — Tarefa 7
 *
 * Exigir segundo fator de uma conta administrativa é a operação com o pior
 * modo de falha do sistema: se der errado, NÃO HÁ ninguém dentro para desfazer.
 * Por isso o foco desta suíte não é "a ativação funciona", e sim "a ativação
 * se RECUSA a acontecer quando trancaria a conta para fora".
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const Usuario = require('../models/Usuario');
const politica = require('../utils/politica2FA');
const EnvioEmail = require('../services/EnvioEmail');

const ORIGINAL_PERFIS = process.env.PERFIS_2FA_OBRIGATORIO;
const ORIGINAL_DISPENSA = process.env.DISPENSAR_2FA_EMAIL;

let espiaoCanal;

async function sessaoAdmin() {
    const admin = await criarUsuario({ email: `adm_t7_${Date.now()}@escola.test`, perfil: 'admin' });
    return [`escola_jwt=${assinarTokenSessao(admin)}`];
}

/** Finge que o canal de e-mail está de pé (ou caído). */
function canalOperacional(ok) {
    espiaoCanal.mockResolvedValue(ok
        ? { ok: true, etapa: 'concluido', transporte: 'brevo-api', remetente: 'x <a@b.com>' }
        : { ok: false, etapa: 'conexao', transporte: 'brevo-api', erro: 'Provedor recusou a credencial.' });
}

beforeAll(async () => {
    await conectarBanco();
    // O canal real faria chamada de rede na suíte. O que importa testar aqui é
    // a DECISÃO tomada a partir do estado do canal, não o canal em si.
    espiaoCanal = jest.spyOn(EnvioEmail, 'verificarEnvio');
});
afterEach(async () => {
    await limparBanco();
    if (ORIGINAL_PERFIS === undefined) delete process.env.PERFIS_2FA_OBRIGATORIO;
    else process.env.PERFIS_2FA_OBRIGATORIO = ORIGINAL_PERFIS;
    if (ORIGINAL_DISPENSA === undefined) delete process.env.DISPENSAR_2FA_EMAIL;
    else process.env.DISPENSAR_2FA_EMAIL = ORIGINAL_DISPENSA;
});
afterAll(async () => { if (espiaoCanal) espiaoCanal.mockRestore(); await desconectarBanco(); });

describe('Política por configuração', () => {
    it('sem a variavel, o padrao preserva diretor e secretaria', () => {
        delete process.env.PERFIS_2FA_OBRIGATORIO;
        expect(politica.perfisComObrigatoriedade()).toEqual(['diretor', 'secretaria']);
        expect(politica.exigeSegundoFator({ perfil: 'diretor' })).toBe(true);
        expect(politica.exigeSegundoFator({ perfil: 'admin' })).toBe(false);
    });

    it('acrescentar admin passa a exigir 2FA do admin', () => {
        process.env.PERFIS_2FA_OBRIGATORIO = 'diretor,secretaria,admin';
        expect(politica.exigeSegundoFator({ perfil: 'admin' })).toBe(true);
    });

    it('variavel so com lixo VOLTA ao padrao, nao desliga', () => {
        // Desligar tem de ser explicito (DISPENSAR_2FA_EMAIL, que grita no
        // boot). Uma variavel mal preenchida nao pode afrouxar a politica em
        // silencio.
        for (const lixo of [' , , ', ',,,', '   ']) {
            process.env.PERFIS_2FA_OBRIGATORIO = lixo;
            expect(`${JSON.stringify(lixo)}:${politica.perfisComObrigatoriedade().join(',')}`)
                .toBe(`${JSON.stringify(lixo)}:diretor,secretaria`);
        }
    });

    it('a dispensa vence a obrigatoriedade por perfil', () => {
        process.env.PERFIS_2FA_OBRIGATORIO = 'admin';
        process.env.DISPENSAR_2FA_EMAIL = 'admin';
        expect(politica.exigeSegundoFator({ perfil: 'admin' })).toBe(false);
    });

    it('twoFactorEnabled na conta liga o 2FA sem mexer no perfil — e o rollout', () => {
        process.env.PERFIS_2FA_OBRIGATORIO = 'diretor';
        expect(politica.exigeSegundoFator({ perfil: 'admin', twoFactorEnabled: true })).toBe(true);
        expect(politica.exigeSegundoFator({ perfil: 'admin', twoFactorEnabled: false })).toBe(false);
    });
});

describe('Prontidão: a trava contra auto-trancamento', () => {
    it('recusa quando o canal de e-mail esta caido', async () => {
        canalOperacional(false);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'pront_canal@escola.test', perfil: 'admin' });

        const res = await request(app).get(`/api/admin/2fa/prontidao/${alvo._id}`).set('Cookie', cookies);

        expect(res.body.ok).toBe(false);
        expect(res.body.verificacoes.canalOperacional).toBe(false);
        expect(res.body.bloqueios.join(' ')).toContain('canal de e-mail');
    });

    it('a falta de codigos de backup e AVISO, nao bloqueio', async () => {
        // A ativacao gera o lote. Tratar a ausencia como bloqueio criava uma
        // armadilha: o admin geraria e IMPRIMIRIA um lote na primeira aba, e a
        // ativacao geraria outro — deixando na mao um papel de codigos mortos.
        canalOperacional(true);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'pront_semcod@escola.test', perfil: 'admin' });

        const res = await request(app).get(`/api/admin/2fa/prontidao/${alvo._id}`).set('Cookie', cookies);

        expect(res.body.ok).toBe(true);
        expect(res.body.bloqueios).toEqual([]);
        expect(res.body.verificacoes.codigosBackupDisponiveis).toBe(0);
        expect(res.body.avisos.join(' ')).toContain('ativação vai gerar');
    });

    it('ativar direto, sem lote previo, entrega codigos que FUNCIONAM', async () => {
        // O caminho que o roteiro manda seguir: nao gerar antes, ativar direto.
        canalOperacional(true);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'pront_direto@escola.test', perfil: 'admin' });

        const ativacao = await request(app).post(`/api/admin/2fa/ativar/${alvo._id}`).set('Cookie', cookies);
        expect(ativacao.body.codigos).toHaveLength(8);

        const login = await request(app).post('/api/auth/login')
            .send({ email: 'pront_direto@escola.test', senha: SENHA_TESTE });
        const pre = (login.headers['set-cookie'] || []).find(c => c.startsWith('escola_preauth'));
        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [pre.split(';')[0]]).send({ codigo: ativacao.body.codigos[0] });

        expect(res.status).toBe(200);
    });

    it('recusa quando a conta nao tem e-mail valido', async () => {
        canalOperacional(true);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'pront_mail@escola.test', perfil: 'admin' });
        await Usuario.updateOne({ _id: alvo._id }, { $set: { email: 'sem-arroba' } });

        const res = await request(app).get(`/api/admin/2fa/prontidao/${alvo._id}`).set('Cookie', cookies);

        expect(res.body.ok).toBe(false);
        expect(res.body.verificacoes.emailValido).toBe(false);
    });

    it('aprova quando as tres condicoes valem', async () => {
        canalOperacional(true);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'pront_ok@escola.test', perfil: 'admin' });
        await request(app).post(`/api/admin/2fa/backup-codes/${alvo._id}`).set('Cookie', cookies);

        const res = await request(app).get(`/api/admin/2fa/prontidao/${alvo._id}`).set('Cookie', cookies);

        expect(res.body.ok).toBe(true);
        expect(res.body.bloqueios).toEqual([]);
        expect(res.body.verificacoes.codigosBackupDisponiveis).toBe(8);
    });
});

describe('Ativação', () => {
    it('NAO ativa com o canal caido — o cenario de trancamento', async () => {
        canalOperacional(false);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'ativ_bloq@escola.test', perfil: 'admin' });

        const res = await request(app).post(`/api/admin/2fa/ativar/${alvo._id}`).set('Cookie', cookies);

        expect(res.status).toBe(409);
        // E, o mais importante: a conta continua entrando como entrava.
        const doc = await Usuario.findById(alvo._id).select('twoFactorEnabled').lean();
        expect(doc.twoFactorEnabled).toBe(false);
    });

    it('?forcar=true ativa mesmo com o canal caido, e registra que foi forcado', async () => {
        canalOperacional(false);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'ativ_forca@escola.test', perfil: 'admin' });

        const res = await request(app)
            .post(`/api/admin/2fa/ativar/${alvo._id}?forcar=true`).set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.forcado).toBe(true);
        expect(res.body.codigos).toHaveLength(8);
    });

    it('ativa e entrega os codigos de backup NA MESMA resposta', async () => {
        // Ativar sem entregar a rede de seguranca junto seria montar o cenario
        // de trancamento de proposito.
        canalOperacional(true);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'ativ_ok@escola.test', perfil: 'admin' });

        const res = await request(app).post(`/api/admin/2fa/ativar/${alvo._id}`).set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.codigos).toHaveLength(8);

        const doc = await Usuario.findById(alvo._id).select('twoFactorEnabled +twoFactorBackupCodes').lean();
        expect(doc.twoFactorEnabled).toBe(true);
        expect(doc.twoFactorBackupCodes).toHaveLength(8);
    });

    it('depois de ativar, o login do admin PASSA a exigir o segundo fator', async () => {
        canalOperacional(true);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'ativ_login@escola.test', perfil: 'admin' });

        const antes = await request(app).post('/api/auth/login')
            .send({ email: 'ativ_login@escola.test', senha: SENHA_TESTE });
        expect(antes.body.require2FA).toBe(false);

        await request(app).post(`/api/admin/2fa/ativar/${alvo._id}`).set('Cookie', cookies);

        const depois = await request(app).post('/api/auth/login')
            .send({ email: 'ativ_login@escola.test', senha: SENHA_TESTE });
        expect(depois.body.require2FA).toBe(true);
    });

    it('e o codigo de backup entregue na ativacao FUNCIONA de verdade', async () => {
        // A rede de seguranca so vale se tiver sido exercitada. Este e o teste
        // que separa "temos codigos" de "os codigos entram".
        canalOperacional(true);
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'ativ_bk@escola.test', perfil: 'admin' });

        const ativacao = await request(app).post(`/api/admin/2fa/ativar/${alvo._id}`).set('Cookie', cookies);
        const codigo = ativacao.body.codigos[0];

        const login = await request(app).post('/api/auth/login')
            .send({ email: 'ativ_bk@escola.test', senha: SENHA_TESTE });
        const pre = (login.headers['set-cookie'] || []).find(c => c.startsWith('escola_preauth'));

        const res = await request(app).post('/api/auth/2fa/verify')
            .set('Cookie', [pre.split(';')[0]]).send({ codigo });

        expect(res.status).toBe(200);
        expect(res.body.usouCodigoBackup).toBe(true);
    });

    it('desativar avisa quando o PERFIL ainda obriga', async () => {
        // Sem esse aviso, o admin acha que desligou e descobre o contrario no
        // proximo login.
        canalOperacional(true);
        process.env.PERFIS_2FA_OBRIGATORIO = 'diretor';
        const cookies = await sessaoAdmin();
        const alvo = await criarUsuario({ email: 'desat_perfil@escola.test', perfil: 'diretor' });

        const res = await request(app).delete(`/api/admin/2fa/ativar/${alvo._id}`).set('Cookie', cookies);

        expect(res.body.ok).toBe(true);
        expect(res.body.aindaExigePorPerfil).toBe(true);
        expect(res.body.mensagem).toContain('CONTINUA exigindo');
    });

    it('so admin ativa ou desativa', async () => {
        const diretor = await criarUsuario({ email: 'ativ_self@escola.test', perfil: 'diretor' });
        const cookiesDiretor = [`escola_jwt=${assinarTokenSessao(diretor)}`];

        const post = await request(app).post(`/api/admin/2fa/ativar/${diretor._id}`).set('Cookie', cookiesDiretor);
        const del = await request(app).delete(`/api/admin/2fa/ativar/${diretor._id}`).set('Cookie', cookiesDiretor);
        const pront = await request(app).get(`/api/admin/2fa/prontidao/${diretor._id}`).set('Cookie', cookiesDiretor);

        expect(post.status).toBe(403);
        expect(del.status).toBe(403);
        expect(pront.status).toBe(403);
    });
});
