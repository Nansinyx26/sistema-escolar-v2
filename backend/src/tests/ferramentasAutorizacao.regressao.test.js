/**
 * ferramentasAutorizacao.regressao.test.js — Issue #721 (Etapa 1 da #720)
 *
 * A direção decide, por professor, quais ferramentas do catálogo ele usa. O
 * que estes testes protegem:
 *   - isolamento por escola: a direção só vê e decide sobre professores da
 *     própria escola, e a autorização dada numa escola não vale na outra;
 *   - o professor nunca grava a própria autorização;
 *   - a verificação lê o banco a cada uso (a decisão vale na hora);
 *   - toda mudança vai ao AuditLog com quem, professor, ferramenta, antes e depois.
 */
const express = require('express');
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const AuditLog = require('../models/AuditLog');
const PermissaoFerramenta = require('../models/PermissaoFerramenta');
const SolicitacaoFerramenta = require('../models/SolicitacaoFerramenta');
const { checkToolPermission } = require('../services/ferramentas/permissaoFerramenta');
const { exigirFerramenta, CODIGO_NAO_AUTORIZADA } = require('../middleware/exigirFerramenta');
const { FERRAMENTAS, existeFerramenta } = require('../services/ferramentas/catalogo');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

let escolaA;
let escolaB;
let diretorA;
let profA;
let profSemCadastro;
let profComVinculo;
let profB;

