/**
 * documentoResponsavelRotaGenerica.test.js — Issue #689
 *
 * O módulo de documentos do responsável recusa o professor e só mostra ao
 * responsável o que ele mesmo enviou. O arquivo, porém, fica no GridFS com
 * `metadata.alunoId`, e a rota genérica `/api/upload/documento/:id` liberava
 * qualquer pessoa com acesso ao aluno: o outro responsável e o professor da
 * turma baixavam o documento. E a lista do aluno entregava ao outro
 * responsável o `storageId`.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let A;
let aluno;
let mae;
let pai;

const pdf = Buffer.from(
    '%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 2\n0000000000 65535 f\n0000000018 00000 n\ntrailer<</Size 2/Root 1 0 R>>\nstartxref\n70\n%%EOF'
);
const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
    mae = await criarUsuario({ perfil: 'responsavel', email: 'mae.689@escola.test', escolaId: A });
    pai = await criarUsuario({ perfil: 'responsavel', email: 'pai.689@escola.test', escolaId: A });
    aluno = await Aluno.create({
        nome: 'Filho',
        turma: '1A',
        escolaId: A,
        ativo: true,
        responsavel: 'mae.689@escola.test',
        responsaveis: [{ email: 'pai.689@escola.test', nome: 'Pai' }],
    });
});

async function enviarComprovanteDaMae() {
    const envio = await request(app)
        .post('/api/documentos-responsaveis')
        .set('Cookie', cookieDe(mae))
        .field('alunoId', String(aluno._id))
        .field('tipoDocumento', 'Comprovante de residência')
        .field('nomeDocumento', 'Comprovante da mãe')
        .attach('arquivo', pdf, { filename: 'comprovante.pdf', contentType: 'application/pdf' });
    expect(envio.status).toBe(201);
    return envio.body.data.arquivo.storageId;
}

async function equipe(perfil, Modelo, extra = {}) {
    const usuario = await criarUsuario({ perfil, escolaId: A });
    await Modelo.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId: A, cargo: perfil }],
        ...extra,
    });
    return cookieDe(usuario);
}

const baixar = (storageId, cookie) =>
    request(app).get(`/api/upload/documento/${storageId}`).set('Cookie', cookie);

it('o outro responsável do aluno não baixa pela rota genérica', async () => {
    const storageId = await enviarComprovanteDaMae();

    const res = await baixar(storageId, cookieDe(pai));

    expect(res.status).toBe(403);
});

it('o professor da turma não baixa pela rota genérica', async () => {
    const storageId = await enviarComprovanteDaMae();
    const cookieProf = await equipe('professor', Professor, { salaPrincipal: '1A', ativo: true });

    const res = await baixar(storageId, cookieProf);

    expect(res.status).toBe(403);
});

it('quem enviou e a direção da escola continuam baixando', async () => {
    const storageId = await enviarComprovanteDaMae();
    const cookieDiretor = await equipe('diretor', Diretor);

    const daMae = await baixar(storageId, cookieDe(mae));
    const daDirecao = await baixar(storageId, cookieDiretor);

    expect(daMae.status).toBe(200);
    expect(daMae.headers['content-type']).toContain('application/pdf');
    expect(daDirecao.status).toBe(200);
});

it('a lista do aluno não entrega ao outro responsável o documento que ele não enviou', async () => {
    const storageId = await enviarComprovanteDaMae();

    const doPai = await request(app)
        .get(`/api/documentos-responsaveis/aluno/${aluno._id}`)
        .set('Cookie', cookieDe(pai));
    const daMae = await request(app)
        .get(`/api/documentos-responsaveis/aluno/${aluno._id}`)
        .set('Cookie', cookieDe(mae));

    expect(doPai.status).toBe(200);
    expect(JSON.stringify(doPai.body)).not.toContain(storageId);
    expect(JSON.stringify(daMae.body)).toContain(storageId);
});
