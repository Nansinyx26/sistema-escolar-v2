/**
 * "Criar Conta" do portal do responsável (Issue #288).
 *
 * O formulário do portal tinha só nome, e-mail e senha, e mandava o estado da
 * tela inteiro para `POST /api/auth/register-responsavel`. O backend exige
 * também telefone e o código secreto do aluno — então TODO envio voltava 400.
 * O botão existia, mas nunca criou uma conta, e nenhum teste percebeu: cada
 * lado funcionava sozinho.
 *
 * Por isso este arquivo NÃO reescreve o corpo à mão. Ele executa a função que
 * o portal usa de verdade (`portal-responsavel/src/utils/cadastroResponsavel.ts`)
 * e manda o resultado pela rota real, contra o MongoDB em memória. Se o backend
 * passar a exigir um campo que o portal não manda, ou o portal deixar de mandar
 * um, o primeiro teste reprova.
 *
 * O arquivo do portal é TypeScript sem nenhum `import`, justamente para poder
 * ser carregado daqui: o Node tira os tipos (`stripTypeScriptTypes`, nativo
 * desde o 22.13) e o `vm` executa o resto.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const request = require('supertest');

const app = require('../app');
const Aluno = require('../models/Aluno');
const Usuario = require('../models/Usuario');
const {
    CONSENTIMENTO_ID,
    CONSENTIMENTO_VERSAO,
    aceiteExplicitoVigente,
} = require('../utils/consentimentoLgpd');
const { conectarBanco, limparBanco, desconectarBanco, SENHA_TESTE } = require('./helpers');

const ARQUIVO_DO_PORTAL = path.join(
    __dirname,
    '../../../portal-responsavel/src/utils/cadastroResponsavel.ts'
);

/** Carrega o módulo do portal como ele é — só sem os tipos. */
function carregarCadastroDoPortal() {
    const fonte = fs.readFileSync(ARQUIVO_DO_PORTAL, 'utf8');
    const js = stripTypeScriptTypes(fonte).replace(/^export /gm, '');
    return vm.runInNewContext(
        `${js}\n;({ montarCorpoCadastro, mascaraTelefone, VERSAO_POLITICA_PRIVACIDADE })`,
        {},
        { filename: ARQUIVO_DO_PORTAL }
    );
}

const portal = carregarCadastroDoPortal();

const NAVEGADOR = 'Mozilla/5.0 (Linux; Android 14) Teste/1.0';
const CODIGO_ALUNO = 'K7M2Q9';

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

// Cada teste começa com um aluno sem responsável, que é o que o código secreto
// da escola destrava. Limpar antes (e não só depois) é o que a #286 ensinou.
beforeEach(async () => {
    await limparBanco();
    await Aluno.create({
        nome: 'Aluno do Cadastro',
        matricula: '2026-288',
        turmaId: '5A',
        ativo: true,
        codigoSecreto: CODIGO_ALUNO,
    });
});

/** O que uma pessoa preenche na tela "Criar Conta". */
function formularioPreenchido(extra = {}) {
    return {
        nome: '  Maria Responsável  ',
        email: 'maria.cadastro@escola.test',
        senha: SENHA_TESTE,
        telefone: portal.mascaraTelefone('11987654321'),
        // Digitado em minúsculas: o portal normaliza, como a página HTML.
        codigoSecreto: CODIGO_ALUNO.toLowerCase(),
        aceitePolitica: false,
        ...extra,
    };
}

function cadastrar(corpo) {
    return request(app)
        .post('/api/auth/register-responsavel')
        .set('User-Agent', NAVEGADOR)
        .send(corpo);
}

