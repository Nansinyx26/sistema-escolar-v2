/**
 * sessaoEscolaDoUsuario.test.js
 *
 * Issue #576: a escola ativa da sessão (`escola_sess`, independente do JWT)
 * era usada por quem viesse depois no mesmo navegador, e continuava valendo
 * para quem perdeu o vínculo com a escola. Agora a escola da sessão só vale
 * para a conta que a gravou e, na equipe, enquanto o vínculo existir.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');

let escolaA;
let escolaB;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
    escolaA = await Escola.create({ nome: 'Escola A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'Escola B', tipo: 'EMEF', ativo: true });
    // A mesma turma nas duas escolas: o professor só enxerga a própria turma,
    // então o que distingue o resultado é a escola, não o nome da turma.
    for (const escola of [escolaA, escolaB]) {
        await Turma.create({
            id: '1A',
            nome: '1A',
            ano: 1,
            escolaId: String(escola._id),
            ativo: true,
        });
    }
});

async function professorDe(email, escolas) {
    const user = await criarUsuario({ email, perfil: 'professor' });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal: '1A',
        vinculos: escolas.map((e) => ({ escolaId: String(e._id), cargo: 'professor' })),
        ativo: true,
    });
    return user;
}

/** Login com senha; devolve o agent e só o cookie da sessão multi-escola. */
async function entrar(email, escola) {
    const agent = request.agent(app);
    const res = await agent
        .post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(res.status).toBe(200);
    const sess = (res.headers['set-cookie'] || []).find((c) => c.startsWith('escola_sess='));
    expect(sess).toBeDefined();
    return { agent, cookieSessao: sess.split(';')[0] };
}

function idsDasTurmas(res) {
    return (res.body.data || []).map((t) => String(t.escolaId));
}

describe('Escola da sessão amarrada ao usuário (Issue #576)', () => {
    it('outra conta no mesmo navegador não herda a escola da sessão', async () => {
        await professorDe('prof.a@escola.test', [escolaA]);
        const outra = await professorDe('prof.b@escola.test', [escolaB]);
        const { cookieSessao } = await entrar('prof.a@escola.test', escolaA);

        // Segunda conta com a MESMA sessão do navegador — é o que acontece
        // quando ela entra por um caminho que não toca a sessão.
        const res = await request(app)
            .get('/api/turmas')
            .set('Cookie', [cookieSessao, `escola_jwt=${assinarTokenSessao(outra)}`]);

        expect(res.status).toBe(200);
        expect(idsDasTurmas(res)).toEqual([String(escolaB._id)]);
    });

    it('conta que perdeu o vínculo deixa de operar na escola da sessão', async () => {
        const prof = await professorDe('prof.desligado@escola.test', [escolaA]);
        const { agent } = await entrar('prof.desligado@escola.test', escolaA);

        const antes = await agent.get('/api/turmas');
        expect(idsDasTurmas(antes)).toEqual([String(escolaA._id)]);

        await Professor.updateOne(
            { idUsuario: String(prof._id) },
            { $set: { vinculos: [{ escolaId: String(escolaB._id), cargo: 'professor' }] } }
        );
        invalidarCacheEscolas();

        const depois = await agent.get('/api/turmas');
        expect(depois.status).toBe(200);
        expect(idsDasTurmas(depois)).not.toContain(String(escolaA._id));
    });

    it('login sem escola resolvida não herda a escola do login anterior', async () => {
        await professorDe('prof.antes@escola.test', [escolaA]);
        await criarUsuario({
            email: 'familia@exemplo.test',
            perfil: 'responsavel',
            escolaId: String(escolaB._id),
        });
        const { agent } = await entrar('prof.antes@escola.test', escolaA);

        const login = await agent
            .post('/api/auth/login')
            .send({ email: 'familia@exemplo.test', senha: SENHA_TESTE, portal: 'responsavel' });
        expect(login.status).toBe(200);

        const minhas = await agent.get('/api/escolas/minhas');
        expect(minhas.body.escolaAtivaId).not.toBe(String(escolaA._id));
    });

    it('responsável com a sessão de outra conta é re-resolvido para a própria escola', async () => {
        await professorDe('prof.sessao@escola.test', [escolaA]);
        const familia = await criarUsuario({
            email: 'familia2@exemplo.test',
            perfil: 'responsavel',
            escolaId: String(escolaB._id),
        });
        const { cookieSessao } = await entrar('prof.sessao@escola.test', escolaA);
        const cookies = [cookieSessao, `escola_jwt=${assinarTokenSessao(familia)}`];

        // Qualquer rota atrás do filtrarPorEscola refaz a resolução
        await request(app).get('/api/comunicados').set('Cookie', cookies);

        const minhas = await request(app).get('/api/escolas/minhas').set('Cookie', cookies);
        expect(minhas.body.escolaAtivaId).toBe(String(escolaB._id));
    });
});
