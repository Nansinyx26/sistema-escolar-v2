/**
 * encerramentoCadastro.regressao.test.js — Issue #409
 *
 * Duas portas que apagavam gente:
 *   1. `DELETE /api/alunos/:id` removia o documento do banco, levando junto o
 *      registro escolar que tem guarda obrigatória — e sem trilha.
 *   2. A rotina de inatividade anonimizava responsável de aluno matriculado e
 *      conta de equipe, apagando contato de emergência e autoria de lançamento.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { executarAnonimizacao, destinoDaConta } = require('../utils/anonimizacaoAutomatica');
const EnvioEmail = require('../services/EnvioEmail');

let escola;
let secretaria;
let aluno;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

function diasAtras(dias) {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d;
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    jest.restoreAllMocks();
    jest.spyOn(EnvioEmail, 'enviarEmail').mockResolvedValue({ ok: true });
    escola = await Escola.create({ nome: 'EMEF Encerramento', tipo: 'EMEF', ativo: true });
    aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Criança Fixture',
        turma: '1A',
        matricula: 'RA-9',
        responsavel: 'mae@familia.test',
        responsaveis: [{ nome: 'Mãe', email: 'mae@familia.test' }],
        ativo: true,
    });
    secretaria = await criarUsuario({
        email: 'secretaria@escola.test',
        perfil: 'secretaria',
        escolaId: String(escola._id),
    });
    invalidarCacheEscolas();
});

describe('DELETE /api/alunos/:id não apaga o registro escolar', () => {
    it('inativa o cadastro, preserva notas e registra no AuditLog', async () => {
        await Nota.create({
            alunoId: String(aluno._id),
            escolaId: String(escola._id),
            materia: 'Matemática',
            bimestre: 1,
            nota: 8,
        });

        const res = await request(app)
            .delete(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(secretaria));

        expect(res.status).toBe(200);
        expect(res.body.data.modo).toBe('inativar');

        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois).toBeTruthy(); // o documento continua existindo
        expect(depois.ativo).toBe(false);
        expect(depois.nome).toBe('Criança Fixture');
        expect(await Nota.countDocuments({ alunoId: String(aluno._id) })).toBe(1);

        const log = await AuditLog.findOne({ acao: 'ALUNO_INATIVADO' }).lean();
        expect(log).toBeTruthy();
        expect(String(log.recursoId)).toBe(String(aluno._id));
        expect(JSON.stringify(log.detalhes)).not.toContain('Criança Fixture');
    });

    it('modo=anonimizar recusa aluno matriculado e aceita quem saiu da rede', async () => {
        const recusa = await request(app)
            .delete(`/api/alunos/${aluno._id}?modo=anonimizar`)
            .set('Cookie', cookieDe(secretaria));
        expect(recusa.status).toBe(409);
        expect(recusa.body.codigo).toBe('ANONIMIZACAO_NAO_PERMITIDA');
        expect((await Aluno.findById(aluno._id).lean()).nome).toBe('Criança Fixture');

        await Aluno.updateOne({ _id: aluno._id }, { $set: { situacao: 'transferido' } });
        await Nota.create({
            alunoId: String(aluno._id),
            escolaId: String(escola._id),
            materia: 'Matemática',
            bimestre: 1,
            nota: 8,
        });

        const ok = await request(app)
            .delete(`/api/alunos/${aluno._id}?modo=anonimizar`)
            .set('Cookie', cookieDe(secretaria));
        expect(ok.status).toBe(200);
        expect(ok.body.data.modo).toBe('anonimizar');

        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois).toBeTruthy();
        expect(depois.nome).not.toBe('Criança Fixture');
        expect(depois.anonimizadoEm).toBeTruthy();
        expect(await Nota.countDocuments({ alunoId: String(aluno._id) })).toBe(1);
        expect(await AuditLog.findOne({ acao: 'ALUNO_ANONIMIZADO' }).lean()).toBeTruthy();
    });
});

describe('anonimização por inatividade', () => {
    async function contaInativa(perfil, email) {
        const u = await criarUsuario({ email, perfil, escolaId: String(escola._id) });
        await Usuario.updateOne({ _id: u._id }, { $set: { ultimoLogin: diasAtras(400) } });
        return u;
    }

    it('não anonimiza responsável de aluno matriculado', async () => {
        const mae = await contaInativa('responsavel', 'mae@familia.test');

        const r = await executarAnonimizacao();
        expect(r.executou).toBe(true);
        expect(r.resultado.preservados).toBe(1);

        const depois = await Usuario.findById(mae._id).lean();
        expect(depois.email).toBe('mae@familia.test');
        expect(depois.anonimizadoEm).toBeFalsy();
        expect(depois.ativo).toBe(true);
    });

    it('anonimiza responsável sem vínculo ativo', async () => {
        const solto = await contaInativa('responsavel', 'sem.vinculo@familia.test');

        const r = await executarAnonimizacao();
        expect(r.resultado.anonimizados).toBe(1);

        const depois = await Usuario.findById(solto._id).lean();
        expect(depois.email).toMatch(/@escola\.anon$/);
        expect(depois.anonimizadoEm).toBeTruthy();

        const log = await AuditLog.findOne({ acao: 'AUTO_ANONYMIZE_USER' }).lean();
        expect(log).toBeTruthy();
        expect(JSON.stringify(log.detalhes)).not.toContain('sem.vinculo@familia.test');
    });

    it('conta de equipe é desativada, não anonimizada — a autoria fica', async () => {
        const prof = await contaInativa('professor', 'prof@escola.test');

        const r = await executarAnonimizacao();
        expect(r.resultado.desativados).toBe(1);
        expect(r.resultado.anonimizados).toBe(0);

        const depois = await Usuario.findById(prof._id).lean();
        expect(depois.ativo).toBe(false);
        expect(depois.email).toBe('prof@escola.test');
        expect(depois.anonimizadoEm).toBeFalsy();

        const log = await AuditLog.findOne({ acao: 'AUTO_DESATIVAR_EQUIPE' }).lean();
        expect(log).toBeTruthy();
        expect(String(log.recursoId)).toBe(String(prof._id));
    });

    it('a escola pode decidir o contrário pelas chaves de ambiente', async () => {
        const prof = await contaInativa('professor', 'prof@escola.test');
        process.env.ANONIMIZACAO_EQUIPE = 'anonimizar';
        try {
            expect(await destinoDaConta(prof)).toBe('anonimizar');
        } finally {
            delete process.env.ANONIMIZACAO_EQUIPE;
        }
        expect(await destinoDaConta(prof)).toBe('desativar');
    });

    it('não manda aviso de anonimização para quem não será anonimizado', async () => {
        const mae = await criarUsuario({
            email: 'mae@familia.test',
            perfil: 'responsavel',
            escolaId: String(escola._id),
        });
        await Usuario.updateOne({ _id: mae._id }, { $set: { ultimoLogin: diasAtras(340) } });

        const r = await executarAnonimizacao();
        expect(r.resultado.avisoEnviados).toBe(0);
        expect(EnvioEmail.enviarEmail).not.toHaveBeenCalled();
    });
});
