/**
 * registrationService.codigoEscola.test.js
 *
 * REGRESSÃO: o RegistrationService cadastrava docente SEM conferir o código
 * secreto da escola. A validação existia só como comentário — um `// TODO:
 * Validar código secreto da escola` seguido do código certo, comentado.
 *
 * Ninguém pagou por isso porque o `UserController-REFATORADO` que chama este
 * service nunca foi ligado a uma rota. Mas o guia de migração diz "pronto para
 * migração": no dia em que alguém trocar o `UserController` do routes/auth.js,
 * `POST /api/auth/register-docente` passaria a aceitar QUALQUER string como
 * código e a criar conta de professor com acesso à turma.
 *
 * Estes testes existem para que o dia da migração não seja o dia da descoberta.
 */
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const RegistrationService = require('../services/RegistrationService');
const Usuario = require('../models/Usuario');
const Escola = require('../models/Escola');

const SENHA_OK = 'Docente' + '#Jest' + '2026'; // maiúscula + número + especial
const CODIGO_A = 'CodigoEscolaA';
const CODIGO_B = 'CodigoEscolaB';

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

async function criarEscola(nome, codigoSecreto) {
    return Escola.create({ nome, tipo: 'EMEF', codigoSecreto, ativo: true });
}

function dadosDocente(overrides = {}) {
    return {
        nome: 'Professor Fixture',
        email: 'prof.fixture@escola.test',
        senha: SENHA_OK,
        disciplina: 'Matemática',
        turma: '1A',
        matricula: '12345',
        telefone: '19999990000',
        codigoEscola: CODIGO_A,
        ...overrides,
    };
}

describe('RegistrationService.registerDocente — código secreto', () => {
    it('recusa código inválido e NÃO cria a conta', async () => {
        await criarEscola('Escola A', CODIGO_A);

        const res = await RegistrationService.registerDocente(
            dadosDocente({ codigoEscola: 'codigo-que-nunca-existiu' })
        );

        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_CODE');
        // O ponto do teste não é a mensagem: é não haver usuário criado.
        expect(await Usuario.countDocuments({})).toBe(0);
    });

    it('aceita o código da escola e vincula a conta a ELA', async () => {
        const escola = await criarEscola('Escola A', CODIGO_A);

        const res = await RegistrationService.registerDocente(dadosDocente());

        expect(res.success).toBe(true);
        const user = await Usuario.findOne({ email: 'prof.fixture@escola.test' });
        expect(user).toBeTruthy();
        // Antes o usuário nascia sem escolaId, e o registro em `professores`
        // herdava esse vazio — ficando visível a toda a rede no filtro tolerante.
        expect(String(user.escolaId)).toBe(String(escola._id));
        expect(user.escola).toBe('Escola A');
    });

    /**
     * Isolamento entre escolas: quando o modal da landing pré-seleciona a
     * escola, o código digitado tem que ser DAQUELA escola. Sem `escolaId`, o
     * código da Escola B abriria conta na Escola B mesmo com a A na tela.
     */
    it('recusa código de outra escola quando a escola vem pré-selecionada', async () => {
        const escolaA = await criarEscola('Escola A', CODIGO_A);
        await criarEscola('Escola B', CODIGO_B);

        const res = await RegistrationService.registerDocente(
            dadosDocente({ codigoEscola: CODIGO_B, escolaId: String(escolaA._id) })
        );

        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_CODE');
        expect(await Usuario.countDocuments({})).toBe(0);
    });

    it('recusa escola inativa', async () => {
        await Escola.create({
            nome: 'Escola Fechada',
            tipo: 'EMEF',
            codigoSecreto: CODIGO_A,
            ativo: false,
        });

        const res = await RegistrationService.registerDocente(dadosDocente());

        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_CODE');
        expect(await Usuario.countDocuments({})).toBe(0);
    });
});

describe('RegistrationService.registerWithCode — código secreto', () => {
    const base = {
        nome: 'Novo Docente',
        email: 'novo.docente@escola.test',
        senha: SENHA_OK,
        telefone: '19999991111',
    };

    it('recusa quando o código não é enviado', async () => {
        await criarEscola('Escola A', CODIGO_A);

        // Este fluxo cria conta de PROFESSOR direto, sem aprovação da direção.
        // Antes, a ausência do código simplesmente não era checada.
        const res = await RegistrationService.registerWithCode({ ...base });

        expect(res.success).toBe(false);
        expect(res.code).toBe('MISSING_FIELDS');
        expect(await Usuario.countDocuments({})).toBe(0);
    });

    it('recusa código inválido e NÃO cria a conta', async () => {
        await criarEscola('Escola A', CODIGO_A);

        const res = await RegistrationService.registerWithCode({
            ...base,
            codigoSecreto: 'nao-e-o-codigo',
        });

        expect(res.success).toBe(false);
        expect(res.code).toBe('INVALID_CODE');
        expect(await Usuario.countDocuments({})).toBe(0);
    });

    it('aceita o código válido e vincula a conta à escola', async () => {
        const escola = await criarEscola('Escola A', CODIGO_A);

        const res = await RegistrationService.registerWithCode({
            ...base,
            codigoSecreto: CODIGO_A,
        });

        expect(res.success).toBe(true);
        const user = await Usuario.findOne({ email: 'novo.docente@escola.test' });
        expect(user.perfil).toBe('professor');
        expect(String(user.escolaId)).toBe(String(escola._id));
    });
});

/**
 * A regra saiu do SecurityController para services/codigoEscolaService.js —
 * `services/` não pode importar `controllers/` (regra `service-nao-sobe`).
 * O controller virou fachada; estes testes garantem que a fachada não mudou o
 * contrato para quem já a usava (UserController, routes/escolas.js).
 */
describe('SecurityController — fachada sobre codigoEscolaService', () => {
    const SecurityController = require('../controllers/SecurityController');

    it('validateCode resolve a escola pelo código', async () => {
        const escola = await criarEscola('Escola A', CODIGO_A);

        const res = await SecurityController.validateCode(CODIGO_A);

        expect(res).toBeTruthy();
        expect(String(res.escola._id)).toBe(String(escola._id));
    });

    it('validateCode devolve false para código inválido', async () => {
        await criarEscola('Escola A', CODIGO_A);

        expect(await SecurityController.validateCode('errado')).toBe(false);
    });

    it('generateCode continua gerando código sem caractere que a sanitização altere', () => {
        const codigo = SecurityController.generateCode();
        expect(codigo).toHaveLength(10);
        expect(codigo).toMatch(/^[A-HJ-NP-Za-hj-km-np-z2-9]+$/);
    });
});