async function cenario() {
    escolaA = await Escola.create({ nome: 'EMEF Ferramentas A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'EMEF Ferramentas B', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();
    const A = String(escolaA._id);
    const B = String(escolaB._id);

    diretorA = await criarUsuario({
        nome: 'Diretora A',
        email: 'dir.ferr@escola.test',
        perfil: 'diretor',
        escolaId: A,
    });

    profA = await criarUsuario({
        nome: 'João Silva',
        email: 'joao.ferr@escola.test',
        perfil: 'professor',
        escolaId: A,
    });
    await Professor.create({
        idUsuario: String(profA._id),
        nome: 'João Silva',
        salaPrincipal: '3A',
        materias: ['Matemática'],
        vinculos: [{ escolaId: A, cargo: 'professor' }],
    });

    profSemCadastro = await criarUsuario({
        nome: 'Maria Souza',
        email: 'maria.ferr@escola.test',
        perfil: 'professor',
        escolaId: A,
    });

    // Conta registrada na escola B, com vínculo adicional na A (Issue #707).
    profComVinculo = await criarUsuario({
        nome: 'Carlos Santos',
        email: 'carlos.ferr@escola.test',
        perfil: 'professor',
        escolaId: B,
    });
    await Professor.create({
        idUsuario: String(profComVinculo._id),
        nome: 'Carlos Santos',
        salaPrincipal: '1B',
        vinculos: [
            { escolaId: B, cargo: 'professor' },
            { escolaId: A, cargo: 'professor', turmas: ['5C'] },
        ],
    });

    profB = await criarUsuario({
        nome: 'Prof Da Outra',
        email: 'outra.ferr@escola.test',
        perfil: 'professor',
        escolaId: B,
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
    invalidarCacheEscolas();
    await cenario();
});

function quadro(quem) {
    return request(app).get('/api/ferramentas/autorizacoes').set('Cookie', cookieDe(quem));
}

function salvar(quem, alteracoes) {
    return request(app)
        .put('/api/ferramentas/autorizacoes')
        .set('Cookie', cookieDe(quem))
        .send({ alteracoes });
}

function linhaDe(res, usuario) {
    return res.body.data.professores.find((p) => p.id === String(usuario._id));
}

describe('catálogo', () => {
    it('traz as quatro categorias, com IA e Autorizações dos Pais', async () => {
        const res = await request(app)
            .get('/api/ferramentas/catalogo')
            .set('Cookie', cookieDe(profA));
        expect(res.status).toBe(200);
        expect(res.body.data.map((c) => c.id)).toEqual(['ia', 'gestao', 'pedagogica', 'outras']);
        const ids = res.body.data.flatMap((c) => c.ferramentas.map((f) => f.id));
        expect(ids).toEqual(expect.arrayContaining(['ia.assistente', 'gestao.autorizacoes-pais']));
        expect(ids).toHaveLength(FERRAMENTAS.length);
        expect(ids.every(existeFerramenta)).toBe(true);
    });
});

describe('quadro da direção', () => {
    it('lista só os professores da própria escola, com turmas daqui, tudo bloqueado', async () => {
        const res = await quadro(diretorA);
        expect(res.status).toBe(200);

        const ids = res.body.data.professores.map((p) => p.id);
        expect(ids).toEqual(
            expect.arrayContaining([
                String(profA._id),
                String(profSemCadastro._id),
                String(profComVinculo._id),
            ])
        );
        expect(ids).not.toContain(String(profB._id));
        expect(ids).not.toContain(String(diretorA._id));

        const joao = linhaDe(res, profA);
        expect(joao.turmas).toEqual(['3A']);
        expect(joao.disciplinas).toEqual(['Matemática']);
        // A turma que o Carlos tem NA escola A, não a "1B" da escola dele.
        expect(linhaDe(res, profComVinculo).turmas).toEqual(['5C']);

        for (const f of FERRAMENTAS) expect(joao.ferramentas[f.id].status).toBe('bloqueado');
    });

    it('professor e secretaria não veem o quadro', async () => {
        const sec = await criarUsuario({
            email: 'sec.ferr@escola.test',
            perfil: 'secretaria',
            escolaId: String(escolaA._id),
        });
        expect((await quadro(profA)).status).toBe(403);
        expect((await quadro(sec)).status).toBe(403);
    });

    it('pedido pendente aparece como "pendente"', async () => {
        await SolicitacaoFerramenta.create({
            escolaId: String(escolaA._id),
            professorId: String(profA._id),
            ferramentaId: 'ia.assistente',
            mensagem: 'Quero preparar aulas com o assistente.',
        });
        const joao = linhaDe(await quadro(diretorA), profA);
        expect(joao.ferramentas['ia.assistente'].status).toBe('pendente');
        expect(joao.ferramentas['ia.assistente'].solicitacao.mensagem).toBe(
            'Quero preparar aulas com o assistente.'
        );
    });
});

describe('salvar autorizações', () => {
    it('autoriza, grava quem concedeu e audita com antes e depois', async () => {
        const res = await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.assistente', autorizado: true },
        ]);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Autorizações salvas com sucesso.');
        expect(res.body.data.alteradas).toBe(1);

        const doc = await PermissaoFerramenta.findOne({ professorId: String(profA._id) }).lean();
        expect(doc).toMatchObject({
            escolaId: String(escolaA._id),
            ferramentaId: 'ia.assistente',
            autorizado: true,
            autorizadoPor: String(diretorA._id),
            alteradoPor: String(diretorA._id),
        });
        expect(doc.autorizadoEm).toBeInstanceOf(Date);
        expect(doc.createdAt).toBeInstanceOf(Date);
        expect(doc.updatedAt).toBeInstanceOf(Date);

        const log = await AuditLog.findOne({ acao: 'FERRAMENTA_AUTORIZADA' }).lean();
        expect(String(log.usuarioId)).toBe(String(diretorA._id));
        expect(log.escolaId).toBe(String(escolaA._id));
        expect(log.detalhes.valorAnterior).toEqual({
            professorId: String(profA._id),
            ferramentaId: 'ia.assistente',
            autorizado: false,
        });
        expect(log.detalhes.valorNovo).toEqual({
            professorId: String(profA._id),
            ferramentaId: 'ia.assistente',
            autorizado: true,
        });
        expect(log.detalhes.descricao).toContain('João Silva');

        const celula = linhaDe(await quadro(diretorA), profA).ferramentas['ia.assistente'];
        expect(celula.status).toBe('autorizado');
        expect(celula.autorizadoPor.nome).toBe('Diretora A');
    });

    it('revoga, limpa quem concedeu e audita a revogação', async () => {
        const par = { professorId: String(profA._id), ferramentaId: 'gestao.autorizacoes-pais' };
        await salvar(diretorA, [{ ...par, autorizado: true }]);
        const res = await salvar(diretorA, [{ ...par, autorizado: false }]);
        expect(res.status).toBe(200);
        expect(res.body.data.alteradas).toBe(1);

        const doc = await PermissaoFerramenta.findOne(par).lean();
        expect(doc.autorizado).toBe(false);
        expect(doc.autorizadoPor).toBeNull();
        expect(doc.alteradoPor).toBe(String(diretorA._id));

        const log = await AuditLog.findOne({ acao: 'FERRAMENTA_REVOGADA' }).lean();
        expect(log.detalhes.valorAnterior.autorizado).toBe(true);
        expect(log.detalhes.valorNovo.autorizado).toBe(false);
    });

    it('par sem mudança não grava nem audita', async () => {
        const res = await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.assistente', autorizado: false },
        ]);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ alteradas: 0, inalteradas: 1 });
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
        expect(await AuditLog.countDocuments({ acao: /^FERRAMENTA_/ })).toBe(0);
    });

    it('autoriza o professor com vínculo adicional nesta escola', async () => {
        const res = await salvar(diretorA, [
            {
                professorId: String(profComVinculo._id),
                ferramentaId: 'ia.plano-aula',
                autorizado: true,
            },
        ]);
        expect(res.status).toBe(200);
        expect(res.body.data.alteradas).toBe(1);
    });

    it('professor de outra escola recusa o lote inteiro, sem gravar nada', async () => {
        const res = await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.assistente', autorizado: true },
            { professorId: String(profB._id), ferramentaId: 'ia.assistente', autorizado: true },
        ]);
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('PROFESSOR_FORA_DA_ESCOLA');
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
    });

    it('recusa ferramenta fora do catálogo e corpo malformado', async () => {
        const fora = await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.inventada', autorizado: true },
        ]);
        expect(fora.status).toBe(400);
        expect(fora.body.codigo).toBe('FERRAMENTA_DESCONHECIDA');

        const malformado = await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.assistente', autorizado: 'sim' },
        ]);
        expect(malformado.status).toBe(400);

        expect((await salvar(diretorA, [])).status).toBe(400);
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
    });

    it('o professor não se autoriza; a secretaria também não', async () => {
        const proprio = [
            { professorId: String(profA._id), ferramentaId: 'ia.assistente', autorizado: true },
        ];
        expect((await salvar(profA, proprio)).status).toBe(403);

        const sec = await criarUsuario({
            email: 'sec2.ferr@escola.test',
            perfil: 'secretaria',
            escolaId: String(escolaA._id),
        });
        expect((await salvar(sec, proprio)).status).toBe(403);
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
    });

    it('a decisão encerra o pedido pendente do par', async () => {
        const pedido = await SolicitacaoFerramenta.create({
            escolaId: String(escolaA._id),
            professorId: String(profA._id),
            ferramentaId: 'ia.atividades',
        });
        await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.atividades', autorizado: true },
        ]);
        const depois = await SolicitacaoFerramenta.findById(pedido._id).lean();
        expect(depois.status).toBe('autorizada');
        expect(depois.decididaPor).toBe(String(diretorA._id));
        expect(depois.decididaEm).toBeInstanceOf(Date);
    });
});

