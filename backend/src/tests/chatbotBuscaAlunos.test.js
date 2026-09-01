/**
 * chatbotBuscaAlunos.test.js
 * Busca de aluno do chatbot: o autocomplete do campo de mensagem e a resolução
 * de nome dentro de uma frase.
 *
 * O QUE ESTA SUÍTE PROTEGE
 * ------------------------
 * A busca antiga procurava o texto em QUALQUER posição do nome, sem normalizar
 * acento, palavra por palavra da mensagem. Com "quais as notas do joão", a
 * primeira palavra que sobrava do filtro era "as" — e "as" casa "Cássia" e
 * "Vasconcelos". O chat respondia sobre um aluno que ninguém pediu, e quem
 * digitava "joao" não achava "João".
 *
 * Cada teste aqui é uma digitação que precisa devolver exatamente os alunos do
 * banco que correspondem ao que foi escrito — e nenhum outro.
 *
 * ⚠️ Fixtures 100% SINTÉTICAS (§7.8). Nenhum RA, nome ou data real.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

const Escola = require('../models/Escola');
const Secretaria = require('../models/Secretaria');
const Aluno = require('../models/Aluno');
const ChatbotService = require('../services/ChatbotService');

const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const ROTA = '/api/ia/chatbot/alunos';

let escolaA;
let escolaB;
let cookieA;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();

    escolaA = await Escola.create({
        nome: 'EE Sintetica Alfa',
        tipo: 'EMEF',
        bairro: 'Alfa',
        codigoSecreto: 'COD-ALFA-1',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'EE Sintetica Beta',
        tipo: 'EMEF',
        bairro: 'Beta',
        codigoSecreto: 'COD-BETA-2',
        ativo: true,
    });

    cookieA = await cookieSecretaria(escolaA);
});

/** Secretaria vinculada a UMA escola — é o vínculo que resolve `req.escolaId`. */
async function cookieSecretaria(escola) {
    const usuario = await criarUsuario({
        perfil: 'secretaria',
        nome: 'Secretaria Sintetica',
        email: `sec_${String(escola._id).slice(-6)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@escola.test`,
    });
    await Secretaria.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        escolaId: String(escola._id),
        vinculos: [{ escolaId: String(escola._id), cargo: 'secretaria' }],
    });

    const token = jwt.sign(
        { id: usuario._id, perfil: usuario.perfil, email: usuario.email, nome: usuario.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

/**
 * Cria alunos na escola indicada. `Aluno.create` dispara o pre-save que grava
 * `nomeNormalizado` — é assim que um aluno entra no banco em produção, e é o
 * campo em que a busca por prefixo se apoia.
 *
 * A matrícula vem de um contador porque `{escolaId, matricula}` é único: dois
 * lotes criados no mesmo teste não podem reiniciar a numeração.
 */
let proximaMatricula = 0;
async function criarAlunos(escola, nomes) {
    return Aluno.create(
        nomes.map((nome) => ({
            nome,
            turma: '5A',
            turmaId: '5A',
            ativo: true,
            escolaId: String(escola._id),
            matricula: `90000000${String(proximaMatricula++).padStart(4, '0')}`,
        }))
    );
}

/** Nomes sugeridos para o texto digitado, na ordem em que apareceriam na lista. */
async function sugerir(texto, cookie = cookieA) {
    const res = await request(app)
        .get(`${ROTA}?q=${encodeURIComponent(texto)}`)
        .set('Cookie', cookie)
        .set('X-CSRF-Token', 'test');
    expect(res.status).toBe(200);
    return res.body.data;
}

// Turma do exemplo da Issue, mais dois nomes que só aparecem numa busca
// desancorada — são eles que denunciam a volta do bug.
const TURMA = [
    'João',
    'João Pedro',
    'José',
    'Julia',
    'Juliana',
    'Marcos',
    'Maria',
    'Cássia Vasconcelos',
    'Anderson Prado',
];

// ═════════════════════════════════════════════════════════════════════════════
// GET /api/ia/chatbot/alunos — o autocomplete do campo
// ═════════════════════════════════════════════════════════════════════════════

describe('autocomplete do chatbot — autorização', () => {
    it('exige sessão autenticada', async () => {
        const res = await request(app).get(`${ROTA}?q=jo`).set('X-CSRF-Token', 'test');
        expect(res.status).toBe(401);
    });

    it('não sugere aluno de outra escola', async () => {
        await criarAlunos(escolaA, ['João Silva']);
        await criarAlunos(escolaB, ['João Alheio']);

        const dados = await sugerir('joão');
        const nomes = dados.alunos.map((a) => a.nome);
        expect(nomes).toContain('João Silva');
        expect(nomes).not.toContain('João Alheio');
    });
});

describe('autocomplete do chatbot — o que aparece enquanto se digita', () => {
    beforeEach(async () => {
        await criarAlunos(escolaA, TURMA);
    });

    it('uma letra já mostra apenas quem começa com ela', async () => {
        const dados = await sugerir('J');
        expect(dados.alunos.map((a) => a.nome)).toEqual([
            'João',
            'João Pedro',
            'José',
            'Julia',
            'Juliana',
        ]);
    });

    it('cada letra a mais estreita a lista', async () => {
        expect((await sugerir('Jo')).alunos.map((a) => a.nome)).toEqual([
            'João',
            'João Pedro',
            'José',
        ]);
        expect((await sugerir('Joa')).alunos.map((a) => a.nome)).toEqual(['João', 'João Pedro']);
        expect((await sugerir('João')).alunos.map((a) => a.nome)).toEqual(['João', 'João Pedro']);
        expect((await sugerir('Jul')).alunos.map((a) => a.nome)).toEqual(['Julia', 'Juliana']);
        expect((await sugerir('Mar')).alunos.map((a) => a.nome)).toEqual(['Marcos', 'Maria']);
    });

    it('ignora acento e caixa nos dois sentidos', async () => {
        expect((await sugerir('joao')).alunos.map((a) => a.nome)).toEqual(['João', 'João Pedro']);
        expect((await sugerir('JOÃO')).alunos.map((a) => a.nome)).toEqual(['João', 'João Pedro']);
    });

    it('não devolve nome sem relação com o texto digitado', async () => {
        // "Cássia" e "Anderson" contêm "as" e "de" — as duas palavras que a
        // busca antiga procurava sozinhas no meio de uma frase.
        const nomes = (await sugerir('jo')).alunos.map((a) => a.nome);
        expect(nomes).not.toContain('Cássia Vasconcelos');
        expect(nomes).not.toContain('Anderson Prado');
    });

    it('avisa quando o nome procurado não existe', async () => {
        const dados = await sugerir('Zenon');
        expect(dados.total).toBe(0);
        // `buscavel` é o que autoriza o campo a dizer "Nenhum aluno encontrado".
        expect(dados.buscavel).toBe(true);
    });

    it('não trata uma pergunta sem nome como busca frustrada', async () => {
        // "notas" não é nome de ninguém — o campo fecha a lista em silêncio em
        // vez de anunciar que não achou nenhum aluno.
        const dados = await sugerir('notas');
        expect(dados.total).toBe(0);
        expect(dados.buscavel).toBe(false);
    });

    it('devolve o trecho que casou, e não a frase inteira', async () => {
        const dados = await sugerir('quais as notas do joão');
        expect(dados.termo).toBe('joão');
        expect(dados.alunos.map((a) => a.nome)).toEqual(['João', 'João Pedro']);
    });

    it('encontra pelo sobrenome, em qualquer ordem', async () => {
        await criarAlunos(escolaA, ['Beatriz Nogueira']);
        expect((await sugerir('nogueira beatriz')).alunos.map((a) => a.nome)).toEqual([
            'Beatriz Nogueira',
        ]);
    });

    it('não repete o mesmo aluno', async () => {
        const ids = (await sugerir('jo')).alunos.map((a) => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('autocomplete do chatbot — volume', () => {
    it('mostra no máximo 10 sugestões mesmo com a escola inteira casando', async () => {
        const muitos = Array.from(
            { length: 40 },
            (_, i) => `Joana Sintetica ${String(i).padStart(2, '0')}`
        );
        await criarAlunos(escolaA, muitos);

        const dados = await sugerir('joana');
        expect(dados.alunos).toHaveLength(10);
        // Os 10 primeiros em ordem alfabética — o corte é determinístico, não
        // "os 10 que o banco devolveu primeiro".
        expect(dados.alunos[0].nome).toBe('Joana Sintetica 00');
        expect(dados.alunos[9].nome).toBe('Joana Sintetica 09');
    });

    it('respeita o teto do parâmetro `limite`', async () => {
        await criarAlunos(escolaA, TURMA);
        const res = await request(app)
            .get(`${ROTA}?q=j&limite=3`)
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test');
        expect(res.status).toBe(200);
        expect(res.body.data.alunos).toHaveLength(3);
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// resolveAlunoContext — o nome dentro da frase que a pessoa mandou no chat
// ═════════════════════════════════════════════════════════════════════════════

describe('resolveAlunoContext — de quem a pergunta fala', () => {
    it('resolve o aluno citado e ignora as palavras da pergunta', async () => {
        await criarAlunos(escolaA, ['João Silva', 'Cássia Vasconcelos']);

        const r = await ChatbotService.resolveAlunoContext({
            alunoId: null,
            message: 'quais as notas do joão?',
            alunoFilter: {},
        });

        expect(r.aluno.nome).toBe('João Silva');
        expect(r.ambiguous).toBeFalsy();
    });

    it('acha o aluno com o nome digitado sem acento', async () => {
        await criarAlunos(escolaA, ['João Silva']);

        const r = await ChatbotService.resolveAlunoContext({
            alunoId: null,
            message: 'faltas do joao',
            alunoFilter: {},
        });

        expect(r.aluno.nome).toBe('João Silva');
    });

    it('não escolhe ninguém quando o nome citado não existe', async () => {
        await criarAlunos(escolaA, ['Cássia Vasconcelos', 'Anderson Prado']);

        // Nenhum aluno se chama assim — e nenhum dos dois cadastrados pode ser
        // oferecido só porque contém "as"/"de" no meio do nome.
        const r = await ChatbotService.resolveAlunoContext({
            alunoId: null,
            message: 'quais as notas do joão?',
            alunoFilter: {},
        });

        expect(r.aluno).toBeNull();
        expect(r.options).toBeUndefined();
    });

    it('não confunde um pedaço no meio do nome com o aluno pedido', async () => {
        await criarAlunos(escolaA, ['Mariana Souza']);

        const r = await ChatbotService.resolveAlunoContext({
            alunoId: null,
            message: 'notas da ana',
            alunoFilter: {},
        });

        expect(r.aluno).toBeNull();
    });

    it('prefere o nome mais completo citado na frase', async () => {
        await criarAlunos(escolaA, ['João Silva', 'João Pedro Ramos']);

        const r = await ChatbotService.resolveAlunoContext({
            alunoId: null,
            message: 'notas do joão pedro',
            alunoFilter: {},
        });

        expect(r.aluno.nome).toBe('João Pedro Ramos');
    });

    it('oferece botões só com os homônimos reais quando há empate', async () => {
        await criarAlunos(escolaA, ['João Silva', 'João Souza', 'Cássia Vasconcelos']);

        const r = await ChatbotService.resolveAlunoContext({
            alunoId: null,
            message: 'notas do joão',
            alunoFilter: {},
        });

        expect(r.ambiguous).toBe(true);
        const rotulos = r.options.map((o) => o.label);
        expect(rotulos).toHaveLength(2);
        expect(rotulos.some((l) => l.startsWith('João Silva'))).toBe(true);
        expect(rotulos.some((l) => l.startsWith('João Souza'))).toBe(true);
        expect(rotulos.some((l) => l.includes('Cássia'))).toBe(false);
    });

    it('um nome novo na pergunta troca o aluno de quem se falava antes', async () => {
        const [joao, maria] = await criarAlunos(escolaA, ['João Silva', 'Maria Souza']);

        // `alunoId` é o aluno do turno anterior. Continuar respondendo sobre
        // ele com outro nome escrito na frente é, para quem pergunta, o mesmo
        // que receber um aluno sorteado.
        const r = await ChatbotService.resolveAlunoContext({
            alunoId: String(joao._id),
            message: 'notas da maria souza',
            alunoFilter: {},
        });

        expect(r.alunoId).toBe(String(maria._id));
        expect(r.aluno.nome).toBe('Maria Souza');
    });

    it('mantém o aluno escolhido no botão quando o nome citado é o ambíguo', async () => {
        const [silva] = await criarAlunos(escolaA, ['João Silva', 'João Souza']);

        // É o que o clique no botão manda: o id escolhido + a pergunta original,
        // que cita o nome de DOIS alunos. A escolha da pessoa tem de prevalecer.
        const r = await ChatbotService.resolveAlunoContext({
            alunoId: String(silva._id),
            message: 'notas do joão',
            alunoFilter: {},
        });

        expect(r.alunoId).toBe(String(silva._id));
        expect(r.aluno.nome).toBe('João Silva');
    });

    it('mantém o contexto quando a pergunta seguinte não cita ninguém', async () => {
        const [joao] = await criarAlunos(escolaA, ['João Silva', 'Maria Souza']);

        const r = await ChatbotService.resolveAlunoContext({
            alunoId: String(joao._id),
            message: 'e as faltas?',
            alunoFilter: {},
        });

        expect(r.alunoId).toBe(String(joao._id));
    });

    it('nunca oferece mais botões do que a lista comporta', async () => {
        const muitos = Array.from(
            { length: 15 },
            (_, i) => `Joana Sintetica ${String(i).padStart(2, '0')}`
        );
        await criarAlunos(escolaA, muitos);

        const r = await ChatbotService.resolveAlunoContext({
            alunoId: null,
            message: 'notas da joana',
            alunoFilter: {},
        });

        expect(r.ambiguous).toBe(true);
        expect(r.options).toHaveLength(10);
    });
});
