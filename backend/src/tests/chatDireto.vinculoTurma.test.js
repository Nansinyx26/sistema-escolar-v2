/**
 * chatDireto.vinculoTurma.test.js — o professor só fala com o responsável do
 * aluno dele (Issue #68).
 *
 * O QUE ESTAVA ERRADO
 * -------------------
 * `MATRIZ_CONVERSA` autoriza o PAR DE PERFIS: professor pode falar com
 * responsável. Somado ao `escolaId`, isso parecia suficiente — e não era. Numa
 * escola de 20 turmas, todo professor é "professor" e todo responsável é
 * "responsavel", então a matriz liberava o professor do 1º ano para conversar
 * com a mãe de um aluno do 9º que ele nunca viu. Perfil compatível não é
 * vínculo.
 *
 * Os testes cobrem os DOIS sentidos da conversa, porque a autorização roda em
 * quem envia: barrar só o professor deixaria o responsável abrir o mesmo canal
 * pelo outro lado.
 *
 * Todos os nomes, e-mails e RAs aqui são inventados.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const ChatDireto = require('../models/ChatDireto');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const {
    turmasDoProfessor,
    turmasDosFilhos,
    compartilhamTurma,
    variacoesDaTurma,
} = require('../services/vinculoTurmas');

let escola;
let dispensa2FAOriginal;

beforeAll(async () => {
    await conectarBanco();

    // Diretor e secretaria exigem segundo fator por padrão (utils/politica2FA.js):
    // o login responde 200 mas NÃO emite o cookie, e a requisição seguinte cai
    // em 401. Este arquivo testa autorização de conversa, não o segundo fator —
    // encenar o fluxo de código aqui só acrescentaria ruído. A política é lida
    // do ambiente a cada chamada, então dispensar os dois perfis basta.
    dispensa2FAOriginal = process.env.DISPENSAR_2FA_EMAIL;
    process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
});
afterAll(async () => {
    // Restaurado para não vazar a dispensa para outras suítes do mesmo worker.
    if (dispensa2FAOriginal === undefined) delete process.env.DISPENSAR_2FA_EMAIL;
    else process.env.DISPENSAR_2FA_EMAIL = dispensa2FAOriginal;
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({
        nome: 'EE Vinculo Fino',
        tipo: 'EMEF',
        bairro: 'Centro',
        codigoSecreto: 'VINC-68-A',
        ativo: true,
    });
    // O estado global de escolas fica memoizado por 60s. Aqui a escola é
    // recriada a cada teste, então sem invalidar o cache ele segue apontando
    // para a anterior — já apagada — e quem depende do ramo "escola ativa
    // única" (responsável) leva 403 por um motivo que nada tem a ver com turma.
    invalidarCacheEscolas();
});

/**
 * Cria a conta e abre uma sessão.
 *
 * O `escolaId` NÃO vai no corpo do login, de propósito. Mandá-lo faz o
 * UserController exigir vínculo de equipe, e `vinculosDoUsuario` só conhece
 * professor, diretor e secretaria — responsável nunca teria vínculo e o login
 * responderia 403 antes de o teste chegar no chat. Sem o campo, cada requisição
 * resolve a escola no `filtrarPorEscola`: vínculo único para quem tem, escola
 * ativa única para o resto. Por isso a suíte mantém UMA escola ativa por vez.
 */
async function logar(email, perfil) {
    const user = await criarUsuario({ email, perfil, escolaId: String(escola._id) });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return { agent, user, id: String(user._id) };
}

/**
 * Professor com uma sala principal e, opcionalmente, salas extras.
 *
 * O documento em `professores` nasce ANTES da sessão: é ele que carrega o
 * vínculo de escola, consultado a cada requisição pelo `filtrarPorEscola`.
 */
