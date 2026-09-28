/**
 * conselhoTutelarViolencia.regressao.test.js — Issue #511
 *
 * Denúncia de violência, assédio ou automutilação obriga a escola a comunicar
 * o Conselho Tutelar (ECA, arts. 13, 56-I e 245; Lei 13.819/2019; LDB, art.
 * 12, VIII, na redação da Lei 15.231/2025). O sistema guarda a prova da
 * comunicação e mostra o que está pendente, sem expor o relato.
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

const RELATO = 'Relato fixture de violência com a Joana Fixture no recreio.';

let escolaA;
let escolaB;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

function equipe(perfil, escola = escolaA) {
    return criarUsuario({
        email: `${perfil}${Math.random()}@escola.test`,
        perfil,
        escolaId: String(escola._id),
    });
}

async function denuncia(categoria, escola = escolaA) {
    const { ocorrencia } = await ModeracaoService.registrarDenunciaAberta({
        categoria,
        relato: RELATO,
        contexto: {
            escolaId: String(escola._id),
            remetenteId: 'r1',
            remetentePerfil: 'responsavel',
        },
    });
    return ocorrencia;
}

function registrar(quem, ocorrencia, corpo) {
    return request(app)
        .post(`/api/moderacao/ocorrencia/${ocorrencia._id}/conselho-tutelar`)
        .set('Cookie', cookieDe(quem))
        .send(corpo);
}

const COMUNICACAO = {
    acao: 'comunicar',
    comunicadoEm: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    meio: 'oficio',
    protocolo: 'CT-2026/001',
};

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

describe('exigência pela categoria', () => {
    it('violência, assédio e automutilação nascem com a comunicação pendente; bullying não', async () => {
        for (const categoria of ['violencia', 'assedio', 'automutilacao']) {
            const o = (await denuncia(categoria)).toObject();
            expect({ categoria, ...o.conselhoTutelar }).toMatchObject({
                categoria,
                exigida: true,
                situacao: 'pendente',
                sigilosa: categoria === 'automutilacao',
            });
        }
        expect((await denuncia('bullying')).toObject().conselhoTutelar).toBeUndefined();
    });
});

describe('fila de pendentes', () => {
    it('lista só as da escola, sem relato nem autor, e inclui denúncia antiga sem o campo', async () => {
        const nova = await denuncia('automutilacao');
        await denuncia('bullying');
        await denuncia('violencia', escolaB);
        // Denúncia gravada antes da Issue #511: sem `conselhoTutelar`.
        const antiga = await ModeracaoOcorrencia.create({
            escolaId: String(escolaA._id),
            tipoConteudo: 'texto',
            camada: 'denuncia',
            severidade: 'grave',
            decisaoAutomatica: 'em_revisao',
            categoriaDenuncia: 'violencia',
            relato: RELATO,
        });

        const res = await request(app)
            .get('/api/moderacao/conselho-tutelar/pendentes')
            .set('Cookie', cookieDe(await equipe('secretaria')));

        expect(res.status).toBe(200);
        expect(res.body.data.map((d) => d.id).sort()).toEqual(
            [String(nova._id), String(antiga._id)].sort()
        );
        expect(res.body.data.find((d) => d.id === String(nova._id)).sigilosa).toBe(true);
        const corpo = JSON.stringify(res.body);
        expect(corpo).not.toContain('Joana');
        expect(corpo).not.toContain('remetente');
    });

    it('professor e responsável não acessam a fila', async () => {
        for (const perfil of ['professor', 'responsavel']) {
            const res = await request(app)
                .get('/api/moderacao/conselho-tutelar/pendentes')
                .set('Cookie', cookieDe(await equipe(perfil)));
            expect({ perfil, status: res.status }).toEqual({ perfil, status: 403 });
        }
    });
});

describe('registro da comunicação', () => {
    it('secretaria registra a comunicação; sai da fila e vai ao AuditLog sem o relato', async () => {
        const o = await denuncia('violencia');
        const sec = await equipe('secretaria');

        const res = await registrar(sec, o, COMUNICACAO);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ situacao: 'comunicado', meio: 'oficio' });

        const salvo = (await ModeracaoOcorrencia.findById(o._id).lean()).conselhoTutelar;
        expect(salvo).toMatchObject({
            exigida: true,
            situacao: 'comunicado',
            protocolo: 'CT-2026/001',
            registradoPor: String(sec._id),
            registradoPerfil: 'secretaria',
        });

        const fila = await request(app)
            .get('/api/moderacao/conselho-tutelar/pendentes')
            .set('Cookie', cookieDe(sec));
        expect(fila.body.data).toHaveLength(0);

        const log = await AuditLog.findOne({ acao: 'CONSELHO_TUTELAR_COMUNICADO' }).lean();
        expect(log.recursoId).toBe(String(o._id));
        expect(JSON.stringify(log)).not.toContain('Joana');
    });

    it('recusa data futura, meio desconhecido e ação inválida', async () => {
        const o = await denuncia('violencia');
        const dir = await equipe('diretor');
        const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        expect((await registrar(dir, o, { ...COMUNICACAO, comunicadoEm: futuro })).status).toBe(
            400
        );
        expect((await registrar(dir, o, { ...COMUNICACAO, comunicadoEm: undefined })).status).toBe(
            400
        );
        expect((await registrar(dir, o, { ...COMUNICACAO, meio: 'pombo' })).status).toBe(400);
        expect((await registrar(dir, o, { acao: 'esquecer' })).status).toBe(400);
        expect((await ModeracaoOcorrencia.findById(o._id).lean()).conselhoTutelar.situacao).toBe(
            'pendente'
        );
    });

    it('não registra duas vezes', async () => {
        const o = await denuncia('assedio');
        const dir = await equipe('diretor');
        expect((await registrar(dir, o, COMUNICACAO)).status).toBe(200);
        const segunda = await registrar(dir, o, COMUNICACAO);
        expect(segunda.status).toBe(409);
        expect(segunda.body.codigo).toBe('COMUNICACAO_JA_REGISTRADA');
    });

    it('gestão de outra escola não alcança a ocorrência', async () => {
        const o = await denuncia('violencia');
        const res = await registrar(await equipe('diretor', escolaB), o, COMUNICACAO);
        expect(res.status).toBe(404);
    });
});

describe('dispensa', () => {
    const DISPENSA = {
        acao: 'dispensar',
        justificativa: 'Apuração concluiu que o relato era sobre uma encenação da aula de teatro.',
    };

    it('só a direção dispensa, com justificativa, e o AuditLog não guarda o texto', async () => {
        const o = await denuncia('violencia');

        const daSecretaria = await registrar(await equipe('secretaria'), o, DISPENSA);
        expect(daSecretaria.status).toBe(403);
        expect(daSecretaria.body.codigo).toBe('DISPENSA_SO_DIRECAO');

        const dir = await equipe('diretor');
        expect(
            (await registrar(dir, o, { acao: 'dispensar', justificativa: 'curta' })).status
        ).toBe(400);
        expect((await registrar(dir, o, DISPENSA)).status).toBe(200);

        const salvo = (await ModeracaoOcorrencia.findById(o._id).lean()).conselhoTutelar;
        expect(salvo.situacao).toBe('dispensado');
        expect(salvo.justificativaDispensa).toBe(DISPENSA.justificativa);

        const log = await AuditLog.findOne({ acao: 'CONSELHO_TUTELAR_DISPENSADO' }).lean();
        expect(JSON.stringify(log)).not.toContain('teatro');
    });
});
