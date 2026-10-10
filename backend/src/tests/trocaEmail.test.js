/**
 * trocaEmail.test.js — Issue #609 (épico #608)
 *
 * Desde a #571 ninguém trocava o próprio e-mail. Agora a troca existe, com três
 * provas: a senha atual no pedido, a posse do endereço novo (o link só chega
 * lá) e a confirmação na mesma conta, logada. Confirmada, tudo que apontava
 * para o endereço antigo — fichas de aluno, bloqueio judicial, autorizações,
 * fichas de equipe — passa para o novo.
 */
jest.mock('../services/EnvioEmail', () => ({
    ...jest.requireActual('../services/EnvioEmail'),
    enviarEmail: jest.fn(),
}));

const request = require('supertest');
const app = require('../app');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const Autorizacao = require('../models/Autorizacao');
const Professor = require('../models/Professor');
const SolicitacaoVinculo = require('../models/SolicitacaoVinculo');
const AuditLog = require('../models/AuditLog');
const { enviarEmail } = require('../services/EnvioEmail');
const { hashDoToken, VALIDADE_HORAS } = require('../services/trocaEmail');
const { restritoPara } = require('../utils/restricaoAcesso');
const { assinarTokenSessao } = require('../utils/sessionToken');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

const ANTIGO = 'mae.antigo@familia.test';
const NOVO = 'mae.novo@familia.test';

let conta;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    enviarEmail.mockReset();
    enviarEmail.mockResolvedValue({ ok: true });
    conta = await criarUsuario({ email: ANTIGO, perfil: 'responsavel', nome: 'Mãe Teste' });
});

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];

const pedir = (cookies, corpo) =>
    request(app).post('/api/auth/email/solicitar-troca').set('Cookie', cookies).send(corpo);
const confirmar = (cookies, token) =>
    request(app).post('/api/auth/email/confirmar-troca').set('Cookie', cookies).send({ token });

/** O token sai só no e-mail mandado ao endereço novo. */
function tokenEnviadoPara(endereco) {
    const chamada = enviarEmail.mock.calls.find(([para]) => para === endereco);
    if (!chamada) return null;
    const achado = /confirmar-email\.html#token=([a-f0-9]{64})/.exec(chamada[2]);
    return achado ? achado[1] : null;
}

async function pedirComSucesso(alvo = conta, novo = NOVO) {
    const res = await pedir(cookieDe(alvo), { novoEmail: novo, senhaAtual: SENHA_TESTE });
    expect(res.status).toBe(200);
    const token = tokenEnviadoPara(novo);
    expect(token).toBeTruthy();
    return token;
}

const lerConta = (id = conta._id) =>
    Usuario.findById(id)
        .select('+emailTrocaPendente +emailTrocaTokenHash +emailTrocaExpiry')
        .lean();

