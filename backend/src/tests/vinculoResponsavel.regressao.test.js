/**
 * vinculoResponsavel.regressao.test.js — Issue #398
 *
 * O e-mail que está na ficha do aluno é o que dá acesso aos dados dele. Por
 * isso a inclusão pedida pela família vira PEDIDO: não dá acesso nenhum antes
 * de a secretaria aprovar. Aprovação e recusa ficam registradas.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const Secretaria = require('../models/Secretaria');
const SolicitacaoVinculo = require('../models/SolicitacaoVinculo');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escola;
let aluno;
let mae;
let secretaria;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

function pedirInclusao(email) {
    return request(app)
        .put(`/api/responsavel/aluno/${aluno._id}/dados`)
        .set('Cookie', cookieDe(mae))
        .send({
            responsaveis: [
                { nome: 'Mãe', email: 'mae@familia.test' },
                { nome: 'Padrasto', email },
            ],
        });
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({ nome: 'EMEF Vínculo', tipo: 'EMEF', ativo: true });
    aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Criança Fixture',
        turma: '1A',
        responsavel: 'mae@familia.test',
        responsaveis: [{ nome: 'Mãe', email: 'mae@familia.test' }],
        ativo: true,
    });
    mae = await criarUsuario({ email: 'mae@familia.test', perfil: 'responsavel' });
    secretaria = await criarUsuario({
        email: 'sec@escola.test',
        perfil: 'secretaria',
        escolaId: String(escola._id),
    });
    await Secretaria.create({
        idUsuario: String(secretaria._id),
        nome: secretaria.nome,
        email: secretaria.email,
        vinculos: [{ escolaId: String(escola._id), cargo: 'secretaria' }],
    });
    invalidarCacheEscolas();
});

describe('inclusão pedida pela família', () => {
    it('não entra na ficha e não dá acesso antes da aprovação', async () => {
        const res = await pedirInclusao('terceiro@qualquer.test');
        expect(res.status).toBe(200);
        expect(res.body.pedidosDeInclusao).toEqual([
            { email: 'terceiro@qualquer.test', status: 'pendente' },
        ]);

        const fichaDepois = await Aluno.findById(aluno._id).lean();
        expect(fichaDepois.responsaveis.map((r) => r.email)).toEqual(['mae@familia.test']);

        const terceiro = await criarUsuario({
            email: 'terceiro@qualquer.test',
            perfil: 'responsavel',
        });
        const lista = await request(app)
            .get('/api/responsavel/alunos')
            .set('Cookie', cookieDe(terceiro));
        expect(lista.body.data).toHaveLength(0);

        expect(await AuditLog.countDocuments({ acao: 'VINCULO_RESPONSAVEL_SOLICITADO' })).toBe(1);
    });

    it('o mesmo e-mail pedido duas vezes não vira fila de pedidos', async () => {
        await pedirInclusao('terceiro@qualquer.test');
        await pedirInclusao('terceiro@qualquer.test');
        expect(await SolicitacaoVinculo.countDocuments({ status: 'pendente' })).toBe(1);
    });

    it('trocar o e-mail principal por um de fora da ficha é recusado', async () => {
        const res = await request(app)
            .put(`/api/responsavel/aluno/${aluno._id}/dados`)
            .set('Cookie', cookieDe(mae))
            .send({ responsavelDados: { email: 'outro@qualquer.test' } });
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('INCLUSAO_DEPENDE_DA_SECRETARIA');
    });

    it('editar dados de quem já está na ficha continua funcionando', async () => {
        const res = await request(app)
            .put(`/api/responsavel/aluno/${aluno._id}/dados`)
            .set('Cookie', cookieDe(mae))
            .send({
                responsaveis: [
                    { nome: 'Mãe da Criança', email: 'mae@familia.test', telefone: '19999990000' },
                ],
            });
        expect(res.status).toBe(200);
        const ficha = await Aluno.findById(aluno._id).lean();
        expect(ficha.responsaveis[0].nome).toBe('Mãe da Criança');
        expect(await SolicitacaoVinculo.countDocuments({})).toBe(0);
    });

    it('mudança de guarda e de pessoas autorizadas fica registrada', async () => {
        const res = await request(app)
            .put(`/api/responsavel/aluno/${aluno._id}/dados`)
            .set('Cookie', cookieDe(mae))
            .send({
                guardaLegal: 'Mãe',
                pessoasAutorizadasRetirada: [{ nome: 'Avó', parentesco: 'Avó' }],
            });
        expect(res.status).toBe(200);
        const log = await AuditLog.findOne({
            acao: 'FICHA_ALUNO_ALTERADA_PELO_RESPONSAVEL',
        }).lean();
        expect(log.detalhes.valorAnterior.pessoasAutorizadasRetirada).toBe(0);
        expect(log.detalhes.valorNovo.pessoasAutorizadasRetirada).toBe(1);
        // A trilha prova o que mudou sem virar mais um lugar com dado pessoal.
        expect(JSON.stringify(log)).not.toContain('Avó');
    });
});

describe('decisão da secretaria', () => {
    async function pedidoPendente() {
        await pedirInclusao('terceiro@qualquer.test');
        return SolicitacaoVinculo.findOne({ status: 'pendente' }).lean();
    }

    it('lista os pedidos da própria escola com o nome do aluno', async () => {
        await pedidoPendente();
        const res = await request(app)
            .get('/api/secretaria/vinculos?status=pendente')
            .set('Cookie', cookieDe(secretaria));
        expect(res.status).toBe(200);
        expect(res.body.data[0]).toMatchObject({
            email: 'terceiro@qualquer.test',
            alunoNome: 'Criança Fixture',
            solicitanteEmail: 'mae@familia.test',
        });
    });

    it('aprovar inclui na ficha, libera o acesso e deixa registro', async () => {
        const pedido = await pedidoPendente();
        const res = await request(app)
            .post(`/api/secretaria/vinculos/${pedido._id}/aprovar`)
            .set('Cookie', cookieDe(secretaria));
        expect(res.status).toBe(200);

        const ficha = await Aluno.findById(aluno._id).lean();
        expect(ficha.responsaveis.map((r) => r.email)).toContain('terceiro@qualquer.test');

        const terceiro = await criarUsuario({
            email: 'terceiro@qualquer.test',
            perfil: 'responsavel',
        });
        const lista = await request(app)
            .get('/api/responsavel/alunos')
            .set('Cookie', cookieDe(terceiro));
        expect(lista.body.data).toHaveLength(1);

        const log = await AuditLog.findOne({ acao: 'VINCULO_RESPONSAVEL_APROVADO' }).lean();
        expect(log.recursoId).toBe(String(aluno._id));
        expect(JSON.stringify(log)).not.toContain('terceiro@qualquer.test');
    });

    it('recusar mantém a ficha como estava e registra o motivo', async () => {
        const pedido = await pedidoPendente();
        const res = await request(app)
            .post(`/api/secretaria/vinculos/${pedido._id}/recusar`)
            .set('Cookie', cookieDe(secretaria))
            .send({ motivo: 'sem comprovação de vínculo' });
        expect(res.status).toBe(200);

        const ficha = await Aluno.findById(aluno._id).lean();
        expect(ficha.responsaveis).toHaveLength(1);
        const recusado = await SolicitacaoVinculo.findById(pedido._id).lean();
        expect(recusado.status).toBe('recusada');
        expect(recusado.motivoRecusa).toBe('sem comprovação de vínculo');
        expect(await AuditLog.countDocuments({ acao: 'VINCULO_RESPONSAVEL_RECUSADO' })).toBe(1);
    });

    it('decidir duas vezes o mesmo pedido → 404', async () => {
        const pedido = await pedidoPendente();
        await request(app)
            .post(`/api/secretaria/vinculos/${pedido._id}/aprovar`)
            .set('Cookie', cookieDe(secretaria));
        const segunda = await request(app)
            .post(`/api/secretaria/vinculos/${pedido._id}/aprovar`)
            .set('Cookie', cookieDe(secretaria));
        expect(segunda.status).toBe(404);
    });

    it('responsável não decide pedido', async () => {
        const pedido = await pedidoPendente();
        const res = await request(app)
            .post(`/api/secretaria/vinculos/${pedido._id}/aprovar`)
            .set('Cookie', cookieDe(mae));
        expect(res.status).toBe(403);
    });
});
