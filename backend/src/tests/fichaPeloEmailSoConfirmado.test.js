/**
 * fichaPeloEmailSoConfirmado.test.js — Issue #747
 *
 * O lado da família decide o acesso ao aluno pelo e-mail da conta. A #412
 * exige que o responsável confirme esse e-mail, mas três portas pulavam:
 *   - `/api/responsavel/*` aceitava conta de equipe (a confirmação só vale
 *     para o responsável): a direção de outra escola criava um "professor" com
 *     o e-mail de uma família e recebia a ficha do filho dela;
 *   - `/api/meus-dados` montava os dependentes sem conferir a confirmação;
 *   - o chatbot legado (`enforceRBAC`) também não conferia.
 */
jest.mock('../services/voiceService', () => ({
    generateInsightText: jest.fn(async () => {
        throw new Error('offline no teste');
    }),
}));

const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Usuario = require('../models/Usuario');
const interruptor = require('../services/ia/interruptor');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { invalidarCacheDeVerificacao } = require('../services/verificacaoEmail');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const EMAIL_DA_FICHA = 'mae.747@familia.test';
const cookieDe = (conta) => [`escola_jwt=${assinarTokenSessao(conta)}`];

let escolaId;
let crianca;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    invalidarCacheDeVerificacao();
    process.env.IA_ESCOLAS_PADRAO = 'ligada';
    interruptor.limparCache();
    escolaId = String((await Escola.create({ nome: 'EMEF 747', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
    crianca = await Aluno.create({
        nome: 'Beatriz',
        sobrenome: 'Ficha',
        turma: '3B',
        ativo: true,
        escolaId,
        responsavelDados: { email: EMAIL_DA_FICHA, nome: 'Mãe' },
        alergiasRemedio: 'dipirona',
    });
    await Nota.create({
        alunoId: String(crianca._id),
        turmaId: '3B',
        materiaId: 'Matemática',
        bimestre: 1,
        nota: 3.5,
        escolaId,
    });
});
afterEach(() => {
    delete process.env.IA_ESCOLAS_PADRAO;
});

/** Conta criada depois do marco da #412, com o e-mail ainda não confirmado. */
async function contaNaoConfirmada(perfil, extra = {}) {
    const conta = await criarUsuario({ perfil, email: EMAIL_DA_FICHA, ...extra });
    await Usuario.collection.updateOne(
        { _id: conta._id },
        { $set: { createdAt: new Date('2026-10-01T00:00:00Z'), emailVerificado: false } }
    );
    return conta;
}

async function responsavelConfirmado() {
    return criarUsuario({ perfil: 'responsavel', email: EMAIL_DA_FICHA, emailVerificado: true });
}

describe('/api/responsavel só para o perfil responsável', () => {
    it.each([
        ['GET', '/alunos'],
        ['GET', '/notas/:aluno'],
        ['GET', '/frequencia/:aluno'],
        ['PUT', '/aluno/:aluno/dados'],
    ])('conta de equipe com o e-mail da família recebe 403 em %s %s', async (metodo, rota) => {
        const professor = await contaNaoConfirmada('professor', { escolaId: 'outra-escola' });
        const url = `/api/responsavel${rota.replace(':aluno', String(crianca._id))}`;

        const res = await request(app)
            [metodo.toLowerCase()](url)
            .set('Cookie', cookieDe(professor))
            .send({ pessoasAutorizadasRetirada: [{ nome: 'Estranho' }] });

        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain('Beatriz');
        const ficha = await Aluno.findById(crianca._id).lean();
        expect(ficha.pessoasAutorizadasRetirada ?? []).toEqual([]);
    });

    it('o responsável confirmado segue vendo o filho (controle)', async () => {
        const mae = await responsavelConfirmado();
        const res = await request(app).get('/api/responsavel/alunos').set('Cookie', cookieDe(mae));

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });
});

describe('/api/meus-dados', () => {
    it('responsável não confirmado não recebe os dependentes', async () => {
        const conta = await contaNaoConfirmada('responsavel');
        const res = await request(app).get('/api/meus-dados').set('Cookie', cookieDe(conta));

        expect(res.status).toBe(200);
        expect(res.body.dependentes).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain('dipirona');
    });

    it('conta de equipe com o e-mail da família não recebe os dependentes', async () => {
        const conta = await criarUsuario({
            perfil: 'secretaria',
            email: EMAIL_DA_FICHA,
            escolaId,
            emailVerificado: true,
        });
        const res = await request(app).get('/api/meus-dados').set('Cookie', cookieDe(conta));

        expect(res.status).toBe(200);
        expect(res.body.dependentes).toBeUndefined();
    });

    it('o responsável confirmado recebe os dependentes (controle)', async () => {
        const mae = await responsavelConfirmado();
        const res = await request(app).get('/api/meus-dados').set('Cookie', cookieDe(mae));

        expect(res.body.dependentes).toHaveLength(1);
    });
});

describe('chatbot legado', () => {
    it('não acha aluno nem mostra nota para o responsável não confirmado', async () => {
        const conta = await contaNaoConfirmada('responsavel', { escolaId });

        const busca = await request(app)
            .get('/api/ia/chatbot/alunos?q=Beatriz')
            .set('Cookie', cookieDe(conta));
        const pergunta = await request(app)
            .post('/api/ia/chatbot')
            .set('Cookie', cookieDe(conta))
            .send({ message: 'notas da Beatriz Ficha' });

        expect(busca.status).toBe(200);
        expect(busca.body.data.alunos).toEqual([]);
        expect(JSON.stringify(pergunta.body)).not.toContain('3.5');
    });

    it('o responsável confirmado acha o filho (controle)', async () => {
        const mae = await criarUsuario({
            perfil: 'responsavel',
            email: EMAIL_DA_FICHA,
            escolaId,
            emailVerificado: true,
        });
        const busca = await request(app)
            .get('/api/ia/chatbot/alunos?q=Beatriz')
            .set('Cookie', cookieDe(mae));

        expect(busca.body.data.alunos.map((a) => a.nome)).toContain('Beatriz Ficha');
    });
});
