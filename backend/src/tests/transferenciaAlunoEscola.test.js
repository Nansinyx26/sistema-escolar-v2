/**
 * transferenciaAlunoEscola.test.js — Issue #592
 *
 * `PUT /api/alunos/:id` gravava o `escolaId` do corpo como veio para admin,
 * diretor e secretaria: a direção da Escola A mandava o aluno para qualquer
 * escola da rede (ou para um id inexistente), e a sincronização do responsável
 * — que rodava em toda edição — levava a conta dele junto, inclusive a de um
 * responsável de outra escola cujo e-mail fosse gravado em `responsavel`.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let A;
let B;
let C;
let responsavel;
let aluno;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    const criarEscola = async (nome) =>
        String((await Escola.create({ nome, tipo: 'EMEF', ativo: true }))._id);
    A = await criarEscola('EMEF Alfa');
    B = await criarEscola('EMEF Beta');
    C = await criarEscola('EMEF Gama');
    invalidarCacheEscolas();

    responsavel = await criarUsuario({ perfil: 'responsavel', escolaId: A });
    aluno = await Aluno.create({
        nome: 'Aluno Transferência',
        turma: '1A',
        escolaId: A,
        responsavel: responsavel.email,
        ativo: true,
    });
});

/**
 * Conta de equipe com vínculo nas escolas dadas, já operando na primeira.
 * A escola entra na sessão pela rota de troca, como no navegador — com mais de
 * um vínculo, sem isso o `filtrarPorEscola` pede a escolha (409).
 */
async function equipe(perfil, escolas) {
    const usuario = await criarUsuario({ perfil, escolaId: escolas[0] });
    const Modelo = perfil === 'diretor' ? Diretor : Secretaria;
    await Modelo.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: escolas.map((escolaId) => ({ escolaId, cargo: perfil })),
    });
    const jwt = `escola_jwt=${assinarTokenSessao(usuario)}`;
    const troca = await request(app).post(`/api/escolas/trocar/${escolas[0]}`).set('Cookie', [jwt]);
    expect(troca.status).toBe(200);
    const sessao = (troca.headers['set-cookie'] || [])
        .map((c) => c.split(';')[0])
        .filter((c) => !c.startsWith('escola_jwt='));
    return [jwt, ...sessao];
}

const editar = (cookies, corpo) =>
    request(app).put(`/api/alunos/${aluno._id}`).set('Cookie', cookies).send(corpo);
const escolaDoAluno = async () => String((await Aluno.findById(aluno._id).lean()).escolaId);
const escolaDaConta = async (id) => (await Usuario.findById(id).lean()).escolaId;

describe('destino da transferência', () => {
    it.each([
        ['id que não é de escola nenhuma', '0123456789abcdef01234567'],
        ['valor que nem é id', 'qualquer-coisa'],
    ])('%s → 400 e o aluno fica onde está', async (_caso, destino) => {
        const cookies = await equipe('diretor', [A]);

        const res = await editar(cookies, { escolaId: destino });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('ESCOLA_DESTINO_INEXISTENTE');
        expect(await escolaDoAluno()).toBe(A);
    });

    it.each(['diretor', 'secretaria'])(
        '%s sem vínculo com o destino → 403, auditoria, aluno e responsável intactos',
        async (perfil) => {
            const cookies = await equipe(perfil, [A]);

            const res = await editar(cookies, { escolaId: B, nome: 'Nome Trocado' });

            expect(res.status).toBe(403);
            expect(res.body.codigo).toBe('ESCOLA_DESTINO_SEM_VINCULO');
            const depois = await Aluno.findById(aluno._id).lean();
            expect(String(depois.escolaId)).toBe(A);
            expect(depois.nome).toBe('Aluno Transferência');
            expect(await escolaDaConta(responsavel._id)).toBe(A);

            const log = await AuditLog.findOne({ acao: 'TRANSFERENCIA_ALUNO_RECUSADA' }).lean();
            expect(log).toBeTruthy();
            expect(String(log.recursoId)).toBe(String(aluno._id));
            expect(log.detalhes.valorNovo).toBe(B);
        }
    );

    it('diretor com vínculo nas duas escolas transfere, e fica registrado', async () => {
        const cookies = await equipe('diretor', [A, B]);

        const res = await editar(cookies, { escolaId: B });

        expect(res.status).toBe(200);
        expect(await escolaDoAluno()).toBe(B);
        const log = await AuditLog.findOne({ acao: 'ALUNO_TRANSFERIDO_DE_ESCOLA' }).lean();
        expect(log).toBeTruthy();
        expect(log.detalhes.valorAnterior).toBe(A);
        expect(log.detalhes.valorNovo).toBe(B);
        // O responsável estava na escola anterior: acompanha o aluno.
        expect(await escolaDaConta(responsavel._id)).toBe(B);
    });

    it('admin é da rede: transfere para qualquer escola existente', async () => {
        const admin = await criarUsuario({ perfil: 'admin' });

        const res = await editar([`escola_jwt=${assinarTokenSessao(admin)}`], { escolaId: C });

        expect(res.status).toBe(200);
        expect(await escolaDoAluno()).toBe(C);
    });

    it('mandar a escola em que o aluno já está não é transferência', async () => {
        const cookies = await equipe('secretaria', [A]);

        const res = await editar(cookies, { escolaId: A, nome: 'Nome Novo' });

        expect(res.status).toBe(200);
        expect((await Aluno.findById(aluno._id).lean()).nome).toBe('Nome Novo');
        expect(await AuditLog.countDocuments({ acao: 'ALUNO_TRANSFERIDO_DE_ESCOLA' })).toBe(0);
    });
});

describe('sincronização da escola do responsável', () => {
    it('responsável de outra escola não é puxado pela edição do aluno', async () => {
        const deOutraEscola = await criarUsuario({ perfil: 'responsavel', escolaId: C });
        const cookies = await equipe('diretor', [A]);

        const res = await editar(cookies, { responsavel: deOutraEscola.email });

        expect(res.status).toBe(200);
        expect(await escolaDaConta(deOutraEscola._id)).toBe(C);
    });

    it('responsável ainda sem escola passa a ser da escola do aluno', async () => {
        const semEscola = await criarUsuario({ perfil: 'responsavel' });
        const cookies = await equipe('diretor', [A]);

        const res = await editar(cookies, { responsavel: semEscola.email });

        expect(res.status).toBe(200);
        expect(await escolaDaConta(semEscola._id)).toBe(A);
    });
});