describe('pedido da troca', () => {
    it('envia o link só para o endereço novo e guarda apenas o hash do token', async () => {
        const antes = Date.now();
        const res = await pedir(cookieDe(conta), {
            novoEmail: '  Mae.Novo@Familia.TEST ',
            senhaAtual: SENHA_TESTE,
        });

        expect(res.status).toBe(200);
        expect(enviarEmail).toHaveBeenCalledTimes(1);
        const token = tokenEnviadoPara(NOVO);
        expect(token).toMatch(/^[a-f0-9]{64}$/);

        const salvo = await lerConta();
        expect(salvo.email).toBe(ANTIGO);
        expect(salvo.emailTrocaPendente).toBe(NOVO);
        expect(salvo.emailTrocaTokenHash).toBe(hashDoToken(token));
        expect(salvo.emailTrocaTokenHash).not.toContain(token);
        const validade = new Date(salvo.emailTrocaExpiry).getTime() - antes;
        expect(validade).toBeGreaterThan((VALIDADE_HORAS * 3600 - 60) * 1000);
        expect(validade).toBeLessThanOrEqual(VALIDADE_HORAS * 3600 * 1000 + 5000);

        expect(await AuditLog.exists({ acao: 'EMAIL_TROCA_SOLICITADA' })).toBeTruthy();
    });

    it('senha atual errada → 400, sem link, com auditoria', async () => {
        const res = await pedir(cookieDe(conta), { novoEmail: NOVO, senhaAtual: 'Errada#2026' });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('SENHA_ATUAL_INCORRETA');
        expect(enviarEmail).not.toHaveBeenCalled();
        expect((await lerConta()).emailTrocaTokenHash).toBeUndefined();
        expect(await AuditLog.exists({ acao: 'EMAIL_TROCA_SENHA_INCORRETA' })).toBeTruthy();
    });

    it('conta criada pelo Google não troca: o login dela acha a conta pelo e-mail', async () => {
        await Usuario.updateOne({ _id: conta._id }, { $set: { loginGoogle: true } });

        const res = await pedir(cookieDe(conta), { novoEmail: NOVO, senhaAtual: SENHA_TESTE });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('CONTA_GOOGLE');
        expect(enviarEmail).not.toHaveBeenCalled();
    });

    it.each([
        ['sem @', 'mae.familia.test', 'EMAIL_INVALIDO'],
        ['vazio', '', 'EMAIL_INVALIDO'],
        ['o mesmo de agora', ANTIGO.toUpperCase(), 'EMAIL_IGUAL'],
    ])('e-mail %s → 400', async (_caso, novoEmail, codigo) => {
        const res = await pedir(cookieDe(conta), { novoEmail, senhaAtual: SENHA_TESTE });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe(codigo);
        expect(enviarEmail).not.toHaveBeenCalled();
    });

    it('sem a senha atual → 400', async () => {
        const res = await pedir(cookieDe(conta), { novoEmail: NOVO });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('SENHA_ATUAL_OBRIGATORIA');
    });

    it('sem sessão → 401', async () => {
        const res = await request(app)
            .post('/api/auth/email/solicitar-troca')
            .send({ novoEmail: NOVO, senhaAtual: SENHA_TESTE });

        expect(res.status).toBe(401);
    });

    it.each([
        ['mesma grafia', NOVO],
        ['outra caixa, de cadastro antigo', NOVO.toUpperCase()],
    ])(
        'endereço de outra conta (%s): resposta igual à de sucesso, nenhum link',
        async (_caso, cadastrado) => {
            await Usuario.collection.insertOne({
                email: cadastrado,
                nome: 'Outra Pessoa',
                perfil: 'responsavel',
                ativo: true,
            });
            const livre = await pedir(cookieDe(await criarUsuario({ perfil: 'responsavel' })), {
                novoEmail: 'livre@familia.test',
                senhaAtual: SENHA_TESTE,
            });
            enviarEmail.mockClear();

            const res = await pedir(cookieDe(conta), { novoEmail: NOVO, senhaAtual: SENHA_TESTE });

            expect(res.status).toBe(200);
            expect(res.body).toEqual(livre.body);
            expect(enviarEmail).not.toHaveBeenCalled();
            expect((await lerConta()).emailTrocaTokenHash).toBeUndefined();
        }
    );

    it('o /me diz se a conta entra pelo Google, para a tela explicar antes do pedido', async () => {
        await Usuario.updateOne({ _id: conta._id }, { $set: { loginGoogle: true } });

        const me = await request(app).get('/api/auth/me').set('Cookie', cookieDe(conta));

        expect(me.body.user.loginGoogle).toBe(true);
    });

    it('falha no envio → 503 e o pedido não fica pendurado', async () => {
        enviarEmail.mockResolvedValue({ ok: false, etapa: 'transporte' });

        const res = await pedir(cookieDe(conta), { novoEmail: NOVO, senhaAtual: SENHA_TESTE });

        expect(res.status).toBe(503);
        expect((await lerConta()).emailTrocaTokenHash).toBeUndefined();
    });

    it('os campos do pedido não saem em resposta nenhuma', async () => {
        await pedirComSucesso();

        const me = await request(app).get('/api/auth/me').set('Cookie', cookieDe(conta));
        const doc = await Usuario.findById(conta._id).select(
            '+emailTrocaPendente +emailTrocaTokenHash +emailTrocaExpiry'
        );

        for (const campo of ['emailTrocaPendente', 'emailTrocaTokenHash', 'emailTrocaExpiry']) {
            expect(me.body.user).not.toHaveProperty(campo);
            expect(doc.toJSON()).not.toHaveProperty(campo);
        }
    });
});

