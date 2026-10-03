/**
 * alunoSemEscola.regressao.test.js — Issue #602
 *
 * `assertAcessoAoAluno` só barrava o acesso entre escolas quando os DOIS lados
 * tinham escola. Um aluno sem `escolaId` ficava aberto à equipe de qualquer
 * escola — ao professor bastava o nome da turma coincidir ("1A" existe em
 * toda escola). A listagem (`escolaMatch`) já deixava esses registros de fora.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const Professor = require('../models/Professor');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const MODELO_DO_CARGO = { diretor: Diretor, secretaria: Secretaria, professor: Professor };
let escola;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    delete process.env.ESCOLA_INCLUIR_LEGADOS;
    escola = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
});
afterEach(() => {
    delete process.env.ESCOLA_INCLUIR_LEGADOS;
});

/** Conta de equipe com vínculo único na escola — o filtro resolve a escola sozinho. */
async function cookieDeEquipe(perfil) {
    const usuario = await criarUsuario({ perfil, escolaId: escola });
    await MODELO_DO_CARGO[perfil].create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId: escola, cargo: perfil }],
        ...(perfil === 'professor' ? { salaPrincipal: '1A', ativo: true } : {}),
    });
    return [`escola_jwt=${assinarTokenSessao(usuario)}`];
}

/** Aluno da turma 1A — a mesma do professor — com a escola dada. */
const criarAluno = (escolaId) =>
    Aluno.create({
        nome: 'Aluno Teste',
        turma: '1A',
        ativo: true,
        ...(escolaId === undefined ? {} : { escolaId }),
    });

const ler = (cookies, aluno) => request(app).get(`/api/alunos/${aluno._id}`).set('Cookie', cookies);

describe('equipe não lê aluno sem escola (Issue #602)', () => {
    const FORMAS = [
        ['sem o campo', undefined],
        ['null', null],
        ['vazio', ''],
    ];
    const PERFIS = ['diretor', 'secretaria', 'professor'];

    for (const perfil of PERFIS) {
        it.each(FORMAS)(`${perfil}: aluno com escolaId %s → 403`, async (_forma, valor) => {
            const aluno = await criarAluno(valor);

            const res = await ler(await cookieDeEquipe(perfil), aluno);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/nenhuma escola/);
        });
    }

    // 'default' é texto: já era barrado pela conferência de outra escola.
    it.each(PERFIS)("%s: aluno com o legado 'default' segue recusado", async (perfil) => {
        const aluno = await criarAluno('default');

        const res = await ler(await cookieDeEquipe(perfil), aluno);

        expect(res.status).toBe(403);
    });

    it.each(PERFIS)('%s continua lendo o aluno da própria escola', async (perfil) => {
        const aluno = await criarAluno(escola);

        const res = await ler(await cookieDeEquipe(perfil), aluno);

        expect(res.status).toBe(200);
    });

    it('com ESCOLA_INCLUIR_LEGADOS=true a tolerância da transição volta', async () => {
        process.env.ESCOLA_INCLUIR_LEGADOS = 'true';
        const aluno = await criarAluno(undefined);

        const res = await ler(await cookieDeEquipe('diretor'), aluno);

        expect(res.status).toBe(200);
    });
});

describe('quem não depende da escola segue igual', () => {
    it('admin acessa aluno sem escola', async () => {
        const aluno = await criarAluno(undefined);
        const admin = await criarUsuario({ perfil: 'admin' });

        const r = await assertAcessoAoAluno(
            { user: { id: String(admin._id), perfil: 'admin' }, escolaId: escola },
            String(aluno._id)
        );

        expect(r.ok).toBe(true);
    });

    it('responsável vinculado acessa o filho sem escola', async () => {
        const responsavel = await criarUsuario({ perfil: 'responsavel', escolaId: escola });
        const aluno = await Aluno.create({
            nome: 'Filho Sem Escola',
            turma: '1A',
            ativo: true,
            responsavel: responsavel.email,
        });

        const r = await assertAcessoAoAluno(
            {
                user: {
                    id: String(responsavel._id),
                    perfil: 'responsavel',
                    email: responsavel.email,
                },
                escolaId: escola,
            },
            String(aluno._id)
        );

        expect(r.ok).toBe(true);
    });
});
