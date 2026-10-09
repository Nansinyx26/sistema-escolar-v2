/**
 * cadastroDocenteSemTurma.test.js — Issue #706
 *
 * As turmas do professor são o escopo de acesso aos alunos: o `horizontalFilter`
 * monta `req.allowedTurmas` com `salaPrincipal`, `salasAdicionais` e `turmas`.
 * O `POST /api/auth/register-docente` é público (basta o código da escola, que
 * todo o corpo docente conhece) e gravava ali a turma escolhida no formulário:
 * a conta nascia logada e já lia as fichas da turma, sem a direção atribuir
 * nada. Agora a conta nasce sem turma, como no `/register-code`, e a turma
 * pedida vai só na notificação da direção.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');
const { CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const CODIGO = 'CodigoDaEscola706';
const SENHA = `Fixture#${'Docente'}2026`;

let escolaId;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
    const escola = await Escola.create({
        nome: 'EMEF Docente',
        tipo: 'EMEF',
        ativo: true,
        codigoSecreto: CODIGO,
    });
    escolaId = String(escola._id);
    await Aluno.create({ nome: 'Aluno do 6B', turma: '6B', escolaId, ativo: true });
    await Aluno.create({ nome: 'Aluno do 5A', turma: '5A', escolaId, ativo: true });
    invalidarCacheEscolas();
});

/** Cookies de sessão devolvidos pelo cadastro (JWT + sessão da escola). */
function cookieDaResposta(res) {
    return (res.headers['set-cookie'] || [])
        .filter((l) => l.startsWith('escola_jwt=') || l.startsWith('escola_sess='))
        .map((l) => l.split(';')[0])
        .join('; ');
}

function cadastrar(campos = {}) {
    return request(app)
        .post('/api/auth/register-docente')
        .send({
            nome: 'Pessoa Docente',
            email: 'docente706@escola.test',
            senha: SENHA,
            disciplina: 'Matemática',
            turma: '6B',
            matricula: '0706',
            telefone: '11999990706',
            codigoEscola: CODIGO,
            escolaId,
            consentimentoLgpd: { aceito: true, versao: CONSENTIMENTO_VERSAO },
            ...campos,
        });
}

/**
 * A conta do autocadastro só entra depois de confirmar o e-mail (Issue #716):
 * marca a confirmação, como o link faria, e entra com a senha do cadastro.
 */
async function entrarDepoisDeConfirmar() {
    await Usuario.updateOne(
        { email: 'docente706@escola.test' },
        { $set: { emailVerificado: true } }
    );
    const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'docente706@escola.test', senha: SENHA });
    expect(login.status).toBe(200);
    return cookieDaResposta(login);
}

async function nomesDosAlunos(cookie) {
    const res = await request(app).get('/api/alunos').set('Cookie', cookie);
    expect(res.status).toBe(200);
    return res.body.data.map((a) => a.nome);
}

describe('register-docente', () => {
    it('a turma do formulário não vira escopo: a conta nova não vê aluno nenhum', async () => {
        const cadastro = await cadastrar();
        expect(cadastro.status).toBe(201);

        const prof = await Professor.findOne({ email: 'docente706@escola.test' }).lean();
        expect(prof.salaPrincipal).toBeUndefined();
        expect(prof.salasAdicionais).toEqual([]);
        expect(prof.turmas).toEqual([]);
        expect(prof.vinculos.map((v) => v.escolaId)).toEqual([escolaId]);
        // Nem na conta: o auto-heal da lista de professores lia `Usuario.turma`.
        const conta = await Usuario.findOne({ email: 'docente706@escola.test' }).lean();
        expect(conta.turma).toBeUndefined();

        expect(await nomesDosAlunos(await entrarDepoisDeConfirmar())).toEqual([]);
    });

    it('especialista fica marcado como VARIADOS, sem sala adicional', async () => {
        await cadastrar({ disciplina: 'Inglês' });

        const prof = await Professor.findOne({ email: 'docente706@escola.test' }).lean();
        expect(prof.salaPrincipal).toBe('VARIADOS');
        expect(prof.salasAdicionais).toEqual([]);
        expect(prof.tipoEspecial).toBe(true);
    });

    it('a direção recebe a turma pedida na notificação de cadastro', async () => {
        await cadastrar();

        const aviso = await Notificacao.findOne({ tipo: 'cadastro', escolaId }).lean();
        expect(aviso.mensagem).toContain('Matemática');
        expect(aviso.mensagem).toContain('pediu a turma 6B');
    });

    it('depois que a gestão atribui a turma, o acesso funciona', async () => {
        await cadastrar();
        const prof = await Professor.findOne({ email: 'docente706@escola.test' }).lean();

        const diretor = await criarUsuario({ email: 'dir706@escola.test', perfil: 'diretor' });
        await Diretor.create({
            idUsuario: String(diretor._id),
            nome: diretor.nome,
            email: diretor.email,
            vinculos: [{ escolaId, cargo: 'diretor' }],
        });
        const atribuicao = await request(app)
            .put(`/api/professores/${prof._id}`)
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(diretor)}`])
            .send({ salaPrincipal: '6B' });
        expect(atribuicao.status).toBe(200);

        expect(await nomesDosAlunos(await entrarDepoisDeConfirmar())).toEqual(['Aluno do 6B']);
    });
});

describe('auto-heal da lista de professores', () => {
    it('não transforma a turma escrita na conta em escopo', async () => {
        // Conta antiga do cadastro público, com `turma` gravada e sem o
        // cadastro pedagógico — o caso que o auto-heal recria.
        await criarUsuario({
            email: 'antigo706@escola.test',
            perfil: 'professor',
            escolaId,
            disciplina: 'Matemática',
            turma: '6B',
        });
        const diretor = await criarUsuario({
            email: 'dir706b@escola.test',
            perfil: 'diretor',
            escolaId,
        });

        const lista = await request(app)
            .get('/api/professores')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(diretor)}`]);
        expect(lista.status).toBe(200);

        const prof = await Professor.findOne({ email: 'antigo706@escola.test' }).lean();
        expect(prof).not.toBeNull();
        expect(prof.salaPrincipal).toBeUndefined();
        expect(prof.salasAdicionais).toEqual([]);
        expect(prof.turmas).toEqual([]);
    });
});