describe('POST /api/auth/register-responsavel com o corpo que o portal monta', () => {
    it('cria a conta e vincula o aluno', async () => {
        const res = await cadastrar(portal.montarCorpoCadastro(formularioPreenchido()));

        // Antes da #288, este era um 400: "Todos os campos de perfil são obrigatórios".
        expect(res.body.error).toBeUndefined();
        expect(res.status).toBe(201);

        const conta = await Usuario.findOne({ email: 'maria.cadastro@escola.test' }).lean();
        expect(conta.nome).toBe('Maria Responsável');
        expect(conta.telefone).toBe('(11) 98765-4321');
        expect(conta.perfil).toBe('responsavel');

        const aluno = await Aluno.findOne({ codigoSecreto: CODIGO_ALUNO }).lean();
        expect(aluno.responsavel).toBe('maria.cadastro@escola.test');
    });

    it('caixa desmarcada: a conta nasce SEM consentimento (criar conta não é consentir)', async () => {
        const corpo = portal.montarCorpoCadastro(formularioPreenchido({ aceitePolitica: false }));
        expect(corpo).not.toHaveProperty('consentimentoLgpd');

        const res = await cadastrar(corpo);
        expect(res.status).toBe(201);

        const conta = await Usuario.findOne({ email: 'maria.cadastro@escola.test' }).lean();
        expect(conta.consentimentoAceiteEm).toBeFalsy();
        expect(conta.lgpdHistory || []).toHaveLength(0);
    });

    it('caixa marcada: o aceite chega ao lgpdHistory, com IP, navegador e a data do campo', async () => {
        const res = await cadastrar(
            portal.montarCorpoCadastro(formularioPreenchido({ aceitePolitica: true }))
        );
        expect(res.status).toBe(201);

        const conta = await Usuario.findOne({ email: 'maria.cadastro@escola.test' }).lean();
        const assinaturas = conta.lgpdHistory.filter((h) => h.termoId === CONSENTIMENTO_ID);
        expect(assinaturas).toHaveLength(1);
        expect(assinaturas[0].versao).toBe(CONSENTIMENTO_VERSAO);
        expect(assinaturas[0].browser).toBe(NAVEGADOR);
        expect(assinaturas[0].ip).toBeTruthy();
        expect(assinaturas[0].metodoValidacao).toBe('SESSAO_AUTENTICADA');

        expect(conta.consentimentoVersao).toBe(CONSENTIMENTO_VERSAO);
        expect(new Date(conta.consentimentoAceiteEm).getTime()).toBe(
            new Date(assinaturas[0].aceitoEm).getTime()
        );
    });

    it.each(['nome', 'email', 'senha', 'telefone', 'codigoSecreto'])(
        'sem %s no corpo, o backend recusa — o contrato é esse mesmo',
        async (campo) => {
            // Garante que o primeiro teste não passa por acaso: cada campo que o
            // portal manda é, de fato, exigido pelo backend.
            const corpo = portal.montarCorpoCadastro(formularioPreenchido());
            delete corpo[campo];

            const res = await cadastrar(corpo);

            expect(res.status).toBe(400);
            expect(await Usuario.countDocuments({ perfil: 'responsavel' })).toBe(0);
        }
    );
});

describe('portal: versão da política', () => {
    it('o portal manda a mesma versão que o backend reconhece', () => {
        expect(portal.VERSAO_POLITICA_PRIVACIDADE).toBe(CONSENTIMENTO_VERSAO);
    });
});

describe('aceiteExplicitoVigente', () => {
    it('só o booleano true com a versão vigente conta', () => {
        expect(aceiteExplicitoVigente({ aceito: true, versao: CONSENTIMENTO_VERSAO })).toBe(true);
    });

    it.each([
        ['ausente', undefined],
        ['aceito como texto', { aceito: 'true', versao: CONSENTIMENTO_VERSAO }],
        ['recusado', { aceito: false, versao: CONSENTIMENTO_VERSAO }],
        ['versão que o servidor não conhece', { aceito: true, versao: '1.0' }],
    ])('%s não é consentimento', (_, consentimento) => {
        expect(aceiteExplicitoVigente(consentimento)).toBe(false);
    });
});

describe('mascaraTelefone', () => {
    it.each([
        ['11987654321', '(11) 98765-4321'],
        ['1133334444', '(11) 3333-4444'],
        ['(11) 9 8765-4321 ramal', '(11) 98765-4321'],
        ['119876543210000', '(11) 98765-4321'],
    ])('%s vira %s', (digitado, esperado) => {
        expect(portal.mascaraTelefone(digitado)).toBe(esperado);
    });
});