describe('checkToolPermission', () => {
    const comoProfessor = (u) => ({ id: String(u._id), perfil: 'professor' });

    it('direção e secretaria não são verificadas', async () => {
        const A = String(escolaA._id);
        const dir = { id: String(diretorA._id), perfil: 'diretor' };
        expect((await checkToolPermission(dir, A, 'ia.assistente')).liberado).toBe(true);
        expect(
            (await checkToolPermission({ id: 'x', perfil: 'secretaria' }, A, 'ia.assistente'))
                .liberado
        ).toBe(true);
    });

    it('professor sem autorização é negado; autorizado passa na hora', async () => {
        const A = String(escolaA._id);
        const antes = await checkToolPermission(comoProfessor(profA), A, 'ia.assistente');
        expect(antes).toEqual({ liberado: false, motivo: 'NAO_AUTORIZADO' });

        await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.assistente', autorizado: true },
        ]);
        expect((await checkToolPermission(comoProfessor(profA), A, 'ia.assistente')).liberado).toBe(
            true
        );
    });

    it('autorização da escola A não vale na escola B', async () => {
        await salvar(diretorA, [
            {
                professorId: String(profComVinculo._id),
                ferramentaId: 'ia.assistente',
                autorizado: true,
            },
        ]);
        const naB = await checkToolPermission(
            comoProfessor(profComVinculo),
            String(escolaB._id),
            'ia.assistente'
        );
        expect(naB.liberado).toBe(false);
    });

    it('sem escola ou com ferramenta desconhecida, nega', async () => {
        expect(
            (await checkToolPermission(comoProfessor(profA), null, 'ia.assistente')).motivo
        ).toBe('ESCOLA_NAO_RESOLVIDA');
        expect(
            (await checkToolPermission(comoProfessor(profA), String(escolaA._id), 'nao.existe'))
                .motivo
        ).toBe('FERRAMENTA_DESCONHECIDA');
    });
});

