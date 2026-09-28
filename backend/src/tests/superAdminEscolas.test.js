/**
 * superAdminEscolas.test.js — gestão de escolas do admin (Issues #463 e #533).
 *
 * Cobre os critérios de aceite:
 *   • diretor e professor recebem 403 em /api/superadmin/*; todo admin passa;
 *   • bloquear → o usuário da escola não loga, a sessão aberta cai no próximo
 *     request e os sockets da escola são desconectados;
 *   • desbloquear → o usuário loga normalmente, sem reinício;
 *   • o super admin nunca é barrado e acessa a escola bloqueada;
 *   • listagem com busca, filtro, paginação e contagens; auditoria de tudo.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const escolaBloqueio = require('../services/escolaBloqueio');
const { rotasAdminPara } = require('../utils/rotasFront');

const MOTIVO = 'Inadimplência contratual com a rede';

let escolaA;
let escolaB;
let escolaC;
let superAdmin;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escolaBloqueio.invalidarCache();
    escolaA = await Escola.create({
        nome: 'EMEF Alfa',
        tipo: 'EMEF',
        bairro: 'Centro',
        municipio: 'Americana',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'CIEP Beta',
        tipo: 'CIEP',
        bairro: 'Jardim',
        municipio: 'Americana',
        ativo: true,
    });
    escolaC = await Escola.create({
        nome: 'EMEF Gama',
        tipo: 'EMEF',
        bairro: 'Vila',
        municipio: 'Nova Odessa',
        ativo: true,
    });
    superAdmin = await criarUsuario({
        email: 'super@rede.test',
        perfil: 'admin',
        superAdmin: true,
        nome: 'Super Admin',
    });
});

/** Loga pela rota real e devolve um agent com JWT + sessão. */
async function logar(email, extra = {}) {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE, ...extra });
    return { agent, res };
}

async function professorDa(escola, email) {
    const user = await criarUsuario({ email, perfil: 'professor', escolaId: String(escola._id) });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    return user;
}

async function superAdminLogado() {
    const { agent, res } = await logar('super@rede.test');
    expect(res.status).toBe(200);
    return agent;
}