async function professorDe(email, salaPrincipal, salasAdicionais = []) {
    const user = await criarUsuario({
        email,
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal,
        salasAdicionais,
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return { agent, user, id: String(user._id) };
}

/**
 * Responsável com um filho matriculado em `turma`.
 *
 * `campoVinculo` escolhe em QUAL dos três formatos históricos o e-mail é
 * gravado. Os três convivem no banco conforme a época do cadastro, e todos
 * precisam funcionar — consultar só um deixaria famílias inteiras de fora.
 */
async function responsavelDe(email, turma, campoVinculo = 'responsavel') {
    const sessao = await logar(email, 'responsavel');

    const vinculo = {
        responsavel: { responsavel: email },
        responsavelDados: { responsavelDados: { nome: 'Fulana Ficticia', email } },
        responsaveis: { responsaveis: [{ nome: 'Fulana Ficticia', email }] },
    }[campoVinculo];

    await Aluno.create({
        escolaId: String(escola._id),
        nome: 'CRIANCA INVENTADA DA SILVA',
        turma,
        ativo: true,
        ...vinculo,
    });
    return sessao;
}

const enviar = (sessao, paraId) =>
    sessao.agent
        .post('/api/chat-direto/enviar')
        .send({ destinatarioId: paraId, mensagem: 'Bom dia, tudo bem?' });

describe('professor ↔ responsável exige turma em comum', () => {
    it('BARRA o professor de outra turma — e não grava nada', async () => {
        const professor = await professorDe('prof.primeiro@escola.test', '1A');
        const mae = await responsavelDe('mae.nono@escola.test', '9A');

        const res = await enviar(professor, mae.id);

        expect(res.status).toBe(403);
        // O texto do erro não pode confirmar nem negar o vínculo: quem sonda a
        // lista de alunos aprenderia pela própria mensagem de recusa.
        expect(res.body.error).not.toMatch(/9A|1A|CRIANCA/i);
        expect(await ChatDireto.countDocuments()).toBe(0);
    });

    it('LIBERA o professor da turma do aluno', async () => {
        const professor = await professorDe('prof.nono@escola.test', '9A');
        const mae = await responsavelDe('mae.nono2@escola.test', '9A');

        const res = await enviar(professor, mae.id);

        expect(res.status).toBe(200);
        expect(await ChatDireto.countDocuments()).toBe(1);
    });

    it('BARRA também no sentido responsável → professor', async () => {
        const professor = await professorDe('prof.primeiro2@escola.test', '1A');
        const mae = await responsavelDe('mae.nono3@escola.test', '9A');

        const res = await enviar(mae, professor.id);

        expect(res.status).toBe(403);
        expect(await ChatDireto.countDocuments()).toBe(0);
    });

    it('vale por SALA ADICIONAL, não só pela principal', async () => {
        const professor = await professorDe('prof.multi@escola.test', '1A', ['9A', '5B']);
        const mae = await responsavelDe('mae.nono4@escola.test', '9A');

        expect((await enviar(professor, mae.id)).status).toBe(200);
    });

    it('reconhece o vínculo nos três formatos de cadastro do responsável', async () => {
        const professor = await professorDe('prof.formatos@escola.test', '3C');

        for (const campo of ['responsavel', 'responsavelDados', 'responsaveis']) {
            // Em minúsculas: o login normaliza o e-mail antes de procurar a
            // conta, então `mae.responsavelDados@` nunca casaria com o cadastro.
            const mae = await responsavelDe(`mae.${campo.toLowerCase()}@escola.test`, '3C', campo);
            const res = await enviar(professor, mae.id);
            // O campo entra no expect para que a falha diga QUAL formato quebrou.
            expect([campo, res.status]).toEqual([campo, 200]);
        }
    });

    it('professor SEM cadastro de Professor é barrado — falha fechada', async () => {
        // Usuário com perfil professor mas sem documento em `professores`: sem
        // turmas conhecidas o correto é negar, nunca liberar por omissão.
        const semCadastro = await logar('prof.fantasma@escola.test', 'professor');
        const mae = await responsavelDe('mae.fantasma@escola.test', '1A');

        expect((await enviar(semCadastro, mae.id)).status).toBe(403);
    });

    it('revalida a CADA mensagem, não só na primeira', async () => {
        const professor = await professorDe('prof.troca@escola.test', '4A');
        const mae = await responsavelDe('mae.troca@escola.test', '4A');

        expect((await enviar(professor, mae.id)).status).toBe(200);

        // O aluno muda de turma no meio do ano. A conversa já existe, mas a
        // próxima mensagem tem de ser barrada — autorizar só na abertura
        // deixaria o canal aberto para sempre.
        await Aluno.updateMany({ turma: '4A' }, { $set: { turma: '6B' } });

        expect((await enviar(professor, mae.id)).status).toBe(403);
        expect(await ChatDireto.countDocuments()).toBe(1);
    });
});

describe('diretor e secretaria não são limitados por turma', () => {
    /**
     * O documento de cargo é o que dá ao gestor um vínculo de escola.
     *
     * Sem ele o `filtrarPorEscola` cai no ramo "escola ativa única", cujo
     * `estadoEscolas()` é memoizado — entre testes a escola é recriada e o
     * cache continua apontando para a anterior, já apagada, então a conferência
     * de `escolaId` reprova com 403. Um diretor de verdade tem o documento;
     * criá-lo é mais fiel ao sistema do que mexer no cache.
     */
    const MODELO_DO_CARGO = { diretor: Diretor, secretaria: Secretaria };

    it.each(['diretor', 'secretaria'])('%s fala com qualquer responsável', async (perfil) => {
        const gestor = await logar(`${perfil}.68@escola.test`, perfil);
        await MODELO_DO_CARGO[perfil].create({
            idUsuario: gestor.id,
            nome: gestor.user.nome,
            email: gestor.user.email,
            vinculos: [{ escolaId: String(escola._id), cargo: perfil }],
            ativo: true,
        });
        const mae = await responsavelDe(`mae.${perfil}@escola.test`, '9A');

        expect((await enviar(gestor, mae.id)).status).toBe(200);
    });
});

describe('a regra vale igual nos dois tipos de escola', () => {
    /**
     * CIEP atende do 1º ao 5º ano; EMEF vai até o 9º. Os outros testes deste
     * arquivo usam uma EMEF, então sem este caso a suíte inteira só provaria a
     * rede maior.
     *
     * O vínculo é conferido comparando o TEXTO da turma, nunca o número da
     * série, e é por isso que o tipo da escola não entra na conta. Este teste
     * existe para que continue assim: ele quebra no dia em que alguém trocar a
     * comparação por uma faixa de série fixa — que é o atalho tentador e que
     * ficaria errado para uma das duas redes.
     */
    it('CIEP (1º ao 5º): barra entre turmas diferentes, libera na mesma', async () => {
        await Escola.deleteMany({});
        escola = await Escola.create({
            nome: 'CIEP Vinculo Fino',
            tipo: 'CIEP',
            bairro: 'Norte',
            codigoSecreto: 'VINC-68-C',
            ativo: true,
        });
        invalidarCacheEscolas();

        const maeQuinto = await responsavelDe('mae.ciep@escola.test', '5A');

        const profPrimeiro = await professorDe('prof.ciep1@escola.test', '1A');
        expect((await enviar(profPrimeiro, maeQuinto.id)).status).toBe(403);

        const profQuinto = await professorDe('prof.ciep5@escola.test', '5A');
        expect((await enviar(profQuinto, maeQuinto.id)).status).toBe(200);
    });
});

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

    it('cruza professor com "9ºA" e aluno com "9A"', async () => {
        const professor = await professorDe('prof.grafia@escola.test', '9ºA');
        const mae = await responsavelDe('mae.grafia@escola.test', '9A');

        expect((await enviar(professor, mae.id)).status).toBe(200);
    });
});

