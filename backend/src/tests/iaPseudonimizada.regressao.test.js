/**
 * iaPseudonimizada.regressao.test.js — Issue #401
 *
 * O que sai do servidor para o provedor de IA é capturado aqui e conferido:
 * não pode ter nome de criança, identificador, data de nascimento nem os
 * campos bloqueados (motivo de falta, saúde, observação em texto livre).
 * Também cobre o interruptor por escola e a narração.
 */
const request = require('supertest');

// O provedor é trocado por um espião: nada sai da máquina, e o teste lê
// exatamente o que teria sido enviado.
const enviados = [];
jest.mock('../services/voiceService', () => ({
    generateInsightText: jest.fn(async (prompt) => {
        enviados.push(prompt);
        return 'Aluno A vai bem em Matemática.';
    }),
}));

const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const Professor = require('../models/Professor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { criarMapa } = require('../services/ia/pseudonimizar');
const escopoAlunos = require('../services/ia/escopoAlunos');
const interruptor = require('../services/ia/interruptor');

const NOME = 'Joaquim Evangelista';
const PROIBIDO = [
    NOME,
    'Joaquim',
    'alergia',
    'Dipirona',
    'TEA',
    'consulta médica',
    'mae@familia.test',
    '00000000191',
];

let escola;
let aluno;
let prof;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    enviados.length = 0;
    escopoAlunos.limparCache();
    interruptor.limparCache();
    process.env.IA_ESCOLAS_PADRAO = 'ligada';
    // O chatbot só chama o provedor quando há chave configurada; o provedor
    // em si está trocado pelo espião no topo do arquivo.
    process.env.GEMINI_KEY = 'fixture-sem-valor';

    escola = await Escola.create({ nome: 'EMEF IA', tipo: 'EMEF', ativo: true });
    aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: NOME,
        turma: '1A',
        matricula: 'RA-9',
        cpfAluno: '00000000191',
        nascimento: new Date('2016-05-04'),
        alergiasRemedio: 'Dipirona',
        deficiencia: 'TEA',
        observacoes: 'conversa muito em sala',
        responsavel: 'mae@familia.test',
        ativo: true,
    });
    await Nota.create({
        alunoId: String(aluno._id),
        turmaId: '1A',
        materiaId: 'Matemática',
        bimestre: 1,
        nota: 7,
        escolaId: String(escola._id),
    });
    await Falta.create({
        escolaId: String(escola._id),
        aluno: String(aluno._id),
        turma: '1A',
        data: new Date(),
        presente: false,
        motivo: 'consulta médica',
    });

    prof = await criarUsuario({
        email: 'prof@escola.test',
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(prof._id),
        nome: prof.nome,
        email: prof.email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    invalidarCacheEscolas();
});
afterAll(() => {
    process.env.IA_ESCOLAS_PADRAO = undefined;
});

function conferirEnvio(texto) {
    for (const proibido of PROIBIDO) {
        expect({ proibido, encontrado: texto.includes(proibido) }).toEqual({
            proibido,
            encontrado: false,
        });
    }
}

describe('chatbot', () => {
    it('não envia nome, identificador nem campo bloqueado — e responde com o nome real', async () => {
        const res = await request(app)
            .post('/api/ia/chatbot')
            .set('Cookie', cookieDe(prof))
            .send({ message: `Como está o ${NOME}?` });

        expect(res.status).toBe(200);
        expect(enviados).toHaveLength(1);
        conferirEnvio(enviados[0]);
        expect(enviados[0]).toMatch(/Aluno [A-Z]/);
        // O nome volta para quem está logado.
        expect(res.body.data.response).toContain('Joaquim');
    });
});

describe('plano de estudos', () => {
    it('vai com rótulo no lugar do nome', async () => {
        const res = await request(app)
            .post('/api/ia/plano-estudo')
            .set('Cookie', cookieDe(prof))
            .send({ alunoId: String(aluno._id), objetivos: 'melhorar em matemática' });

        expect(res.status).toBe(200);
        expect(enviados).toHaveLength(1);
        conferirEnvio(enviados[0]);
        expect(res.body.data.planoHtml).toContain('Joaquim');
    });
});

