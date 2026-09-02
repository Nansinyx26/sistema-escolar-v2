/**
 * vinculoTurmas.test.js — as perguntas de vínculo que o chat faz ao banco.
 *
 * O QUE ESTE ARQUIVO COBRE
 * ------------------------
 * `services/vinculoTurmas.js` responde, sem HTTP e sem sessão, duas perguntas
 * de recorte diferente:
 *
 *   • TURMA  — em que salas um professor leciona, em que salas estão os filhos
 *              de um responsável, e quem compartilha sala com quem (Issue #68);
 *   • ESCOLA — a que escolas um responsável está ligado pelos filhos, que é o
 *              recorte da política que fechou o chat da família na secretaria
 *              da escola do filho (`vinculoDoResponsavel`).
 *
 * As armadilhas são as mesmas nas duas: o e-mail do responsável mora em três
 * campos conforme a época do cadastro, é digitado à mão (caixa misturada) e
 * precisa casar por IGUALDADE — `ana@` não é `joana@`. Um teste por armadilha,
 * porque cada uma já deixou família de fora em produção.
 *
 * A política de quem fala com quem é testada por HTTP em
 * `chatDireto.canalDaFamilia.test.js`; aqui não se sobe servidor.
 *
 * Todos os nomes, e-mails e RAs aqui são inventados.
 */
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');

const {
    turmasDoProfessor,
    turmasDosFilhos,
    vinculoDoResponsavel,
    compartilhamTurma,
    variacoesDaTurma,
} = require('../services/vinculoTurmas');

let escola;

beforeAll(conectarBanco);
afterAll(desconectarBanco);

beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({
        nome: 'EE Vinculo Fino',
        tipo: 'EMEF',
        bairro: 'Centro',
        codigoSecreto: 'VINC-68-A',
        ativo: true,
    });
});

/** Aluno com o e-mail do responsável em um dos três formatos históricos. */
function alunoCom(email, { turma = '1A', campo = 'responsavel', escolaId } = {}) {
    const vinculo = {
        responsavel: { responsavel: email },
        responsavelDados: { responsavelDados: { nome: 'Fulana Ficticia', email } },
        responsaveis: { responsaveis: [{ nome: 'Fulana Ficticia', email }] },
    }[campo];

    return Aluno.create({
        nome: 'CRIANCA INVENTADA DA SILVA',
        turma,
        ativo: true,
        ...(escolaId === null ? {} : { escolaId: escolaId || String(escola._id) }),
        ...vinculo,
    });
}

describe('normalização de turma — "1C" e "1ºC" são a mesma sala', () => {
    it('expande as duas grafias', () => {
        expect([...variacoesDaTurma('1ºC')].sort()).toEqual(['1C', '1ºC']);
        expect([...variacoesDaTurma('1C')].sort()).toEqual(['1C', '1ºC']);
    });

    it('não inventa variação para entrada vazia ou de um caractere', () => {
        expect([...variacoesDaTurma('')]).toEqual([]);
        expect([...variacoesDaTurma(null)]).toEqual([]);
        expect([...variacoesDaTurma('5')]).toEqual(['5']);
    });
});

describe('turmasDosFilhos — o e-mail casa por igualdade, não por prefixo', () => {
    it('não confunde ana@ com joana@', async () => {
        await alunoCom('joana@escola.test', { turma: '2A' });

        expect([...(await turmasDosFilhos('ana@escola.test', String(escola._id)))]).toEqual([]);
        expect(await turmasDosFilhos('joana@escola.test', String(escola._id))).toContain('2A');
    });

    it('respeita a fronteira da escola', async () => {
        const outra = await Escola.create({
            nome: 'EE Outra',
            tipo: 'EMEF',
            bairro: 'Sul',
            codigoSecreto: 'VINC-68-B',
            ativo: true,
        });
        await alunoCom('pai@escola.test', { turma: '2A', escolaId: String(outra._id) });

        expect([...(await turmasDosFilhos('pai@escola.test', String(escola._id)))]).toEqual([]);
    });

    it('devolve vazio para e-mail ausente, sem consultar o banco', async () => {
        expect([...(await turmasDosFilhos('', String(escola._id)))]).toEqual([]);
        expect([...(await turmasDosFilhos(null))]).toEqual([]);
    });
});

/**
 * `vinculoDoResponsavel` devolve DUAS informações — quantos filhos e em que
 * escolas — porque "nenhuma escola" é ambíguo e a ambiguidade decide o veredito
 * do chat: sem filho nenhum nega, filho de cadastro legado (sem `escolaId`)
 * segue pelo recorte da sessão. Os dois casos aparecem abaixo separados.
 */
