/**
 * conformidadeRotas.test.js — os deveres legais ponta a ponta.
 *
 * O QUE ESTA SUITE PROTEGE
 * ------------------------
 * O motor da LDB já é testado isoladamente em `frequenciaLdb.test.js`. Aqui o
 * que está sob teste é o caminho entre o banco e a resposta, onde moram os três
 * defeitos que a conta pura não pega:
 *
 *   1. CONTAGEM POR DIA. `Falta` guarda um documento por chamada, e a chamada
 *      tem matéria. Escola que registra cinco aulas por dia produziria cinco
 *      "faltas" onde a lei enxerga um dia — e o gatilho do Conselho Tutelar
 *      (15 dias) dispararia com 3 dias de ausência.
 *   2. RECORTE POR PERFIL E POR ESCOLA. Frequência, ficha do Conselho e Censo
 *      são dados de criança; professor só pode ver as próprias turmas e nenhuma
 *      escola enxerga a outra.
 *   3. RASTRO. Toda exportação daqui precisa deixar AuditLog — é o art. 15 do
 *      Marco Civil e a responsabilização da LGPD. Sem log, a rede não consegue
 *      provar quem levou dado de aluno para fora do sistema.
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Falta = require('../models/Falta');
const Professor = require('../models/Professor');
const Secretaria = require('../models/Secretaria');
const AuditLog = require('../models/AuditLog');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const ANO = 2026;

let escolaA;
let escolaB;

/** Cria a sessão de um perfil já vinculado à escola (é o que resolve req.escolaId). */
async function sessao(perfil, escola, extras = {}) {
    const escolaId = String(escola._id);
    const usuario = await criarUsuario({
        email: `${perfil}_${Date.now()}_${Math.random().toString(36).slice(2)}@escola.test`,
        perfil,
        escolaId,
    });
    const vinculos = [{ escolaId, cargo: perfil }];

    if (perfil === 'professor') {
        await Professor.create({
            idUsuario: String(usuario._id),
            nome: usuario.nome,
            email: usuario.email,
            salaPrincipal: extras.salaPrincipal || '1A',
            vinculos,
            ativo: true,
        });
    } else if (perfil === 'secretaria') {
        await Secretaria.create({
            idUsuario: String(usuario._id),
            nome: usuario.nome,
            email: usuario.email,
            vinculos,
        });
    }

    invalidarCacheEscolas();
    return { usuario, cookies: [`escola_jwt=${assinarTokenSessao(usuario)}`] };
}

async function criarAluno(escola, dados) {
    return Aluno.create({ escolaId: String(escola._id), ativo: true, ...dados });
}

/** Registra a chamada de um dia. `materias` permite simular escola com 5 aulas. */
async function registrarChamada(
    escola,
    aluno,
    dia,
    { presente = false, materias = ['Sala Principal'], justificada = false } = {}
) {
    for (const materia of materias) {
        await Falta.create({
            escolaId: String(escola._id),
            aluno: String(aluno._id),
            turma: aluno.turma,
            data: new Date(`${dia}T12:00:00Z`), // meio-dia UTC = 09h em São Paulo
            materia,
            presente,
            justificada,
        });
    }
}

/** N dias consecutivos de ausência integral, a partir de 02/03. */
async function faltarDias(escola, aluno, quantidade, opcoes = {}) {
    for (let i = 0; i < quantidade; i += 1) {
        const dia = new Date(Date.UTC(ANO, 2, 2 + i)).toISOString().slice(0, 10);
        await registrarChamada(escola, aluno, dia, opcoes);
    }
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({
        nome: `EMEF Conformidade A ${Date.now()}`,
        tipo: 'EMEF',
        ativo: true,
        codigoInep: '35000001',
    });
    escolaB = await Escola.create({
        nome: `CIEP Conformidade B ${Date.now()}`,
        tipo: 'CIEP',
        ativo: true,
        codigoInep: '35000002',
    });
    invalidarCacheEscolas();
});