describe('turmasDosFilhos — o e-mail casa por igualdade, não por prefixo', () => {
    it('não confunde ana@ com joana@', async () => {
        await Aluno.create({
            escolaId: String(escola._id),
            nome: 'ALUNO FICTICIO UM',
            turma: '2A',
            responsavel: 'joana@escola.test',
            ativo: true,
        });

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
        await Aluno.create({
            escolaId: String(outra._id),
            nome: 'ALUNO FICTICIO DOIS',
            turma: '2A',
            responsavel: 'pai@escola.test',
            ativo: true,
        });

        expect([...(await turmasDosFilhos('pai@escola.test', String(escola._id)))]).toEqual([]);
    });

    it('devolve vazio para e-mail ausente, sem consultar o banco', async () => {
        expect([...(await turmasDosFilhos('', String(escola._id)))]).toEqual([]);
        expect([...(await turmasDosFilhos(null))]).toEqual([]);
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
        const sessao = await logar('prof.juncao@escola.test', 'professor');
        await Professor.create({
            idUsuario: sessao.id,
            nome: 'Prof Juncao',
            email: 'prof.juncao@escola.test',
            salaPrincipal: '1A',
            salasAdicionais: ['2B'],
            turmas: ['3C'],
            vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
            ativo: true,
        });

        const turmas = await turmasDoProfessor(sessao.id);
        for (const esperada of ['1A', '2B', '3C']) expect(turmas).toContain(esperada);
    });
});