describe('vinculoDoResponsavel — a que escolas a família está ligada', () => {
    it('devolve a escola do filho', async () => {
        await alunoCom('mae@escola.test');

        const vinculo = await vinculoDoResponsavel('mae@escola.test');

        expect(vinculo.filhos).toBe(1);
        expect([...vinculo.escolas]).toEqual([String(escola._id)]);
    });

    it('junta as escolas quando os filhos estudam em unidades diferentes', async () => {
        const outra = await Escola.create({
            nome: 'EE Irma',
            tipo: 'CIEP',
            bairro: 'Norte',
            codigoSecreto: 'VINC-68-C',
            ativo: true,
        });
        await alunoCom('mae.dois@escola.test', { turma: '1A' });
        await alunoCom('mae.dois@escola.test', { turma: '5B', escolaId: String(outra._id) });

        const vinculo = await vinculoDoResponsavel('mae.dois@escola.test');

        expect(vinculo.filhos).toBe(2);
        expect([...vinculo.escolas].sort()).toEqual([String(escola._id), String(outra._id)].sort());
    });

    it('reconhece o vínculo nos três formatos de cadastro do responsável', async () => {
        for (const campo of ['responsavel', 'responsavelDados', 'responsaveis']) {
            const email = `mae.${campo.toLowerCase()}@escola.test`;
            await alunoCom(email, { campo });

            const vinculo = await vinculoDoResponsavel(email);
            // O campo entra no expect para que a falha diga QUAL formato quebrou.
            expect([campo, vinculo.filhos]).toEqual([campo, 1]);
        }
    });

    it('acha a família mesmo com maiúsculas no cadastro do aluno', async () => {
        // `Usuario.email` não é normalizado no schema e o e-mail do aluno é
        // digitado à mão. Comparar literal faria a família sumir.
        await alunoCom('Mae.Caixa@Escola.Test');

        expect((await vinculoDoResponsavel('mae.caixa@escola.test')).filhos).toBe(1);
    });

    it('não confunde ana@ com joana@', async () => {
        await alunoCom('joana@escola.test');

        expect((await vinculoDoResponsavel('ana@escola.test')).filhos).toBe(0);
    });

    it('SEM filho nenhum: zero filhos e nenhuma escola', async () => {
        const vinculo = await vinculoDoResponsavel('ninguem@escola.test');

        expect(vinculo.filhos).toBe(0);
        expect(vinculo.escolas.size).toBe(0);
    });

    it('filho de cadastro LEGADO conta como vínculo, mas sem escola', async () => {
        // É o caso que separa as duas informações: existe família, e não existe
        // escola para recortar. Colapsar os dois no mesmo conjunto vazio
        // bloquearia a rede inteira enquanto a migração não roda.
        await alunoCom('mae.legado@escola.test', { escolaId: null });

        const vinculo = await vinculoDoResponsavel('mae.legado@escola.test');

        expect(vinculo.filhos).toBe(1);
        expect(vinculo.escolas.size).toBe(0);
    });

    it('devolve vazio para e-mail ausente, sem consultar o banco', async () => {
        expect(await vinculoDoResponsavel('')).toEqual({ filhos: 0, escolas: new Set() });
        expect(await vinculoDoResponsavel(null)).toEqual({ filhos: 0, escolas: new Set() });
    });
});

describe('compartilhamTurma', () => {
    it('é falso quando um dos lados não tem turma alguma', () => {
        expect(compartilhamTurma(new Set(['1A']), new Set())).toBe(false);
        expect(compartilhamTurma(new Set(), new Set(['1A']))).toBe(false);
        expect(compartilhamTurma(null, new Set(['1A']))).toBe(false);
    });

    it('é verdadeiro na primeira turma em comum', () => {
        expect(compartilhamTurma(new Set(['1A', '9A']), new Set(['9A']))).toBe(true);
    });
});

describe('turmasDoProfessor', () => {
    it('devolve vazio quando não existe cadastro de professor', async () => {
        expect([...(await turmasDoProfessor('id-que-nao-existe'))]).toEqual([]);
    });

    it('junta salaPrincipal, salasAdicionais e turmas', async () => {
        await Professor.create({
            idUsuario: 'prof-juncao',
            nome: 'Prof Juncao',
            email: 'prof.juncao@escola.test',
            salaPrincipal: '1A',
            salasAdicionais: ['2B'],
            turmas: ['3C'],
            vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
            ativo: true,
        });

        const turmas = await turmasDoProfessor('prof-juncao');
        for (const esperada of ['1A', '2B', '3C']) expect(turmas).toContain(esperada);
    });
});
