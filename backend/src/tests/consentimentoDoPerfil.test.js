/**
 * Aceite LGPD dado pela tela de perfil (Issue #280).
 *
 * O `EditarPerfil` do portal manda `consentimentoAceiteEm: true` em TODO
 * salvamento, e o `updateProfile` gravava só o campo legado — sem entrada no
 * `lgpdHistory`, sem IP, sem navegador — e com a data de hoje, a cada correção
 * de telefone. Estes testes rodam contra o MongoDB em memória, pelo controller
 * de verdade, e travam as duas coisas: campo e assinatura saem juntos, e só
 * quando é um consentimento novo.
 */
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const Usuario = require('../models/Usuario');
const UserController = require('../controllers/UserController');
const {
    CONSENTIMENTO_ID,
    CONSENTIMENTO_VERSAO,
    decidirConsentimentoDoPerfil,
} = require('../utils/consentimentoDoPerfil');

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0) Teste/1.0';

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

function requisicao(usuario, corpo) {
    const id = String(usuario._id);
    return {
        user: { id, _id: id, email: usuario.email, perfil: usuario.perfil },
        body: corpo,
        headers: { 'user-agent': NAVEGADOR },
        ip: '203.0.113.7',
        socket: { remoteAddress: '203.0.113.7' },
    };
}

function criarResponsavel(extra = {}) {
    return Usuario.create({
        nome: 'Responsável Teste',
        email: `resp${Math.random().toString(36).slice(2)}@t.com`,
        senha: 'x',
        perfil: 'responsavel',
        ativo: true,
        telefone: '(11) 90000-0000',
        ...extra,
    });
}

async function salvarPerfil(usuario, corpo) {
    const res = respostaFake();
    await UserController.updateProfile(requisicao(usuario, corpo), res);
    expect(res.statusCode).toBe(200);
    return Usuario.findById(usuario._id).lean();
}

const doTermo = (u) => (u.lgpdHistory || []).filter((h) => h.termoId === CONSENTIMENTO_ID);

// O que o EditarPerfil manda hoje, sem mudança nenhuma no portal.
const CORPO_EDITAR_PERFIL = {
    nome: 'Responsável Teste',
    telefone: '(11) 91111-1111',
    consentimentoAceiteEm: true,
};