describe('confirmação da troca', () => {
    it('só pedir não troca nada', async () => {
        await pedirComSucesso();

        expect((await lerConta()).email).toBe(ANTIGO);
    });

    it('troca o e-mail, derruba as outras sessões, entrega sessão nova e avisa o endereço antigo', async () => {
        const token = await pedirComSucesso();
        const sessaoAntiga = cookieDe(conta);
        enviarEmail.mockClear();

        const res = await confirmar(cookieDe(conta), token);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(NOVO);
        const salvo = await lerConta();
        expect(salvo.email).toBe(NOVO);
        expect(salvo.emailVerificado).toBe(true);
        expect(salvo.tokenVersion).toBe((conta.tokenVersion || 0) + 1);
        expect(salvo.emailTrocaTokenHash).toBeUndefined();
        expect(salvo.emailTrocaPendente).toBeUndefined();

        // A sessão de antes não vale mais; a emitida na resposta já é do e-mail novo.
        expect((await request(app).get('/api/auth/me').set('Cookie', sessaoAntiga)).status).toBe(
            401
        );
        const novaSessao = (res.headers['set-cookie'] || [])
            .map((c) => c.split(';')[0])
            .filter((c) => c.startsWith('escola_jwt='));
        expect(novaSessao).toHaveLength(1);
        const me = await request(app).get('/api/auth/me').set('Cookie', novaSessao);
        expect(me.status).toBe(200);
        expect(me.body.user.email).toBe(NOVO);

        expect(enviarEmail).toHaveBeenCalledTimes(1);
        const [para, , html] = enviarEmail.mock.calls[0];
        expect(para).toBe(ANTIGO);
        expect(html).not.toContain(NOVO);

        const log = await AuditLog.findOne({ acao: 'EMAIL_TROCADO' }).lean();
        expect(log).toBeTruthy();
        expect(JSON.stringify(log.detalhes)).not.toContain(NOVO);
    });

    it('o link pedido por uma conta não serve em outra', async () => {
        const token = await pedirComSucesso();
        const outra = await criarUsuario({ perfil: 'responsavel' });

        const res = await confirmar(cookieDe(outra), token);

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('LINK_INVALIDO');
        expect((await lerConta()).email).toBe(ANTIGO);
        expect((await lerConta(outra._id)).email).toBe(outra.email);
        expect(await AuditLog.exists({ acao: 'EMAIL_TROCA_CONFIRMACAO_RECUSADA' })).toBeTruthy();
    });

    it('link vencido → 400', async () => {
        const token = await pedirComSucesso();
        await Usuario.updateOne(
            { _id: conta._id },
            { $set: { emailTrocaExpiry: new Date(Date.now() - 1000) } }
        );

        const res = await confirmar(cookieDe(conta), token);

        expect(res.status).toBe(400);
        expect((await lerConta()).email).toBe(ANTIGO);
    });

    it('o link vale uma vez só', async () => {
        const token = await pedirComSucesso();
        const primeira = await confirmar(cookieDe(conta), token);
        const novaSessao = primeira.headers['set-cookie'].map((c) => c.split(';')[0]);

        const segunda = await confirmar(novaSessao, token);

        expect(primeira.status).toBe(200);
        expect(segunda.status).toBe(400);
    });

    it('pedido novo invalida o link anterior', async () => {
        const primeiro = await pedirComSucesso(conta, NOVO);
        await pedirComSucesso(conta, 'outro.novo@familia.test');

        const res = await confirmar(cookieDe(conta), primeiro);

        expect(res.status).toBe(400);
        expect((await lerConta()).email).toBe(ANTIGO);
    });

    it('token fora do formato → 400 sem consultar nada', async () => {
        await pedirComSucesso();

        const res = await confirmar(cookieDe(conta), { $ne: null });

        expect(res.status).toBe(400);
        expect((await lerConta()).email).toBe(ANTIGO);
    });

    it('endereço tomado entre o pedido e a confirmação → 409, e a conta fica como estava', async () => {
        const token = await pedirComSucesso();
        await criarUsuario({ email: NOVO, perfil: 'responsavel' });

        const res = await confirmar(cookieDe(conta), token);

        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('EMAIL_EM_USO');
        const salvo = await lerConta();
        expect(salvo.email).toBe(ANTIGO);
        expect(salvo.emailTrocaTokenHash).toBeUndefined();
    });
});