describe('GET /api/conformidade/frequencia/alertas', () => {
    it('lista só quem já obriga providência legal', async () => {
        const emAlerta = await criarAluno(escolaA, { nome: 'Ana', turma: '1A' });
        const regular = await criarAluno(escolaA, { nome: 'Bruno', turma: '1A' });
        await faltarDias(escolaA, emAlerta, 16);
        await faltarDias(escolaA, regular, 3);

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app)
            .get(`/api/conformidade/frequencia/alertas?anoLetivo=${ANO}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({
            nome: 'Ana',
            faltas: 16,
            status: 'ALERTA_CONSELHO_TUTELAR',
        });
    });

    it('conta DIA, não registro de chamada: 5 aulas no mesmo dia são 1 falta', async () => {
        // Sem isso, a escola que registra por matéria dispararia a comunicação
        // ao Conselho Tutelar com 3 dias de ausência.
        const aluno = await criarAluno(escolaA, { nome: 'Carla', turma: '1A' });
        const cincoAulas = ['Português', 'Matemática', 'História', 'Ciências', 'Arte'];
        await faltarDias(escolaA, aluno, 4, { materias: cincoAulas });

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app)
            .get(`/api/conformidade/frequencia/alertas?anoLetivo=${ANO}&somenteAlertas=false`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.data[0].faltas).toBe(4);
        expect(res.body.data[0].status).toBe('REGULAR');
    });

    it('dia com presença em uma aula e ausência em outra não é dia de falta', async () => {
        const aluno = await criarAluno(escolaA, { nome: 'Davi', turma: '1A' });
        await registrarChamada(escolaA, aluno, `${ANO}-03-02`, {
            presente: true,
            materias: ['Português'],
        });
        await registrarChamada(escolaA, aluno, `${ANO}-03-02`, {
            presente: false,
            materias: ['Matemática'],
        });

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app)
            .get(`/api/conformidade/frequencia/alertas?anoLetivo=${ANO}&somenteAlertas=false`)
            .set('Cookie', cookies);

        expect(res.body.data[0].faltas).toBe(0);
        expect(res.body.data[0].diasParciais).toBe(1);
    });

    it('professor enxerga apenas os alunos das turmas que leciona', async () => {
        const daTurmaDele = await criarAluno(escolaA, { nome: 'Elisa', turma: '1A' });
        const deOutraTurma = await criarAluno(escolaA, { nome: 'Fabio', turma: '2B' });
        await faltarDias(escolaA, daTurmaDele, 16);
        await faltarDias(escolaA, deOutraTurma, 20);

        const { cookies } = await sessao('professor', escolaA, { salaPrincipal: '1A' });
        const res = await request(app)
            .get(`/api/conformidade/frequencia/alertas?anoLetivo=${ANO}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.data.map((a) => a.nome)).toEqual(['Elisa']);
    });

    it('não atravessa a fronteira entre escolas', async () => {
        const daOutraEscola = await criarAluno(escolaB, { nome: 'Gabriel', turma: '1A' });
        await faltarDias(escolaB, daOutraEscola, 30);

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app)
            .get(`/api/conformidade/frequencia/alertas?anoLetivo=${ANO}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
    });
});

describe('GET /api/conformidade/frequencia/:alunoId', () => {
    it('discrimina os dias faltados — é o que a ficha precisa listar', async () => {
        const aluno = await criarAluno(escolaA, { nome: 'Helena', turma: '1A' });
        await registrarChamada(escolaA, aluno, `${ANO}-03-02`);
        await registrarChamada(escolaA, aluno, `${ANO}-03-03`, { justificada: true });

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app)
            .get(`/api/conformidade/frequencia/${aluno._id}?anoLetivo=${ANO}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.data.faltas).toBe(2);
        expect(res.body.data.justificadas).toBe(1);
        expect(res.body.data.datasDeFalta).toEqual([
            { data: `${ANO}-03-02`, justificada: false },
            { data: `${ANO}-03-03`, justificada: true },
        ]);
    });

    it('recusa (403) o professor que pede aluno de outra turma', async () => {
        const deOutraTurma = await criarAluno(escolaA, { nome: 'Igor', turma: '2B' });
        await faltarDias(escolaA, deOutraTurma, 5);

        const { cookies } = await sessao('professor', escolaA, { salaPrincipal: '1A' });
        const res = await request(app)
            .get(`/api/conformidade/frequencia/${deOutraTurma._id}?anoLetivo=${ANO}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(403);
    });
});

describe('GET /api/conformidade/frequencia/:alunoId/ficha-conselho', () => {
    it('devolve o PDF e deixa rastro em AuditLog', async () => {
        const aluno = await criarAluno(escolaA, {
            nome: 'Joana',
            turma: '1A',
            endereco: { logradouro: 'Rua das Acácias', numero: '120', bairro: 'Centro' },
            responsaveis: [{ nome: 'Marta', tipo: 'Mãe', telefone: '(19) 99999-0000' }],
        });
        await faltarDias(escolaA, aluno, 16);

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app)
            .get(`/api/conformidade/frequencia/${aluno._id}/ficha-conselho?anoLetivo=${ANO}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');

        const log = await AuditLog.findOne({ acao: 'EXPORTAR_FICHA_CONSELHO_TUTELAR' }).lean();
        expect(log).toBeTruthy();
        expect(log.recursoId).toBe(String(aluno._id));
        expect(log.escolaId).toBe(String(escolaA._id));
    });

    it('professor não emite a ficha: quem comunica a autoridade é a gestão', async () => {
        const aluno = await criarAluno(escolaA, { nome: 'Kaio', turma: '1A' });
        await faltarDias(escolaA, aluno, 16);

        const { cookies } = await sessao('professor', escolaA, { salaPrincipal: '1A' });
        const res = await request(app)
            .get(`/api/conformidade/frequencia/${aluno._id}/ficha-conselho`)
            .set('Cookie', cookies);

        expect(res.status).toBe(403);
    });
});

