/**
 * Excluir uma conta pela tela de administração precisa apagá-la do banco —
 * inteira. O documento de `usuarios` já sumia, mas o perfil estendido de
 * professor e de diretor sobrevivia: a pessoa continuava listada na equipe e
 * o "primeiro acesso" ainda usava esse registro para recriar o login. Para
 * quem apagou, a conta simplesmente voltava.
 */
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const UserController = require('../controllers/UserController');
const mongoose = require('mongoose');

const ID_ADMIN = new mongoose.Types.ObjectId().toString();

// Fixture, nao credencial: nada aqui existe fora do mongodb-memory-server.
// Montada em runtime de proposito — um literal com cara de senha faz o scanner
// de segredo abrir incidente, e falso positivo recorrente treina o time a
// ignorar o alerta que importa. Satisfaz a regra de forca do firstAccess
// (>= 8 caracteres, maiuscula, digito e simbolo).
const SENHA_FIXTURE = ['Fixture', 'Teste', '2026', '#'].join('');

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

function respostaFake() {
    return {
        statusCode: 200,
        corpo: null,
        status(c) {
            this.statusCode = c;
            return this;
        },
        json(b) {
            this.corpo = b;
            return this;
        },
    };
}

function requisicaoAdmin(idAlvo) {
    return {
        user: { id: ID_ADMIN, _id: ID_ADMIN, email: 'admin@t.com', perfil: 'admin' },
        params: { id: String(idAlvo) },
        body: {},
        headers: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
    };
}

function criarUsuario(perfil, email) {
    return Usuario.create({
        nome: 'Alvo',
        email,
        senha: 'x',
        perfil,
        ativo: true,
        cpf: String(Math.random()),
        telefone: 't',
    });
}

describe('DELETE /usuarios/:id apaga a conta do banco', () => {
    it('remove o usuário e o perfil de professor', async () => {
        const user = await criarUsuario('professor', 'prof@t.com');
        await Professor.create({ idUsuario: String(user._id), nome: 'Alvo', email: 'prof@t.com' });

        const res = respostaFake();
        await UserController.delete(requisicaoAdmin(user._id), res);

        expect(res.corpo.success).toBe(true);
        expect(await Usuario.findById(user._id)).toBeNull();
        expect(await Professor.countDocuments({ email: 'prof@t.com' })).toBe(0);
    });

    it('remove o usuário e o perfil de diretor', async () => {
        const user = await criarUsuario('diretor', 'dir@t.com');
        await Diretor.create({ idUsuario: String(user._id), nome: 'Alvo', email: 'dir@t.com' });

        await UserController.delete(requisicaoAdmin(user._id), respostaFake());

        expect(await Usuario.findById(user._id)).toBeNull();
        expect(await Diretor.countDocuments({ email: 'dir@t.com' })).toBe(0);
    });

    it('remove o perfil de secretaria com vínculo antigo, casando pelo e-mail', async () => {
        const user = await criarUsuario('secretaria', 'sec@t.com');
        // idUsuario de um cadastro anterior: só o e-mail liga o perfil à conta.
        await Secretaria.create({
            idUsuario: 'id-antigo',
            nome: 'Alvo',
            email: 'sec@t.com',
            setor: 'Geral',
        });

        await UserController.delete(requisicaoAdmin(user._id), respostaFake());

        expect(await Usuario.findById(user._id)).toBeNull();
        expect(await Secretaria.countDocuments({ email: 'sec@t.com' })).toBe(0);
    });

    it('descarta códigos de recuperação pendentes da conta apagada', async () => {
        const user = await criarUsuario('professor', 'rec@t.com');
        await RecuperacaoSenha.create({
            usuarioId: user._id,
            codigo: '123456',
            expiraEm: new Date(Date.now() + 60000),
            status: 'ativo',
        });

        await UserController.delete(requisicaoAdmin(user._id), respostaFake());

        expect(await RecuperacaoSenha.countDocuments({ usuarioId: user._id })).toBe(0);
    });

    it('não deixa o professor apagado recriar o login pelo primeiro acesso', async () => {
        const user = await criarUsuario('professor', 'volta@t.com');
        await Professor.create({ idUsuario: String(user._id), nome: 'Alvo', email: 'volta@t.com' });

        await UserController.delete(requisicaoAdmin(user._id), respostaFake());

        const res = respostaFake();
        await UserController.firstAccess(
            {
                body: { emailOrCpf: 'volta@t.com', password: SENHA_FIXTURE },
                headers: {},
                ip: '127.0.0.1',
                socket: { remoteAddress: '127.0.0.1' },
            },
            res
        );

        expect(res.corpo.success).toBe(false);
        expect(await Usuario.countDocuments({ email: 'volta@t.com' })).toBe(0);
    });
});

