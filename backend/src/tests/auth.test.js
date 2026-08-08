/**
 * auth.test.js
 * Suite 1 — Autenticação, 2FA e Brute-Force
 */

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');

const app     = require('../app');
const Usuario = require('../models/Usuario');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE, SENHA_TESTE_NOVA, CODIGO_ESCOLA_TESTE } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

function postLogin(body) {
    return request(app)
        .post('/api/auth/login')
        .send(body);
}

// ─────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {

    it('deve retornar 401 para credenciais inexistentes', async () => {
        const res = await postLogin({ email: 'naoexiste@escola.test', senha: 'qualquer' });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('deve retornar 401 para senha incorreta', async () => {
        await criarUsuario({ email: 'senhaerrada@escola.test' });
        const res = await postLogin({ email: 'senhaerrada@escola.test', senha: 'SenhaErrada' });
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
    });

    it('deve retornar 401 para conta inativa', async () => {
        await criarUsuario({ email: 'inativo@escola.test', ativo: false });
        const res = await postLogin({ email: 'inativo@escola.test', senha: SENHA_TESTE });
        expect(res.status).toBe(401);
    });

    // ─────────────────────────────────────────────────────────
    // Contrato de resposta: o cliente reage a `codigo`, nunca ao texto.
    // Um teste que casasse com a mensagem transformaria o texto em API e
    // impediria traduzir a interface sem quebrar a lógica do front.
    // ─────────────────────────────────────────────────────────
    it('senha errada devolve codigo CREDENCIAL_INVALIDA', async () => {
        await criarUsuario({ email: 'contrato-senha@escola.test' });
        const res = await postLogin({ email: 'contrato-senha@escola.test', senha: 'ErradaDeProposito1' });

        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('CREDENCIAL_INVALIDA');
        expect(res.body.ok).toBe(false);
        expect(res.body.success).toBe(false);
    });

    it('usuario inexistente devolve exatamente a mesma resposta — sem oraculo de existencia', async () => {
        const inexistente = await postLogin({ email: 'nunca-existiu@escola.test', senha: 'QualquerCoisa1' });
        await criarUsuario({ email: 'existe@escola.test' });
        const senhaErrada = await postLogin({ email: 'existe@escola.test', senha: 'QualquerCoisa1' });

        expect(inexistente.status).toBe(senhaErrada.status);
        expect(inexistente.body).toEqual(senhaErrada.body);
    });

    it('2FA pendente e 200 com require2FA, canal e destino mascarado', async () => {
        await criarUsuario({ email: 'contrato2fa@escola.test', perfil: 'diretor' });
        const res = await postLogin({ email: 'contrato2fa@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.require2FA).toBe(true);
        expect(res.body.canal).toBe('email');
        expect(res.body.destinoMascarado).toBe('co***@escola.test');
        // O endereço completo nao volta ao cliente antes do segundo fator.
        expect(JSON.stringify(res.body)).not.toContain('contrato2fa@escola.test');
    });

    it('deve emitir cookie JWT para credenciais validas (sem 2FA)', async () => {
        await criarUsuario({ email: 'valido@escola.test' });
        const res = await postLogin({ email: 'valido@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.requires2FA).toBe(false);
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('deve conter nome e perfil do usuario na resposta', async () => {
        await criarUsuario({ email: 'info@escola.test', nome: 'Prof Tester', perfil: 'professor' });
        const res = await postLogin({ email: 'info@escola.test', senha: SENHA_TESTE });

        expect(res.body.user.nome).toBe('Prof Tester');
        expect(res.body.user.perfil).toBe('professor');
        // Senha nunca deve vazar
        expect(JSON.stringify(res.body)).not.toMatch(/\$2[ab]\$/);
    });

    it('deve retornar redirect_to para professor sem 2FA', async () => {
        await criarUsuario({ email: 'redirect@escola.test', perfil: 'professor' });
        const res = await postLogin({ email: 'redirect@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        // Path real do dashboard (o antigo '/dashboard.html' caía no catch-all → landing page)
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
    });

    it('deve exigir 2FA para secretaria e retornar redirect_to no login', async () => {
        await criarUsuario({ email: 'secretaria@escola.test', perfil: 'secretaria' });
        const res = await postLogin({ email: 'secretaria@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.requires2FA).toBe(true);
        // Secretaria vai direto ao seu painel dedicado
        expect(res.body.redirect_to).toBe('/html/secretaria/painel.html');
        // SEGURANÇA: o userId NÍO é mais devolvido — o alvo do 2FA vem do
        // cookie de pré-autenticação, não de um id exposto na resposta.
        expect(res.body.userId).toBeUndefined();
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_preauth'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// Brute-Force — bloqueio após 5 tentativas incorretas
// O controller bloqueia na 5a tentativa (loginAttempts >= 5)
// então a 5a tentativa já retorna 403
// ─────────────────────────────────────────────────────────
describe('Brute-Force: bloqueio de conta', () => {

    it('deve gravar lockUntil apos 5 tentativas incorretas', async () => {
        await criarUsuario({ email: 'bruteforce@escola.test' });

        // O controller bloqueia na 5a tentativa (loginAttempts >= 5)
        for (let i = 0; i < 5; i++) {
            await postLogin({ email: 'bruteforce@escola.test', senha: 'Errada' });
        }

        // O bloqueio é observável no BANCO...
        const usuario = await Usuario.findOne({ email: 'bruteforce@escola.test' });
        expect(usuario.lockUntil).toBeTruthy();
        expect(usuario.lockUntil.getTime()).toBeGreaterThan(Date.now());
    });

    it('NAO revela o bloqueio para quem erra a senha (anti-enumeracao)', async () => {
        const usuario = await criarUsuario({ email: 'bloqueado-silencioso@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, {
            lockUntil: new Date(Date.now() + 15 * 60 * 1000)
        });

        // ...mas NAO é revelado a quem não prova conhecer a senha: um 403
        // 'conta bloqueada' aqui confirmaria que a conta existe usando apenas
        // senhas erradas. A resposta é idêntica à de credencial inválida.
        const res = await postLogin({ email: 'bloqueado-silencioso@escola.test', senha: 'Errada' });
        expect(res.status).toBe(401);
    });

    it('deve rejeitar login com conta ja bloqueada mesmo com senha correta', async () => {
        const usuario = await criarUsuario({ email: 'bloqueado@escola.test' });

        await Usuario.findByIdAndUpdate(usuario._id, {
            lockUntil: new Date(Date.now() + 10 * 60 * 1000),
            loginAttempts: 0
        });

        const res = await postLogin({ email: 'bloqueado@escola.test', senha: SENHA_TESTE });

        // 429, não 403: o bloqueio é limitação de TAXA, não falta de permissão.
        // O cliente reage ao `codigo`, nunca ao texto da mensagem.
        expect(res.status).toBe(429);
        expect(res.body.codigo).toBe('MUITAS_TENTATIVAS');
        expect(res.body.ok).toBe(false);
        expect(res.body.retryEmSegundos).toBeGreaterThan(0);
        expect(res.headers['retry-after']).toBeDefined();
    });
});

// ─────────────────────────────────────────────────────────
// 2FA — fluxo de dois fatores
// ─────────────────────────────────────────────────────────
describe('2FA: fluxo de dois fatores', () => {

    it('deve retornar requires2FA=true para usuario com 2FA ativo', async () => {
        const usuario = await criarUsuario({ email: '2fa@escola.test' });
        // Garante que o update foi persistido antes do login
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true }, { new: true });
        // Verifica que o campo foi salvo
        const salvo = await Usuario.findById(usuario._id);
        expect(salvo.twoFactorEnabled).toBe(true);

        const res = await postLogin({ email: '2fa@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.requires2FA).toBe(true);
        // userId não é mais exposto; o pré-auth é entregue via cookie HttpOnly
        expect(res.body.userId).toBeUndefined();
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(false);
        expect(cookies.some(c => c.startsWith('escola_preauth'))).toBe(true);
    });

    // Extrai o cookie escola_preauth de uma resposta de login para reenviá-lo
    // no /2fa/verify — o novo fluxo não aceita mais userId no corpo.
    function preauthCookie(loginRes) {
        return (loginRes.headers['set-cookie'] || [])
            .filter(c => c.startsWith('escola_preauth'))
            .map(c => c.split(';')[0]);
    }

    it('deve verificar codigo 2FA correto e emitir cookie JWT', async () => {
        const usuario = await criarUsuario({ email: '2fa_verify@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true });

        // 1. Login (senha) → gera o pré-auth e o token pendente
        const login = await postLogin({ email: '2fa_verify@escola.test', senha: SENHA_TESTE });
        const cookies = preauthCookie(login);
        expect(cookies.length).toBeGreaterThan(0);

        // 2. Injeta um código conhecido (o real seria enviado por e-mail)
        const codigo = '123456';
        const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() + 5 * 60 * 1000)
        });

        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Cookie', cookies)
            .send({ codigo });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        const setCookies = res.headers['set-cookie'] || [];
        expect(setCookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('deve rejeitar /2fa/verify sem pre-auth cookie (userId no corpo não basta)', async () => {
        const usuario = await criarUsuario({ email: '2fa_nopre@escola.test' });
        const codigoHash = crypto.createHash('sha256').update('123456').digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorEnabled: true,
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() + 5 * 60 * 1000)
        });

        // Ataque antigo: conhecer o _id e forçar o código, sem passar pela senha
        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .send({ userId: usuario._id, codigo: '123456' });

        expect(res.status).toBe(401);
    });

    it('deve rejeitar codigo 2FA incorreto com 401', async () => {
        const usuario = await criarUsuario({ email: '2fa_wrong@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true });

        const login = await postLogin({ email: '2fa_wrong@escola.test', senha: SENHA_TESTE });
        const cookies = preauthCookie(login);

        const codigoHash = crypto.createHash('sha256').update('000000').digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() + 5 * 60 * 1000)
        });

        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Cookie', cookies)
            .send({ codigo: '999999' });

        expect(res.status).toBe(401);
    });

    it('deve rejeitar codigo 2FA expirado com 401', async () => {
        const usuario = await criarUsuario({ email: '2fa_expired@escola.test' });
        await Usuario.findByIdAndUpdate(usuario._id, { twoFactorEnabled: true });

        const login = await postLogin({ email: '2fa_expired@escola.test', senha: SENHA_TESTE });
        const cookies = preauthCookie(login);

        const codigoHash = crypto.createHash('sha256').update('123456').digest('hex');
        await Usuario.findByIdAndUpdate(usuario._id, {
            twoFactorPendingToken: codigoHash,
            twoFactorPendingExpiry: new Date(Date.now() - 1000) // ja expirou
        });

        const res = await request(app)
            .post('/api/auth/2fa/verify')
            .set('Cookie', cookies)
            .send({ codigo: '123456' });

        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {

    it('deve limpar cookie escola_jwt e retornar success', async () => {
        const res = await request(app).post('/api/auth/logout');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const cookies = res.headers['set-cookie'] || [];
        const jwtCookie = cookies.find(c => c.startsWith('escola_jwt'));
        expect(jwtCookie).toBeTruthy();
        expect(jwtCookie).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);
    });

    // ─────────────────────────────────────────────────────
    // O ponto central: limpar o cookie NÃO basta. O token precisa morrer
    // no SERVIDOR, senão qualquer cópia dele (header Authorization, log de
    // proxy, máquina compartilhada) continua autenticando até o exp de 8h.
    // ─────────────────────────────────────────────────────
    it('deve INVALIDAR o token no servidor, nao apenas limpar o cookie', async () => {
        await criarUsuario({ email: 'logout-revoga@escola.test' });
        const login = await postLogin({ email: 'logout-revoga@escola.test', senha: SENHA_TESTE });
        expect(login.status).toBe(200);

        // Captura a cópia do token, como um atacante faria.
        const tokenCopiado = (login.headers['set-cookie'] || [])
            .find(c => c.startsWith('escola_jwt'))
            .split(';')[0]
            .split('=')[1];

        // Antes do logout a cópia funciona.
        const antes = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${tokenCopiado}`);
        expect(antes.status).toBe(200);

        await request(app)
            .post('/api/auth/logout')
            .set('Cookie', `escola_jwt=${tokenCopiado}`);

        // Depois do logout a MESMA cópia deve ser rejeitada.
        const depois = await request(app)
            .get('/api/auth/me')
            .set('Authorization', `Bearer ${tokenCopiado}`);
        expect(depois.status).toBe(401);
    });

    it('logout de um dispositivo NAO derruba a sessao dos outros', async () => {
        await criarUsuario({ email: 'logout-multi@escola.test' });

        const pegarToken = async () => {
            const r = await postLogin({ email: 'logout-multi@escola.test', senha: SENHA_TESTE });
            return (r.headers['set-cookie'] || [])
                .find(c => c.startsWith('escola_jwt')).split(';')[0].split('=')[1];
        };

        const tokenCelular = await pegarToken();
        const tokenDesktop = await pegarToken();

        await request(app).post('/api/auth/logout').set('Cookie', `escola_jwt=${tokenCelular}`);

        // A revogação é por `jti`, então é cirúrgica: só a sessão deslogada cai.
        const celular = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenCelular}`);
        expect(celular.status).toBe(401);

        const desktop = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenDesktop}`);
        expect(desktop.status).toBe(200);
    });
});

// ─────────────────────────────────────────────────────────
// Senha em texto puro (caminho legado removido)
// ─────────────────────────────────────────────────────────
describe('Senhas legadas sem bcrypt', () => {

    it('NAO permite login com senha em texto puro no banco', async () => {
        const usuario = await criarUsuario({ email: 'legado@escola.test' });
        // Simula um registro pré-bcrypt: senha gravada em claro.
        await Usuario.updateOne({ _id: usuario._id }, { $set: { senha: 'SenhaEmTextoPuro123' } });

        const res = await postLogin({ email: 'legado@escola.test', senha: 'SenhaEmTextoPuro123' });

        // Antes isso logava e "migrava" a senha. Agora é recusado: aceitar um
        // valor lido direto do banco transforma qualquer leitura do Mongo
        // (backup, dump, injection) em credencial válida.
        expect(res.status).toBe(401);
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(false);
    });

    it('nao converte a senha legada em bcrypt as escondidas', async () => {
        const usuario = await criarUsuario({ email: 'legado2@escola.test' });
        await Usuario.updateOne({ _id: usuario._id }, { $set: { senha: 'OutroTextoPuro456' } });

        await postLogin({ email: 'legado2@escola.test', senha: 'OutroTextoPuro456' });

        // A conta continua intocada — a correção é rodar a migração explícita,
        // não deixar o próprio login "consertar" ao primeiro acerto.
        const depois = await Usuario.findById(usuario._id).select('+senha');
        expect(depois.senha).toBe('OutroTextoPuro456');
    });
});

// ─────────────────────────────────────────────────────────
// Anti-enumeração de usuário
// ─────────────────────────────────────────────────────────
describe('Enumeracao de usuario', () => {

    it('conta inexistente e senha errada devolvem resposta IDENTICA', async () => {
        await criarUsuario({ email: 'existe@escola.test' });

        const inexistente = await postLogin({ email: 'naoexiste@escola.test', senha: 'Errada123' });
        const senhaErrada = await postLogin({ email: 'existe@escola.test', senha: 'Errada123' });

        // Mesmo status E mesma mensagem: sem isso dá para varrer e-mails
        // válidos sem nunca acertar uma senha.
        expect(inexistente.status).toBe(senhaErrada.status);
        expect(inexistente.body.error).toBe(senhaErrada.body.error);
    });

    it('conta inativa nao se distingue de conta inexistente', async () => {
        await criarUsuario({ email: 'inativa-enum@escola.test', ativo: false });

        const inativa = await postLogin({ email: 'inativa-enum@escola.test', senha: SENHA_TESTE });
        const inexistente = await postLogin({ email: 'sumiu@escola.test', senha: SENHA_TESTE });

        expect(inativa.status).toBe(inexistente.status);
        expect(inativa.body.error).toBe(inexistente.body.error);
    });
});

// ─────────────────────────────────────────────────────────
// Vazamento de PII na resposta
// ─────────────────────────────────────────────────────────
describe('Minimizacao de dados na resposta', () => {

    it('/api/auth/me NAO devolve hash de senha nem campos de controle', async () => {
        await criarUsuario({ email: 'pii@escola.test' });
        const login = await postLogin({ email: 'pii@escola.test', senha: SENHA_TESTE });
        const cookie = (login.headers['set-cookie'] || [])
            .find(c => c.startsWith('escola_jwt')).split(';')[0];

        const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.user.senha).toBeUndefined();
        expect(res.body.user.tokenVersion).toBeUndefined();
        expect(res.body.user.lockUntil).toBeUndefined();
        expect(res.body.user.resetToken).toBeUndefined();
        expect(res.body.user.twoFactorPendingToken).toBeUndefined();
        // Nenhum valor da resposta pode parecer um hash bcrypt
        expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$\d{2}\$/);
    });

    it('resposta do login NAO carrega hash de senha', async () => {
        await criarUsuario({ email: 'pii-login@escola.test' });
        const res = await postLogin({ email: 'pii-login@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$\d{2}\$/);
    });
});