// ─────────────────────────────────────────────────────────
// 1. Autorização
// ─────────────────────────────────────────────────────────
describe('/api/superadmin — só o admin passa', () => {
    it('401 sem sessão', async () => {
        const res = await request(app).get('/api/superadmin/escolas');
        expect(res.status).toBe(401);
    });

    it.each([
        ['diretor', { perfil: 'diretor' }],
        ['professor', { perfil: 'professor' }],
        ['diretor com superAdmin forjado no token', { perfil: 'diretor' }],
    ])('%s recebe 403 na listagem e no bloqueio', async (_rotulo, dados) => {
        const conta = await criarUsuario({
            email: `nao-super-${Date.now()}@rede.test`,
            escolaId: String(escolaA._id),
            ...dados,
        });
        const { assinarTokenSessao } = require('../utils/sessionToken');
        // Claims do token são ignorados: o authJWT lê o perfil do BANCO.
        const cookie = `escola_jwt=${assinarTokenSessao(conta, { superAdmin: true })}`;

        const lista = await request(app).get('/api/superadmin/escolas').set('Cookie', cookie);
        expect(lista.status).toBe(403);

        const bloqueio = await request(app)
            .patch(`/api/superadmin/escolas/${escolaB._id}/bloquear`)
            .set('Cookie', cookie)
            .send({ motivo: MOTIVO });
        expect(bloqueio.status).toBe(403);
        expect((await Escola.findById(escolaB._id).lean()).status).toBe('ativa');
    });

    it('admin sem a flag superAdmin gerencia a rede (Issue #533)', async () => {
        const conta = await criarUsuario({ email: 'comum@rede.test', perfil: 'admin' });
        const { assinarTokenSessao } = require('../utils/sessionToken');
        const cookie = `escola_jwt=${assinarTokenSessao(conta)}`;

        const lista = await request(app).get('/api/superadmin/escolas').set('Cookie', cookie);
        expect(lista.status).toBe(200);
        expect(lista.body.data).toHaveLength(3);
    });

    it('a flag superAdmin não vem da criação de conta', async () => {
        const admin = await criarUsuario({ email: 'comum@rede.test', perfil: 'admin' });
        const { assinarTokenSessao } = require('../utils/sessionToken');
        await request(app)
            .post('/api/usuarios')
            .set('Cookie', `escola_jwt=${assinarTokenSessao(admin)}`)
            .send({
                nome: 'Plantado',
                email: 'plantado@rede.test',
                senha: SENHA_TESTE,
                telefone: '(19) 99999-0000',
                perfil: 'admin',
                superAdmin: true,
            });
        const plantado = await Usuario.findOne({ email: 'plantado@rede.test' }).lean();
        if (plantado) expect(plantado.superAdmin).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────
// 2. Listagem e detalhe
// ─────────────────────────────────────────────────────────
describe('GET /api/superadmin/escolas', () => {
    beforeEach(async () => {
        await Escola.updateOne(
            { _id: escolaC._id },
            { $set: { status: 'bloqueada', motivoBloqueio: MOTIVO, bloqueadaEm: new Date() } }
        );
        await criarUsuario({ email: 'u1@a.test', escolaId: String(escolaA._id) });
        await criarUsuario({ email: 'u2@a.test', escolaId: String(escolaA._id) });
        await mongoose.connection.collection('alunos').insertMany([
            { nome: 'Aluno 1', escolaId: String(escolaA._id), ativo: true },
            { nome: 'Aluno 2', escolaId: String(escolaA._id), ativo: true },
            { nome: 'Aluno inativo', escolaId: String(escolaA._id), ativo: false },
        ]);
    });

    it('lista TODAS as escolas, inclusive as bloqueadas, com contagens', async () => {
        const agent = await superAdminLogado();
        const res = await agent.get('/api/superadmin/escolas');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
        expect(res.body.resumo).toEqual({ todas: 3, ativas: 2, bloqueadas: 1, aguardando: 0 });

        const alfa = res.body.data.find((e) => e.nome === 'EMEF Alfa');
        expect(alfa.status).toBe('ativa');
        expect(alfa.usuarios).toBe(2);
        expect(alfa.alunos).toBe(2);
        expect(alfa.codigoSecreto).toBeUndefined();

        const gama = res.body.data.find((e) => e.nome === 'EMEF Gama');
        expect(gama.status).toBe('bloqueada');
        expect(gama.motivoBloqueio).toBe(MOTIVO);
    });

    it('filtra por status e busca por nome ou cidade', async () => {
        const agent = await superAdminLogado();

        const bloqueadas = await agent.get('/api/superadmin/escolas?status=bloqueada');
        expect(bloqueadas.body.data.map((e) => e.nome)).toEqual(['EMEF Gama']);

        const ativas = await agent.get('/api/superadmin/escolas?status=ativa');
        expect(ativas.body.data.map((e) => e.nome).sort()).toEqual(['CIEP Beta', 'EMEF Alfa']);

        const porCidade = await agent.get('/api/superadmin/escolas?busca=odessa');
        expect(porCidade.body.data.map((e) => e.nome)).toEqual(['EMEF Gama']);

        const porNome = await agent.get('/api/superadmin/escolas?busca=beta');
        expect(porNome.body.data.map((e) => e.nome)).toEqual(['CIEP Beta']);

        // Busca com metacaractere de regex não quebra nem vira curinga.
        const regex = await agent.get(`/api/superadmin/escolas?busca=${encodeURIComponent('.*')}`);
        expect(regex.status).toBe(200);
        expect(regex.body.data).toHaveLength(0);
    });

    it('pagina ordenado por nome', async () => {
        const agent = await superAdminLogado();
        const p1 = await agent.get('/api/superadmin/escolas?limite=2&pagina=1');
        const p2 = await agent.get('/api/superadmin/escolas?limite=2&pagina=2');
        expect(p1.body.data.map((e) => e.nome)).toEqual(['CIEP Beta', 'EMEF Alfa']);
        expect(p2.body.data.map((e) => e.nome)).toEqual(['EMEF Gama']);
        expect(p1.body.paginacao).toMatchObject({ total: 3, totalPaginas: 2 });
    });

    it('escola sem o campo status (anterior à migração) conta como ativa', async () => {
        await mongoose.connection
            .collection('escolas')
            .updateOne({ _id: escolaB._id }, { $unset: { status: '' } });
        const agent = await superAdminLogado();
        const res = await agent.get('/api/superadmin/escolas?status=ativa');
        expect(res.body.data.map((e) => e.nome)).toContain('CIEP Beta');
    });

    it('detalhe devolve contagem por perfil; id inválido é 400 e inexistente 404', async () => {
        const agent = await superAdminLogado();
        const ok = await agent.get(`/api/superadmin/escolas/${escolaA._id}`);
        expect(ok.status).toBe(200);
        expect(ok.body.data.usuariosPorPerfil.professor).toBe(2);
        expect((await agent.get('/api/superadmin/escolas/xyz')).status).toBe(400);
        expect(
            (await agent.get(`/api/superadmin/escolas/${new mongoose.Types.ObjectId()}`)).status
        ).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────
// 3. Bloqueio e desbloqueio
// ─────────────────────────────────────────────────────────
describe('PATCH bloquear / desbloquear', () => {
    it('exige motivo', async () => {
        const agent = await superAdminLogado();
        for (const corpo of [
            {},
            { motivo: '' },
            { motivo: '   ' },
            { motivo: 'abc' },
            { motivo: 123 },
        ]) {
            const res = await agent
                .patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`)
                .send(corpo);
            expect(res.status).toBe(400);
            expect(res.body.codigo).toBe('MOTIVO_OBRIGATORIO');
        }
        expect((await Escola.findById(escolaA._id).lean()).status).toBe('ativa');
    });

    it('registra quem e quando, audita, e recusa bloquear duas vezes', async () => {
        const agent = await superAdminLogado();
        const res = await agent
            .patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`)
            .send({ motivo: MOTIVO });
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('bloqueada');
        expect(res.body.data.bloqueadaPor.nome).toBe('Super Admin');

        const escola = await Escola.findById(escolaA._id).lean();
        expect(escola.status).toBe('bloqueada');
        expect(escola.motivoBloqueio).toBe(MOTIVO);
        expect(escola.bloqueadaPor).toBe(String(superAdmin._id));
        expect(escola.bloqueadaEm).toBeInstanceOf(Date);

        const log = await AuditLog.findOne({ acao: 'ESCOLA_BLOQUEADA' }).lean();
        expect(log.escolaId).toBe(String(escolaA._id));
        expect(String(log.usuarioId)).toBe(String(superAdmin._id));
        expect(log.detalhes.valorNovo.motivoBloqueio).toBe(MOTIVO);

        const repetido = await agent
            .patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`)
            .send({ motivo: MOTIVO });
        expect(repetido.status).toBe(409);

        const desbloqueio = await agent.patch(`/api/superadmin/escolas/${escolaA._id}/desbloquear`);
        expect(desbloqueio.status).toBe(200);
        const depois = await Escola.findById(escolaA._id).lean();
        expect(depois.status).toBe('ativa');
        expect(depois.motivoBloqueio).toBeUndefined();
        expect(depois.desbloqueadaPor).toBe(String(superAdmin._id));
        expect(await AuditLog.countDocuments({ acao: 'ESCOLA_DESBLOQUEADA' })).toBe(1);

        const detalhe = await agent.get(`/api/superadmin/escolas/${escolaA._id}`);
        expect(detalhe.body.data.historico.map((h) => h.acao)).toEqual([
            'ESCOLA_DESBLOQUEADA',
            'ESCOLA_BLOQUEADA',
        ]);

        const naoBloqueada = await agent.patch(
            `/api/superadmin/escolas/${escolaA._id}/desbloquear`
        );
        expect(naoBloqueada.status).toBe(409);
    });

    it('bloquear → usuário não loga e a sessão aberta cai; desbloquear → loga de novo', async () => {
        await professorDa(escolaA, 'prof-alfa@escola.test');
        await Turma.create({
            id: '1A',
            nome: '1A',
            ano: 1,
            escolaId: String(escolaA._id),
            ativo: true,
        });

        // Sessão aberta ANTES do bloqueio.
        const { agent: prof, res: loginAntes } = await logar('prof-alfa@escola.test');
        expect(loginAntes.status).toBe(200);
        expect((await prof.get('/api/turmas')).status).toBe(200);

        const sa = await superAdminLogado();
        await sa.patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`).send({ motivo: MOTIVO });

        // A sessão aberta cai no próximo request, com o código estável.
        const derrubada = await prof.get('/api/turmas');
        expect(derrubada.status).toBe(403);
        expect(derrubada.body.codigo).toBe('ESCOLA_BLOQUEADA');
        expect(derrubada.body.error).toBe(
            'Escola temporariamente bloqueada. Contate o administrador.'
        );
        // E não volta: o token foi revogado, não só recusado.
        const depois = await prof.get('/api/auth/me');
        expect(depois.status).toBe(401);

        // Login novo é recusado com a mensagem clara.
        const { res: loginBloqueado } = await logar('prof-alfa@escola.test');
        expect(loginBloqueado.status).toBe(403);
        expect(loginBloqueado.body.codigo).toBe('ESCOLA_BLOQUEADA');
        expect(loginBloqueado.body.error).toBe(
            'Escola temporariamente bloqueada. Contate o administrador.'
        );

        // Desbloqueio vale na hora, sem reinício.
        await sa.patch(`/api/superadmin/escolas/${escolaA._id}/desbloquear`);
        const { agent: prof2, res: loginDepois } = await logar('prof-alfa@escola.test');
        expect(loginDepois.status).toBe(200);
        expect((await prof2.get('/api/turmas')).status).toBe(200);
    });

    it('bloquear uma escola não afeta as outras', async () => {
        await professorDa(escolaB, 'prof-beta@escola.test');
        const sa = await superAdminLogado();
        await sa.patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`).send({ motivo: MOTIVO });
        const { res } = await logar('prof-beta@escola.test');
        expect(res.status).toBe(200);
    });

    it('conta sem vínculo, só com escolaId no cadastro (ex.: responsável), também é barrada', async () => {
        await criarUsuario({
            email: 'resp@familia.test',
            perfil: 'responsavel',
            escolaId: String(escolaA._id),
        });
        const sa = await superAdminLogado();
        await sa.patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`).send({ motivo: MOTIVO });
        const { res } = await logar('resp@familia.test', { portal: 'responsavel' });
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('ESCOLA_BLOQUEADA');
    });

    it('troca de escola para uma bloqueada é recusada', async () => {
        const user = await criarUsuario({ email: 'duplo@escola.test', perfil: 'professor' });
        await Professor.create({
            idUsuario: String(user._id),
            nome: user.nome,
            email: 'duplo@escola.test',
            vinculos: [
                { escolaId: String(escolaA._id), cargo: 'professor' },
                { escolaId: String(escolaB._id), cargo: 'professor' },
            ],
            ativo: true,
        });
        const { agent } = await logar('duplo@escola.test', { escolaId: String(escolaB._id) });
        const sa = await superAdminLogado();
        await sa.patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`).send({ motivo: MOTIVO });

        const troca = await agent.post(`/api/escolas/trocar/${escolaA._id}`);
        expect(troca.status).toBe(403);
        expect(troca.body.codigo).toBe('ESCOLA_BLOQUEADA');

        // Com várias escolas, a bloqueada sai do seletor do login.
        const { res } = await logar('duplo@escola.test');
        expect(res.status).toBe(200);
        expect(res.body.requiresEscolha).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────
// 4. O super admin nunca é barrado
// ─────────────────────────────────────────────────────────
describe('super admin e escola bloqueada', () => {
    it('acessa a escola bloqueada, vê os dados dela e sai do contexto', async () => {
        await Turma.create({
            id: '9Z',
            nome: '9Z',
            ano: 9,
            escolaId: String(escolaA._id),
            ativo: true,
        });
        await Turma.create({
            id: '1B',
            nome: '1B',
            ano: 1,
            escolaId: String(escolaB._id),
            ativo: true,
        });
        const sa = await superAdminLogado();
        await sa.patch(`/api/superadmin/escolas/${escolaA._id}/bloquear`).send({ motivo: MOTIVO });

        const acesso = await sa.post(`/api/superadmin/escolas/${escolaA._id}/acessar`);
        expect(acesso.status).toBe(200);
        expect(acesso.body.data).toMatchObject({ nome: 'EMEF Alfa', status: 'bloqueada' });

        const turmas = await sa.get('/api/turmas');
        expect(turmas.status).toBe(200);
        expect(turmas.body.data.map((t) => t.nome)).toEqual(['9Z']);

        const contexto = await sa.get('/api/superadmin/contexto');
        expect(contexto.body.data.escolaId).toBe(String(escolaA._id));

        const saida = await sa.delete('/api/superadmin/contexto');
        expect(saida.status).toBe(200);
        expect((await sa.get('/api/superadmin/contexto')).body.data).toBeNull();

        expect(await AuditLog.countDocuments({ acao: 'SUPERADMIN_ACESSOU_ESCOLA' })).toBe(1);
        expect(await AuditLog.countDocuments({ acao: 'SUPERADMIN_SAIU_ESCOLA' })).toBe(1);
    });

    it('o super admin cadastrado numa escola bloqueada continua logando', async () => {
        await Usuario.updateOne(
            { _id: superAdmin._id },
            { $set: { escolaId: String(escolaA._id) } }
        );
        await Escola.updateOne({ _id: escolaA._id }, { $set: { status: 'bloqueada' } });
        escolaBloqueio.invalidarCache();
        const { agent, res } = await logar('super@rede.test');
        expect(res.status).toBe(200);
        expect((await agent.get('/api/superadmin/escolas')).status).toBe(200);
    });

    it('a direção de uma escola bloqueada é barrada como o resto da equipe', async () => {
        await criarUsuario({
            email: 'admin-escola@a.test',
            perfil: 'diretor',
            escolaId: String(escolaA._id),
        });
        await Escola.updateOne({ _id: escolaA._id }, { $set: { status: 'bloqueada' } });
        escolaBloqueio.invalidarCache();
        const { res } = await logar('admin-escola@a.test');
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('ESCOLA_BLOQUEADA');
    });
});

// ─────────────────────────────────────────────────────────
// 5. Socket.IO — desconexão de quem está online na escola
// ─────────────────────────────────────────────────────────
describe('escolaBloqueio.desconectarEscola', () => {
    function socketFalso(usuario) {
        return { data: { usuario }, emit: jest.fn(), disconnect: jest.fn() };
    }

    it('avisa e desconecta a escola inteira, menos o admin', async () => {
        const professor = socketFalso({ perfil: 'professor' });
        const adminComum = socketFalso({ perfil: 'admin', superAdmin: false });
        const superAdm = socketFalso({ perfil: 'admin', superAdmin: true });
        const salas = [];
        const io = {
            in: (sala) => {
                salas.push(sala);
                return { fetchSockets: async () => [professor, adminComum, superAdm] };
            },
        };

        const n = await escolaBloqueio.desconectarEscola(io, escolaA._id);

        expect(salas).toEqual([`escola:${escolaA._id}`]);
        expect(n).toBe(1);
        for (const s of [professor]) {
            expect(s.emit).toHaveBeenCalledWith('escola:bloqueada', {
                codigo: 'ESCOLA_BLOQUEADA',
                mensagem: 'Escola temporariamente bloqueada. Contate o administrador.',
            });
            expect(s.disconnect).toHaveBeenCalledWith(true);
        }
        expect(adminComum.disconnect).not.toHaveBeenCalled();
        expect(superAdm.disconnect).not.toHaveBeenCalled();
    });

    it('sem io (processo sem socket) ou com falha do adapter, não derruba o bloqueio', async () => {
        expect(await escolaBloqueio.desconectarEscola(undefined, escolaA._id)).toBe(0);
        const io = {
            in: () => ({
                fetchSockets: async () => {
                    throw new Error('adapter fora');
                },
            }),
        };
        expect(await escolaBloqueio.desconectarEscola(io, escolaA._id)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────
// 6. Menu e migração
// ─────────────────────────────────────────────────────────
describe('menu e migração', () => {
    it('a rota da gestão de escolas vai para todo admin e para mais ninguém', () => {
        expect(rotasAdminPara('admin').gestaoEscolas).toMatch(/gestao-escolas\.html$/);
        expect(rotasAdminPara('diretor').gestaoEscolas).toBeUndefined();
        expect(rotasAdminPara('secretaria').gestaoEscolas).toBeUndefined();
    });

    it('GET /api/auth/rotas devolve a entrada ao admin sem a flag superAdmin', async () => {
        await criarUsuario({ email: 'comum2@rede.test', perfil: 'admin' });
        const { agent } = await logar('comum2@rede.test');
        const comum = await agent.get('/api/auth/rotas');
        expect(comum.body.rotas.admin.gestaoEscolas).toBeDefined();
        expect(comum.body.rotas.admin.codigosEscolas).toBeDefined();
        expect(comum.body.rotas.admin.convitesEquipe).toBeDefined();
    });

    it('a migração preenche status só onde falta e é idempotente', async () => {
        const migracao = require('../../migrations/1790380800000-status-de-bloqueio-das-escolas');
        const colecao = mongoose.connection.collection('escolas');
        await colecao.updateMany({}, { $unset: { status: '' } });
        await colecao.updateOne({ _id: escolaC._id }, { $set: { status: 'bloqueada' } });

        const primeira = await migracao.up();
        expect(primeira.atualizadas).toBe(2);
        expect(await colecao.countDocuments({ status: 'ativa' })).toBe(2);
        expect((await colecao.findOne({ _id: escolaC._id })).status).toBe('bloqueada');

        const segunda = await migracao.up();
        expect(segunda.atualizadas).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────
// 7. Liberar para uso (Issue #533)
// ─────────────────────────────────────────────────────────
describe('PATCH /api/superadmin/escolas/:id/disponibilidade', () => {
    let nova;
    beforeEach(async () => {
        nova = await Escola.create({ nome: 'EMEF Delta', tipo: 'EMEF', bairro: 'Novo' });
    });

    it('a escola nasce aguardando liberação e aparece no filtro', async () => {
        const agent = await superAdminLogado();
        const res = await agent.get('/api/superadmin/escolas?status=aguardando');
        expect(res.status).toBe(200);
        expect(res.body.data.map((e) => e.nome)).toEqual(['EMEF Delta']);
        expect(res.body.data[0].disponivel).toBe(false);
        expect(res.body.resumo.aguardando).toBe(1);
    });

    it('libera, gera o código de professor que faltava e audita', async () => {
        const agent = await superAdminLogado();
        const res = await agent
            .patch(`/api/superadmin/escolas/${nova._id}/disponibilidade`)
            .send({ disponivel: true });
        expect(res.status).toBe(200);
        expect(res.body.data.disponivel).toBe(true);
        expect(res.body.data.codigoSecreto).toBeUndefined();

        const salva = await Escola.findById(nova._id).select('+codigoSecreto').lean();
        expect(salva.ativo).toBe(true);
        expect(salva.codigoSecreto).toMatch(/^[A-Za-z0-9]{10}$/);

        const { validarCodigoEscola } = require('../services/codigoEscolaService');
        expect(await validarCodigoEscola(salva.codigoSecreto, String(nova._id))).toBeTruthy();

        const log = await AuditLog.findOne({ acao: 'ESCOLA_LIBERADA' }).lean();
        expect(log).toBeTruthy();
        expect(String(log.recursoId)).toBe(String(nova._id));
    });

    it('preserva o código que já existia', async () => {
        await Escola.updateOne({ _id: nova._id }, { $set: { codigoSecreto: 'ABCDEFGH23' } });
        const agent = await superAdminLogado();
        await agent
            .patch(`/api/superadmin/escolas/${nova._id}/disponibilidade`)
            .send({ disponivel: true })
            .expect(200);
        const salva = await Escola.findById(nova._id).select('+codigoSecreto').lean();
        expect(salva.codigoSecreto).toBe('ABCDEFGH23');
    });

    it('repetir a decisão é 409 e retirar de uso volta a escola ao cadeado', async () => {
        const agent = await superAdminLogado();
        const url = `/api/superadmin/escolas/${escolaA._id}/disponibilidade`;
        const repetida = await agent.patch(url).send({ disponivel: true });
        expect(repetida.status).toBe(409);

        const retirada = await agent.patch(url).send({ disponivel: false });
        expect(retirada.status).toBe(200);
        expect((await Escola.findById(escolaA._id).lean()).ativo).toBe(false);
        expect(await AuditLog.exists({ acao: 'ESCOLA_RETIRADA_DE_USO' })).toBeTruthy();
    });

    it('valida o corpo e o id', async () => {
        const agent = await superAdminLogado();
        const semCorpo = await agent
            .patch(`/api/superadmin/escolas/${nova._id}/disponibilidade`)
            .send({ disponivel: 'sim' });
        expect(semCorpo.status).toBe(400);
        const idRuim = await agent
            .patch('/api/superadmin/escolas/xyz/disponibilidade')
            .send({ disponivel: true });
        expect(idRuim.status).toBe(400);
        const inexistente = await agent
            .patch(`/api/superadmin/escolas/${new mongoose.Types.ObjectId()}/disponibilidade`)
            .send({ disponivel: true });
        expect(inexistente.status).toBe(404);
    });

    it('diretor não libera escola', async () => {
        const conta = await criarUsuario({
            email: 'dir@rede.test',
            perfil: 'diretor',
            escolaId: String(escolaA._id),
        });
        const { assinarTokenSessao } = require('../utils/sessionToken');
        const res = await request(app)
            .patch(`/api/superadmin/escolas/${nova._id}/disponibilidade`)
            .set('Cookie', `escola_jwt=${assinarTokenSessao(conta)}`)
            .send({ disponivel: true });
        expect(res.status).toBe(403);
        expect((await Escola.findById(nova._id).lean()).ativo).toBe(false);
    });
});