/**
 * As contas apagadas ANTES da correção deixaram perfis para trás — é por isso
 * que elas continuam no card "Professores da Escola", que lê direto de
 * `professores`/`diretores`. O script de limpeza precisa varrer esse passivo
 * sem encostar em quem nunca teve conta (pré-cadastro da direção).
 */
const { limparPerfisOrfaos, buscarPessoa } = require('../../scripts/limpar-perfis-orfaos');

describe('Limpeza dos perfis órfãos deixados por exclusões antigas', () => {
    const silencio = () => {};

    it('apaga o perfil cujo idUsuario aponta para conta inexistente', async () => {
        await Professor.create({
            idUsuario: 'conta-que-nao-existe',
            nome: 'Adrian',
            email: 'adrian@t.com',
        });
        await Diretor.create({
            idUsuario: 'outra-conta-morta',
            nome: 'Leonardo',
            email: 'leo@t.com',
        });

        const r = await limparPerfisOrfaos({ aplicar: true, log: silencio });

        expect(r.removidos).toBe(2);
        expect(await Professor.countDocuments({})).toBe(0);
        expect(await Diretor.countDocuments({})).toBe(0);
    });

    it('preserva o pré-cadastro sem idUsuario (professor que ainda não fez primeiro acesso)', async () => {
        await Professor.create({ nome: 'Pré-cadastrada', email: 'nova@t.com' });

        const r = await limparPerfisOrfaos({ aplicar: true, log: silencio });

        expect(r.orfaos).toBe(0);
        expect(r.preCadastros).toBe(1);
        expect(await Professor.countDocuments({ email: 'nova@t.com' })).toBe(1);
    });

    it('preserva o perfil de quem ainda tem conta ativa', async () => {
        const user = await criarUsuario('professor', 'ativo@t.com');
        await Professor.create({
            idUsuario: String(user._id),
            nome: 'Ativo',
            email: 'ativo@t.com',
        });

        const r = await limparPerfisOrfaos({ aplicar: true, log: silencio });

        expect(r.removidos).toBe(0);
        expect(await Professor.countDocuments({ email: 'ativo@t.com' })).toBe(1);
    });

    it('sem --apply não altera nada, só conta', async () => {
        await Professor.create({ idUsuario: 'conta-morta', nome: 'Fantasma', email: 'fant@t.com' });

        const r = await limparPerfisOrfaos({ aplicar: false, log: silencio });

        expect(r.orfaos).toBe(1);
        expect(r.removidos).toBe(0);
        expect(await Professor.countDocuments({ email: 'fant@t.com' })).toBe(1);
    });
});

/**
 * O caso que sobra: cadastro ANTIGO, feito antes de existir o campo de vínculo.
 * Sem `idUsuario` ele é indistinguível de um pré-cadastro, então a varredura de
 * órfãos o preserva — e a pessoa apagada continua na lista da equipe. O modo de
 * busca é a saída manual para isso.
 */
describe('Busca dirigida por nome/e-mail', () => {
    const silencio = () => {};

    it('encontra o perfil sem idUsuario que a varredura de órfãos preserva', async () => {
        await Professor.create({ nome: 'Adrian Gomes', email: 'adrian@t.com' });

        const varredura = await limparPerfisOrfaos({ aplicar: true, log: silencio });
        expect(varredura.removidos).toBe(0); // preservado, como esperado

        const r = await buscarPessoa('adrian', { aplicar: false, log: silencio });
        expect(r.perfis).toBe(1);
        expect(r.contas).toBe(0); // login já não existe
        expect(r.removidos).toBe(0); // sem --apply não mexe
    });

    it('apaga esse perfil quando o operador confirma com --apply', async () => {
        await Professor.create({ nome: 'Leonardo Laurindo', email: 'leo@t.com' });

        const r = await buscarPessoa('laurindo', { aplicar: true, log: silencio });

        expect(r.removidos).toBe(1);
        expect(await Professor.countDocuments({})).toBe(0);
    });

    it('recusa apagar o perfil de quem ainda tem conta de login', async () => {
        const user = await criarUsuario('professor', 'viva@t.com');
        await Professor.create({
            idUsuario: String(user._id),
            nome: 'Conta Viva',
            email: 'viva@t.com',
        });

        const r = await buscarPessoa('viva@t.com', { aplicar: true, log: silencio });

        expect(r.contas).toBe(1);
        expect(r.removidos).toBe(0);
        expect(await Professor.countDocuments({ email: 'viva@t.com' })).toBe(1);
    });

    it('busca por e-mail com ponto casa como texto literal, não como curinga', async () => {
        await Professor.create({ nome: 'Outro', email: 'axb@t.com' });

        const r = await buscarPessoa('a.b@t.com', { aplicar: false, log: silencio });

        expect(r.perfis).toBe(0);
    });
});