describe('exigirFerramenta', () => {
    function appCom(usuario, escolaId) {
        const mini = express();
        mini.get(
            '/ferramenta',
            (req, _res, next) => {
                req.user = usuario;
                req.escolaId = escolaId;
                next();
            },
            exigirFerramenta('ia.plano-aula'),
            (_req, res) => res.json({ ok: true })
        );
        return mini;
    }

    it('nega com 403 explicado, avisa do pedido pendente e libera na hora', async () => {
        const A = String(escolaA._id);
        const prof = { id: String(profA._id), perfil: 'professor' };

        const negado = await request(appCom(prof, A)).get('/ferramenta');
        expect(negado.status).toBe(403);
        expect(negado.body.codigo).toBe(CODIGO_NAO_AUTORIZADA);
        expect(negado.body.ferramenta).toEqual({
            id: 'ia.plano-aula',
            nome: 'Plano de aula com IA',
        });
        expect(negado.body.solicitacaoPendente).toBe(false);

        await SolicitacaoFerramenta.create({
            escolaId: A,
            professorId: prof.id,
            ferramentaId: 'ia.plano-aula',
        });
        expect((await request(appCom(prof, A)).get('/ferramenta')).body.solicitacaoPendente).toBe(
            true
        );

        await salvar(diretorA, [
            { professorId: prof.id, ferramentaId: 'ia.plano-aula', autorizado: true },
        ]);
        expect((await request(appCom(prof, A)).get('/ferramenta')).status).toBe(200);
    });

    it('diretor passa sem autorização', async () => {
        const dir = { id: String(diretorA._id), perfil: 'diretor' };
        const res = await request(appCom(dir, String(escolaA._id))).get('/ferramenta');
        expect(res.status).toBe(200);
    });

    it('chave fora do catálogo quebra na montagem da rota', () => {
        expect(() => exigirFerramenta('ia.inventada')).toThrow(/catálogo/);
    });
});

describe('minhas ferramentas', () => {
    function minhas(quem) {
        return request(app).get('/api/ferramentas/minhas').set('Cookie', cookieDe(quem));
    }

    it('professor vê bloqueado, pendente e autorizado', async () => {
        await SolicitacaoFerramenta.create({
            escolaId: String(escolaA._id),
            professorId: String(profA._id),
            ferramentaId: 'ia.plano-estudo',
        });
        await salvar(diretorA, [
            { professorId: String(profA._id), ferramentaId: 'ia.assistente', autorizado: true },
        ]);

        const res = await minhas(profA);
        expect(res.status).toBe(200);
        const status = Object.fromEntries(res.body.data.map((f) => [f.id, f.status]));
        expect(status['ia.assistente']).toBe('autorizado');
        expect(status['ia.plano-estudo']).toBe('pendente');
        expect(status['gestao.autorizacoes-pais']).toBe('bloqueado');
    });

    it('para a direção, tudo livre', async () => {
        const res = await minhas(diretorA);
        expect(res.status).toBe(200);
        expect(res.body.data.every((f) => f.status === 'livre')).toBe(true);
    });
});