describe('interruptor por escola', () => {
    it('escola com IA desligada recebe 403 e nada é enviado', async () => {
        await Escola.updateOne({ _id: escola._id }, { $set: { iaHabilitada: false } });
        interruptor.limparCache();

        const res = await request(app)
            .post('/api/ia/chatbot')
            .set('Cookie', cookieDe(prof))
            .send({ message: 'e aí?' });

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('IA_DESLIGADA_NESTA_ESCOLA');
        expect(enviados).toHaveLength(0);
    });

    it('padrão da rede desligado barra escola sem decisão', async () => {
        process.env.IA_ESCOLAS_PADRAO = 'desligada';
        interruptor.limparCache();
        const res = await request(app)
            .post('/api/ia/chatbot')
            .set('Cookie', cookieDe(prof))
            .send({ message: 'e aí?' });
        expect(res.status).toBe(403);
        process.env.IA_ESCOLAS_PADRAO = 'ligada';
    });

    it('admin liga e desliga a IA da escola', async () => {
        const admin = await criarUsuario({ email: 'admin@rede.test', perfil: 'admin' });
        const res = await request(app)
            .patch(`/api/escolas/${escola._id}/ia`)
            .set('Cookie', cookieDe(admin))
            .send({ habilitada: false });
        expect(res.status).toBe(200);
        expect(res.body.data.iaHabilitada).toBe(false);
    });
});

describe('narração', () => {
    it('recusa texto que cita aluno e aceita texto sem aluno', async () => {
        const comAluno = await request(app)
            .post('/api/tts/speak')
            .set('Cookie', cookieDe(prof))
            .send({ text: `${NOME} tirou 7 em Matemática.` });
        expect(comAluno.status).toBe(403);
        expect(comAluno.body.codigo).toBe('NARRACAO_COM_DADO_DE_ALUNO');

        const semAluno = await request(app)
            .post('/api/tts/speak')
            .set('Cookie', cookieDe(prof))
            .send({ text: 'A reunião de pais será na quinta-feira.' });
        expect(semAluno.status).not.toBe(403);
    });
});

describe('camada de pseudonimização', () => {
    it('mesmo aluno recebe sempre o mesmo rótulo, e o mapa traduz de volta', () => {
        const mapa = criarMapa();
        const a = mapa.mascarar({ id: 'abc', nome: 'Maria Silva', nota: 8 });
        const b = mapa.mascarar({ alunoId: 'abc', nota: 9 });
        expect(a.nome).toBe(b.alunoId);
        expect(mapa.reidentificar(`${a.nome} melhorou`)).toBe('Maria Silva melhorou');
        expect(mapa.idDoRotulo(a.nome)).toBe('abc');
    });

    it('campos bloqueados não passam, em qualquer nível', () => {
        const mapa = criarMapa();
        const saida = mapa.mascarar({
            turma: '1A',
            alunos: [{ nome: 'Ana', cpfAluno: '123', alergiasRemedio: 'Dipirona' }],
            faltas: [{ data: '2026-01-01', motivo: 'consulta médica' }],
        });
        const texto = JSON.stringify(saida);
        expect(texto).not.toContain('Ana');
        expect(texto).not.toContain('123');
        expect(texto).not.toContain('Dipirona');
        expect(texto).not.toContain('consulta médica');
        expect(texto).toContain('1A');
    });

    it('o tradutor de fluxo remonta o rótulo partido entre pedaços', () => {
        const mapa = criarMapa();
        const rotulo = mapa.registrarAluno({ id: '1', nome: 'Carlos' });
        const fluxo = mapa.criarTradutorDeFluxo();
        const partes = [`${rotulo.slice(0, 3)}`, `${rotulo.slice(3)} foi bem`];
        const saida = partes.map((p) => fluxo.traduzir(p)).join('') + fluxo.finalizar();
        expect(saida).toBe('Carlos foi bem');
    });
});