describe('GET /api/conformidade/educacenso', () => {
    it('aponta as pendências por aluno antes do prazo do Censo', async () => {
        await criarAluno(escolaA, {
            nome: 'Lia',
            sobrenome: 'Martins',
            matricula: '2026010',
            turma: '1A',
            nascimento: new Date('2016-05-02T00:00:00Z'),
            sexo: 'Feminino',
            etnia: 'Parda',
            nacionalidade: 'Brasileira',
        });
        await criarAluno(escolaA, { nome: 'Miguel', turma: '1A' });

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app).get('/api/conformidade/educacenso').set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.data.resumo).toMatchObject({ totalAlunos: 2, alunosComPendencia: 1 });
        expect(res.body.data.cabecalho.codigoInepEscola).toBe('35000001');
        expect(res.body.data.pendencias[0].nome).toBe('Miguel');
        expect(await AuditLog.countDocuments({ acao: 'EXPORTAR_EDUCACENSO' })).toBe(1);
    });

    it('professor não exporta declaração da unidade', async () => {
        const { cookies } = await sessao('professor', escolaA);
        const res = await request(app).get('/api/conformidade/educacenso').set('Cookie', cookies);
        expect(res.status).toBe(403);
    });
});

describe('GET /api/conformidade/dados-abertos', () => {
    it('publica agregados sem nenhum identificador de aluno', async () => {
        for (let i = 0; i < 8; i += 1) {
            await criarAluno(escolaA, { nome: `Aluno ${i}`, turma: '1A', etnia: 'Parda' });
        }
        // Turma minúscula: não pode aparecer isolada no portal da transparência.
        await criarAluno(escolaA, { nome: 'Único', turma: 'Classe hospitalar' });

        const { cookies } = await sessao('secretaria', escolaA);
        const res = await request(app)
            .get(`/api/conformidade/dados-abertos?anoLetivo=${ANO}`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(res.body.data.matriculas.totalAtivos).toBe(9);

        const bruto = JSON.stringify(res.body.data);
        expect(bruto).not.toContain('Classe hospitalar');
        expect(bruto).not.toContain('Único');
        expect(bruto).not.toContain('Aluno 1');
        expect(res.body.data.metadados.anonimizacao.limiar).toBe(5);
    });
});
