/**
 * denunciasRecebidas.test.js — Issue #726
 *
 * A página de denúncias recebidas é o outro lado do canal "Denunciar bullying,
 * assédio ou discriminação": a denúncia gravada no banco chega à direção, à
 * secretaria e ao admin da escola — e a mais ninguém. A listagem não traz o
 * relato; abrir o relato fica no AuditLog; a apuração é salva com quem e quando.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const AuditLog = require('../models/AuditLog');
const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const ModeracaoService = require('../services/moderacao/ModeracaoService');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const RELATO = 'Relato fixture: a Joana Fixture é xingada todo dia no recreio.';

let escolaA;
let escolaB;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

function pessoa(perfil, escola = escolaA, nome = `Fixture ${perfil}`) {
    return criarUsuario({
        nome,
        email: `${perfil}${Math.random()}@escola.test`,
        perfil,
        escolaId: String(escola._id),
    });
}

async function denuncia(categoria, { escola = escolaA, remetente } = {}) {
    const { ocorrencia } = await ModeracaoService.registrarDenunciaAberta({
        categoria,
        relato: RELATO,
        contexto: {
            escolaId: String(escola._id),
            remetenteId: remetente ? String(remetente._id) : 'r1',
            remetentePerfil: remetente ? remetente.perfil : 'responsavel',
        },
    });
    return ocorrencia;
}

const listar = (quem, query = '') =>
    request(app).get(`/api/moderacao/denuncias${query}`).set('Cookie', cookieDe(quem));

const abrir = (quem, id, query = '') =>
    request(app).get(`/api/moderacao/denuncias/${id}${query}`).set('Cookie', cookieDe(quem));

const andamento = (quem, id, corpo) =>
    request(app)
        .post(`/api/moderacao/denuncias/${id}/andamento`)
        .set('Cookie', cookieDe(quem))
        .send(corpo);

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({ nome: 'EMEF A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();
});

describe('quem recebe', () => {
    it('a denúncia enviada pelo canal chega à secretaria e à direção da escola', async () => {
        const professor = await pessoa('professor');
        const envio = await request(app)
            .post('/api/moderacao/denunciar')
            .set('Cookie', cookieDe(professor))
            .send({ categoria: 'bullying', relato: RELATO });
        expect(envio.status).toBe(201);

        for (const perfil of ['secretaria', 'diretor']) {
            const res = await listar(await pessoa(perfil));
            expect({ perfil, status: res.status }).toEqual({ perfil, status: 200 });
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0]).toMatchObject({
                protocolo: envio.body.data.protocolo,
                categoria: 'bullying',
                situacao: 'nova',
                remetentePerfil: 'professor',
            });
        }
    });

    it('professor e responsável não alcançam nenhuma das três rotas', async () => {
        const o = await denuncia('bullying');
        for (const perfil of ['professor', 'responsavel']) {
            const quem = await pessoa(perfil);
            const status = [
                (await listar(quem)).status,
                (await abrir(quem, o._id)).status,
                (await andamento(quem, o._id, { situacao: 'em_apuracao' })).status,
            ];
            expect({ perfil, status }).toEqual({ perfil, status: [403, 403, 403] });
        }
        expect((await ModeracaoOcorrencia.findById(o._id).lean()).apuracao.situacao).toBe('nova');
    });

    it('o admin entra informando a escola', async () => {
        await denuncia('discriminacao');
        const admin = await criarUsuario({
            email: `adm${Math.random()}@escola.test`,
            perfil: 'admin',
        });

        const semEscola = await listar(admin);
        expect(semEscola.status).toBe(400);
        expect(semEscola.body.codigo).toBe('ESCOLA_NAO_INFORMADA');

        const comEscola = await listar(admin, `?escolaId=${escolaA._id}`);
        expect(comEscola.status).toBe(200);
        expect(comEscola.body.data).toHaveLength(1);
    });

    it('a escola B não vê, não abre e não anota denúncia da escola A', async () => {
        const o = await denuncia('assedio');
        const diretorB = await pessoa('diretor', escolaB);

        expect((await listar(diretorB)).body.data).toHaveLength(0);
        expect((await abrir(diretorB, o._id)).status).toBe(404);
        expect((await andamento(diretorB, o._id, { situacao: 'em_apuracao' })).status).toBe(404);
    });
});

describe('listagem', () => {
    it('não traz o relato nem o nome de quem denunciou', async () => {
        const responsavel = await pessoa('responsavel', escolaA, 'Responsavel Fixture');
        await denuncia('bullying', { remetente: responsavel });

        const res = await listar(await pessoa('secretaria'));
        const corpo = JSON.stringify(res.body);
        expect(corpo).not.toContain('Joana');
        expect(corpo).not.toContain('Responsavel Fixture');
        expect(corpo).not.toContain('relato');
    });

    it('mostra só o canal aberto: denúncia de mensagem e bloqueio do filtro ficam de fora', async () => {
        const aberta = await denuncia('ciberbullying');
        const comum = {
            escolaId: String(escolaA._id),
            tipoConteudo: 'texto',
            severidade: 'moderada',
            decisaoAutomatica: 'em_revisao',
        };
        await ModeracaoOcorrencia.create({ ...comum, camada: 'denuncia', mensagemId: 'm1' });
        await ModeracaoOcorrencia.create({ ...comum, camada: 'lexico' });

        const res = await listar(await pessoa('diretor'));
        expect(res.body.data.map((d) => d.id)).toEqual([String(aberta._id)]);
    });

    it('denúncia antiga, sem apuração gravada, aparece como nova e entra no filtro', async () => {
        const antiga = await ModeracaoOcorrencia.create({
            escolaId: String(escolaA._id),
            tipoConteudo: 'texto',
            camada: 'denuncia',
            severidade: 'moderada',
            decisaoAutomatica: 'em_revisao',
            categoriaDenuncia: 'bullying',
            relato: RELATO,
        });
        const sec = await pessoa('secretaria');
        const outra = await denuncia('violencia');
        await andamento(sec, outra._id, { situacao: 'em_apuracao' });

        const novas = await listar(sec, '?situacao=nova');
        expect(novas.body.data.map((d) => d.id)).toEqual([String(antiga._id)]);
        expect(novas.body.data[0].situacao).toBe('nova');
        expect(novas.body.resumo).toEqual({ nova: 1, em_apuracao: 1, concluida: 0, total: 2 });
    });

    it('filtra por categoria, marca automutilação como sigilosa e o Conselho Tutelar pendente', async () => {
        await denuncia('bullying');
        await denuncia('automutilacao');

        const res = await listar(await pessoa('diretor'), '?categoria=automutilacao');
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({
            categoria: 'automutilacao',
            sigilosa: true,
            conselhoTutelar: { exigida: true, situacao: 'pendente' },
        });
        expect(res.body.resumo.total).toBe(1);
    });

    it('recusa situação e categoria desconhecidas', async () => {
        const dir = await pessoa('diretor');
        expect((await listar(dir, '?situacao=arquivada')).status).toBe(400);
        expect((await listar(dir, '?categoria=fofoca')).status).toBe(400);
    });
});

describe('abrir o relato', () => {
    it('devolve relato e quem denunciou, e grava DENUNCIA_VISUALIZAR sem o relato', async () => {
        const responsavel = await pessoa('responsavel', escolaA, 'Responsavel Fixture');
        const o = await denuncia('bullying', { remetente: responsavel });
        const sec = await pessoa('secretaria');

        const res = await abrir(sec, o._id);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            relato: RELATO,
            autor: { nome: 'Responsavel Fixture', perfil: 'responsavel' },
            situacao: 'nova',
            andamentos: [],
        });

        const log = await AuditLog.findOne({ acao: 'DENUNCIA_VISUALIZAR' }).lean();
        expect(log.recursoId).toBe(String(o._id));
        expect(String(log.usuarioId)).toBe(String(sec._id));
        expect(JSON.stringify(log)).not.toContain('Joana');
    });

    it('id inválido ou inexistente é 404, sem AuditLog', async () => {
        const dir = await pessoa('diretor');
        expect((await abrir(dir, 'nao-e-id')).status).toBe(404);
        expect((await abrir(dir, '65f000000000000000000000')).status).toBe(404);
        expect(await AuditLog.countDocuments({ acao: 'DENUNCIA_VISUALIZAR' })).toBe(0);
    });
});

describe('andamento da apuração', () => {
    it('salva no banco quem anotou e quando, e o AuditLog não guarda a anotação', async () => {
        const o = await denuncia('bullying');
        const sec = await pessoa('secretaria', escolaA, 'Secretaria Fixture');

        const res = await andamento(sec, o._id, {
            situacao: 'em_apuracao',
            anotacao: 'Conversa marcada com a Joana Fixture e a família.',
        });
        expect(res.status).toBe(200);
        expect(res.body.data.situacao).toBe('em_apuracao');
        expect(res.body.data.andamentos[0]).toMatchObject({
            situacao: 'em_apuracao',
            porNome: 'Secretaria Fixture',
            porPerfil: 'secretaria',
        });

        const salvo = (await ModeracaoOcorrencia.findById(o._id).lean()).apuracao;
        expect(salvo.situacao).toBe('em_apuracao');
        expect(salvo.atualizadoEm).toBeInstanceOf(Date);
        expect(salvo.andamentos[0]).toMatchObject({
            situacao: 'em_apuracao',
            porId: String(sec._id),
            porPerfil: 'secretaria',
        });

        const log = await AuditLog.findOne({ acao: 'DENUNCIA_ANDAMENTO' }).lean();
        expect(log.detalhes).toMatchObject({
            valorAnterior: 'nova',
            valorNovo: { situacao: 'em_apuracao', temAnotacao: true },
        });
        expect(JSON.stringify(log)).not.toContain('Joana');
    });

    it('não conclui sem dizer o que foi apurado', async () => {
        const o = await denuncia('discriminacao');
        const dir = await pessoa('diretor');

        expect((await andamento(dir, o._id, { situacao: 'concluida' })).status).toBe(400);
        expect(
            (await andamento(dir, o._id, { situacao: 'concluida', anotacao: 'ok' })).status
        ).toBe(400);
        expect((await ModeracaoOcorrencia.findById(o._id).lean()).apuracao.situacao).toBe('nova');

        const ok = await andamento(dir, o._id, {
            situacao: 'concluida',
            anotacao: 'Mediação feita com as duas turmas; família informada.',
        });
        expect(ok.status).toBe(200);
        expect(ok.body.data.situacao).toBe('concluida');
    });

    it('reabrir o que foi concluído também pede o motivo', async () => {
        const o = await denuncia('bullying');
        const dir = await pessoa('diretor');
        await andamento(dir, o._id, {
            situacao: 'concluida',
            anotacao: 'Mediação feita com as duas turmas.',
        });

        expect((await andamento(dir, o._id, { situacao: 'em_apuracao' })).status).toBe(400);
        const reaberta = await andamento(dir, o._id, {
            situacao: 'em_apuracao',
            anotacao: 'A família relatou que o caso voltou a acontecer.',
        });
        expect(reaberta.status).toBe(200);
        expect(reaberta.body.data.andamentos.map((a) => a.situacao)).toEqual([
            'concluida',
            'em_apuracao',
        ]);
    });

    it('recusa situação inválida e andamento que não muda nada', async () => {
        const o = await denuncia('bullying');
        const sec = await pessoa('secretaria');

        expect((await andamento(sec, o._id, { situacao: 'nova' })).status).toBe(400);
        expect((await andamento(sec, o._id, { situacao: 'arquivada' })).status).toBe(400);
        expect(
            (await andamento(sec, o._id, { situacao: 'em_apuracao', anotacao: 'x'.repeat(1001) }))
                .status
        ).toBe(400);

        expect((await andamento(sec, o._id, { situacao: 'em_apuracao' })).status).toBe(200);
        const repetido = await andamento(sec, o._id, { situacao: 'em_apuracao' });
        expect(repetido.status).toBe(400);
        expect(repetido.body.codigo).toBe('SEM_MUDANCA');
    });
});