describe('vínculos acompanham a troca', () => {
    const OUTRO_RESPONSAVEL = 'pai@familia.test';

    it('fichas de aluno, bloqueio judicial, autorizações e pedidos pendentes passam para o novo', async () => {
        const filho = await Aluno.create({
            nome: 'Filho',
            turma: '1A',
            escolaId: 'escola-a',
            // Ficha antiga, digitada com maiúsculas.
            responsavel: ANTIGO.toUpperCase(),
            responsavelDados: { nome: 'Mãe', email: ANTIGO },
            responsaveis: [
                { nome: 'Mãe', email: ANTIGO },
                { nome: 'Pai', email: OUTRO_RESPONSAVEL },
            ],
        });
        const bloqueado = await Aluno.create({
            nome: 'Enteado',
            turma: '2B',
            escolaId: 'escola-b',
            responsaveis: [{ nome: 'Mãe', email: ANTIGO }],
            restricoesAcesso: [{ email: ANTIGO }, { email: 'terceiro@familia.test' }],
        });
        const alheio = await Aluno.create({
            nome: 'De outra família',
            turma: '1A',
            escolaId: 'escola-a',
            responsavel: OUTRO_RESPONSAVEL,
        });
        await Autorizacao.create({
            escolaId: 'escola-a',
            alunoId: String(filho._id),
            responsavelId: conta._id,
            responsavelEmail: ANTIGO,
            tipoAutorizacao: 'atividadesFisicas',
        });
        await SolicitacaoVinculo.create({
            escolaId: 'escola-a',
            alunoId: String(alheio._id),
            solicitanteId: 'alguem',
            solicitanteEmail: OUTRO_RESPONSAVEL,
            email: ANTIGO,
        });
        const token = await pedirComSucesso();

        const res = await confirmar(cookieDe(conta), token);

        expect(res.status).toBe(200);
        const f = await Aluno.findById(filho._id).lean();
        expect(f.responsavel).toBe(NOVO);
        expect(f.responsavelDados.email).toBe(NOVO);
        expect(f.responsaveis.map((r) => r.email)).toEqual([NOVO, OUTRO_RESPONSAVEL]);

        // O bloqueio judicial segue valendo — agora para o endereço novo.
        const b = await Aluno.findById(bloqueado._id).lean();
        expect(b.restricoesAcesso.map((r) => r.email)).toEqual([NOVO, 'terceiro@familia.test']);
        expect(restritoPara(b, NOVO)).toBe(true);

        expect((await Aluno.findById(alheio._id).lean()).responsavel).toBe(OUTRO_RESPONSAVEL);
        expect((await Autorizacao.findOne({}).lean()).responsavelEmail).toBe(NOVO);
        expect((await SolicitacaoVinculo.findOne({}).lean()).email).toBe(NOVO);
    });

    it('a ficha de equipe da conta acompanha o e-mail', async () => {
        const professora = await criarUsuario({
            email: 'prof.antigo@escola.test',
            perfil: 'professor',
        });
        await Professor.create({
            idUsuario: String(professora._id),
            nome: professora.nome,
            email: professora.email,
            vinculos: [{ escolaId: 'escola-a', cargo: 'professor' }],
        });
        await Professor.create({
            idUsuario: 'outra-pessoa',
            nome: 'Outra Professora',
            email: 'outra@escola.test',
        });
        const token = await pedirComSucesso(professora, 'prof.novo@escola.test');

        const res = await confirmar(cookieDe(professora), token);

        expect(res.status).toBe(200);
        const fichas = await Professor.find({}).sort({ nome: 1 }).lean();
        expect(fichas.map((p) => p.email).sort()).toEqual([
            'outra@escola.test',
            'prof.novo@escola.test',
        ]);
    });

    it('pedido pendente repetido para o endereço novo: o antigo sai, o novo fica', async () => {
        const aluno = await Aluno.create({ nome: 'A', turma: '1A', escolaId: 'escola-a' });
        const base = {
            escolaId: 'escola-a',
            alunoId: String(aluno._id),
            solicitanteId: 'alguem',
            solicitanteEmail: OUTRO_RESPONSAVEL,
        };
        await SolicitacaoVinculo.create({ ...base, email: ANTIGO });
        await SolicitacaoVinculo.create({ ...base, email: NOVO });
        const token = await pedirComSucesso();

        const res = await confirmar(cookieDe(conta), token);

        expect(res.status).toBe(200);
        const pendentes = await SolicitacaoVinculo.find({ status: 'pendente' }).lean();
        expect(pendentes.map((p) => p.email)).toEqual([NOVO]);
    });
});