describe('updateProfile: consentimento dado pela tela de perfil', () => {
    it('consentimento novo grava o campo E a assinatura, com IP, navegador e a mesma data', async () => {
        const usuario = await criarResponsavel();

        const depois = await salvarPerfil(usuario, CORPO_EDITAR_PERFIL);

        const assinaturas = doTermo(depois);
        expect(assinaturas).toHaveLength(1);
        expect(assinaturas[0].versao).toBe(CONSENTIMENTO_VERSAO);
        expect(assinaturas[0].ip).toBe('203.0.113.7');
        expect(assinaturas[0].browser).toBe(NAVEGADOR);
        expect(assinaturas[0].metodoValidacao).toBe('SESSAO_AUTENTICADA');

        expect(depois.consentimentoVersao).toBe(CONSENTIMENTO_VERSAO);
        // Campo e histórico contam a mesma história.
        expect(new Date(depois.consentimentoAceiteEm).getTime()).toBe(
            new Date(assinaturas[0].aceitoEm).getTime()
        );
    });

    it('salvar de novo NÃO acrescenta assinatura nem move a data do consentimento', async () => {
        const usuario = await criarResponsavel();
        const primeira = await salvarPerfil(usuario, CORPO_EDITAR_PERFIL);
        const dataOriginal = new Date(primeira.consentimentoAceiteEm).getTime();

        // Só corrigindo o telefone — o portal manda o campo de novo mesmo assim.
        const segunda = await salvarPerfil(usuario, {
            ...CORPO_EDITAR_PERFIL,
            telefone: '(11) 92222-2222',
        });

        expect(doTermo(segunda)).toHaveLength(1);
        expect(new Date(segunda.consentimentoAceiteEm).getTime()).toBe(dataOriginal);
        expect(segunda.telefone).toBe('(11) 92222-2222');
    });

    it('carimbo legado SEM histórico não conta como prova: o aceite de agora é registrado', async () => {
        // É a conta que a Issue #236 descreve: o cadastro carimbou o campo
        // sozinho, e nenhuma assinatura existe.
        const carimbo = new Date('2025-01-01T12:00:00Z');
        const usuario = await criarResponsavel({ consentimentoAceiteEm: carimbo });

        const depois = await salvarPerfil(usuario, CORPO_EDITAR_PERFIL);

        expect(doTermo(depois)).toHaveLength(1);
        expect(new Date(depois.consentimentoAceiteEm).getTime()).not.toBe(carimbo.getTime());
    });

    it('não duplica quando o próprio pedido já traz a assinatura (CompletarCadastro)', async () => {
        const usuario = await criarResponsavel();

        const depois = await salvarPerfil(usuario, {
            ...CORPO_EDITAR_PERFIL,
            newLgpdRecords: [
                { termoId: 'politica_privacidade', versao: '2.0' },
                { termoId: 'termos_uso', versao: '2.0' },
            ],
        });

        expect(doTermo(depois)).toHaveLength(1);
        expect(depois.lgpdHistory.filter((h) => h.termoId === 'termos_uso')).toHaveLength(1);
        expect(depois.consentimentoAceiteEm).toBeTruthy();
    });

    it('assinatura de versão ANTERIOR não basta: consentir registra a versão vigente', async () => {
        const usuario = await criarResponsavel({
            lgpdHistory: [
                { termoId: CONSENTIMENTO_ID, versao: '1.0', aceitoEm: new Date('2024-01-01') },
            ],
        });

        const depois = await salvarPerfil(usuario, CORPO_EDITAR_PERFIL);

        const versoes = doTermo(depois).map((h) => h.versao);
        expect(versoes).toEqual(['1.0', CONSENTIMENTO_VERSAO]);
    });

    it('sem consentimento no corpo, nada de consentimento é gravado', async () => {
        const usuario = await criarResponsavel();

        const depois = await salvarPerfil(usuario, {
            nome: 'Outro Nome',
            telefone: '(11) 93333-3333',
        });

        expect(depois.consentimentoAceiteEm).toBeFalsy();
        expect(doTermo(depois)).toHaveLength(0);
        expect(depois.nome).toBe('Outro Nome');
    });

    it('perfil que não é responsável continua sem gravar consentimento por esta rota', async () => {
        // Comportamento preservado: antes, o campo só era tocado no bloco do
        // responsável. Esta Issue não amplia quem consente por aqui.
        const professor = await Usuario.create({
            nome: 'Prof',
            email: 'prof@t.com',
            senha: 'x',
            perfil: 'professor',
            ativo: true,
            cpf: String(Math.random()),
            telefone: 't',
        });

        const depois = await salvarPerfil(professor, { consentimentoAceiteEm: true });

        expect(depois.consentimentoAceiteEm).toBeFalsy();
        expect(doTermo(depois)).toHaveLength(0);
    });
});

describe('decidirConsentimentoDoPerfil', () => {
    it('já assinado: não grava nada', () => {
        expect(
            decidirConsentimentoDoPerfil({ jaTemAssinatura: true, loteTrazAssinatura: false })
        ).toEqual({ gravarCampo: false, acrescentarAssinatura: false });
    });

    it('novo e sem assinatura no lote: grava o campo e acrescenta a assinatura', () => {
        expect(
            decidirConsentimentoDoPerfil({ jaTemAssinatura: false, loteTrazAssinatura: false })
        ).toEqual({ gravarCampo: true, acrescentarAssinatura: true });
    });

    it('novo com assinatura no lote: grava o campo sem duplicar', () => {
        expect(
            decidirConsentimentoDoPerfil({ jaTemAssinatura: false, loteTrazAssinatura: true })
        ).toEqual({ gravarCampo: true, acrescentarAssinatura: false });
    });
});