// Issue #754: as fichas apontam para o e-mail antigo. Quem nunca provou ser
// dono dele — criou a conta com o e-mail de outra família e não confirmou —
// não leva os filhos dela ao trocar para um endereço próprio.
describe('conta que não provou o e-mail antigo', () => {
    async function naoConfirmada(extra = {}) {
        const c = await criarUsuario({
            email: 'mae.vitima@familia.test',
            perfil: 'responsavel',
            emailVerificado: false,
            ...extra,
        });
        await Usuario.collection.updateOne(
            { _id: c._id },
            { $set: { createdAt: new Date('2026-10-01T00:00:00Z') } }
        );
        return c;
    }

    it('troca o login, mas as fichas do endereço antigo ficam onde estão', async () => {
        const atacante = await naoConfirmada();
        const filho = await Aluno.create({
            nome: 'Filho da vítima',
            turma: '5A',
            escolaId: 'escola-a',
            responsavel: 'mae.vitima@familia.test',
        });
        const token = await pedirComSucesso(atacante, 'atacante@familia.test');

        const res = await confirmar(cookieDe(atacante), token);

        expect(res.status).toBe(200);
        expect((await Aluno.findById(filho._id).lean()).responsavel).toBe(
            'mae.vitima@familia.test'
        );
        const lista = await request(app)
            .get('/api/responsavel/alunos')
            .set(
                'Cookie',
                res.headers['set-cookie'].map((c) => c.split(';')[0])
            );
        expect(JSON.stringify(lista.body)).not.toContain('Filho da vítima');

        const auditoria = await AuditLog.findOne({ acao: 'EMAIL_TROCADO' }).lean();
        expect(auditoria.detalhes?.descricao || JSON.stringify(auditoria)).toMatch(/NÃO migrados/);
    });

    it('conta do autocadastro da equipe ainda não confirmada também não migra', async () => {
        const conta716 = await naoConfirmada({
            perfil: 'professor',
            confirmacaoEmailObrigatoria: true,
        });
        await Professor.create({ nome: 'Ficha', email: 'mae.vitima@familia.test' });
        // A sessão desta conta é recusada pelo authJWT (#716): o pedido nem
        // chega. Garantia extra no serviço: sem prova, nada migra.
        const res = await pedir(cookieDe(conta716), {
            novoEmail: 'outro@familia.test',
            senhaAtual: SENHA_TESTE,
        });
        expect(res.status).toBe(403);
        expect((await Professor.findOne({}).lean()).email).toBe('mae.vitima@familia.test');
    });
});
