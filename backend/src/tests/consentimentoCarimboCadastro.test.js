/**
 * consentimentoCarimboCadastro.test.js — Issue #236.
 *
 * Criar a conta não é consentir. Até a #236, sete caminhos de cadastro
 * gravavam `consentimentoAceiteEm: now` no próprio `Usuario.create`, e
 * `consentimentoVigente()` tratava esse carimbo como consentimento válido.
 *
 * Duas frentes aqui:
 *
 *   1. o cadastro de verdade não grava mais o campo;
 *   2. a migração tira o carimbo das contas antigas — e SÓ dele.
 *
 * A segunda é a que mais importa acertar. Uma migração que apague demais tira
 * de alguém um consentimento que ele deu; uma que apague de menos deixa o
 * sistema afirmando um que ninguém deu. Por isso cada condição do filtro tem
 * um caso que a exercita sozinha.
 *
 * ⚠️ Fixtures 100% SINTÉTICAS (§7.8).
 */
const mongoose = require('mongoose');

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const RegistrationService = require('../services/RegistrationService');
const Usuario = require('../models/Usuario');
const Escola = require('../models/Escola');
const { consentimentoVigente } = require('../utils/consentimentoLgpd');
const migracao = require('../../migrations/1788652800000-invalidar-consentimento-carimbado-no-cadastro');

const SENHA_OK = 'Docente' + '#Jest' + '2026'; // maiúscula + número + especial

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

const usuarios = () => mongoose.connection.db.collection('usuarios');

/**
 * Insere direto na coleção, sem passar pelo Mongoose, para controlar o
 * `createdAt` ao milissegundo — o `timestamps: true` do model sobrescreveria.
 */
async function inserirConta(email, campos) {
    const doc = { nome: 'Titular Fixture', email, perfil: 'professor', ativo: true, ...campos };
    const { insertedId } = await usuarios().insertOne(doc);
    return insertedId;
}

const CRIADA_EM = new Date('2026-03-10T12:00:00.000Z');
const MESMO_INSTANTE = new Date(CRIADA_EM.getTime() + 3); // o `now` do mesmo Usuario.create
const DIAS_DEPOIS = new Date('2026-03-12T09:30:00.000Z');

const aceitePeloPortal = (aceitoEm) => ({
    termoId: 'politica_privacidade',
    versao: '2.0',
    aceitoEm,
    ip: '127.0.0.1',
    browser: 'jest',
    os: 'Outro',
    loginType: 'Conta Local',
});

describe('cadastro não grava consentimento (Issue #236)', () => {
    it('registerDocente cria a conta sem consentimentoAceiteEm', async () => {
        await Escola.create({
            nome: 'Escola A',
            tipo: 'EMEF',
            codigoSecreto: 'CodigoA',
            ativo: true,
        });

        const res = await RegistrationService.registerDocente({
            nome: 'Professor Fixture',
            email: 'prof.fixture@escola.test',
            senha: SENHA_OK,
            disciplina: 'Matemática',
            turma: '1A',
            matricula: '12345',
            telefone: '19999990000',
            codigoEscola: 'CodigoA',
        });

        expect(res.success).toBe(true);
        const bruto = await usuarios().findOne({ email: 'prof.fixture@escola.test' });
        expect(bruto).toBeTruthy();
        expect(bruto).not.toHaveProperty('consentimentoAceiteEm');

        // E o efeito que importa: o sistema não afirma um consentimento.
        expect(consentimentoVigente(bruto).aceito).toBe(false);
    });
});

describe('migração 1788652800000 — só o carimbo de cadastro sai', () => {
    it('tira o carimbo colado ao createdAt e guarda o valor original', async () => {
        const id = await inserirConta('carimbo@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: MESMO_INSTANTE,
        });

        const resultado = await migracao.up();

        expect(resultado.invalidados).toBe(1);
        const doc = await usuarios().findOne({ _id: id });
        expect(doc).not.toHaveProperty('consentimentoAceiteEm');
        expect(doc.consentimentoInvalidado.consentimentoAceiteEm).toEqual(MESMO_INSTANTE);
        expect(doc.consentimentoInvalidado.motivo).toMatch(/#236/);
        expect(doc.consentimentoInvalidado.invalidadoEm).toBeInstanceOf(Date);
        expect(consentimentoVigente(doc).aceito).toBe(false);
    });

    it('NÃO toca quem consentiu pelo portal — mesmo aceitando no mesmo instante', async () => {
        // O caso perigoso: cadastro e onboarding em sequência rápida deixam o
        // campo colado ao createdAt. Quem protege esta pessoa é o histórico.
        const id = await inserirConta('portal@escola.test', {
            perfil: 'responsavel',
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: MESMO_INSTANTE,
            lgpdHistory: [aceitePeloPortal(MESMO_INSTANTE)],
        });

        await migracao.up();

        const doc = await usuarios().findOne({ _id: id });
        expect(doc.consentimentoAceiteEm).toEqual(MESMO_INSTANTE);
        expect(doc).not.toHaveProperty('consentimentoInvalidado');
        expect(consentimentoVigente(doc).aceito).toBe(true);
    });

    it('tira o carimbo mesmo com OUTRO termo no histórico', async () => {
        // Ter assinado o Termo de Áudio e Imagem não é ter consentido com a
        // política de privacidade. O filtro olha o termoId, não se o histórico
        // existe.
        const id = await inserirConta('outro-termo@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: MESMO_INSTANTE,
            lgpdHistory: [{ ...aceitePeloPortal(DIAS_DEPOIS), termoId: 'termo_audio_imagem' }],
        });

        await migracao.up();

        const doc = await usuarios().findOne({ _id: id });
        expect(doc).not.toHaveProperty('consentimentoAceiteEm');
        expect(doc.consentimentoInvalidado).toBeTruthy();
    });

    it('NÃO toca um aceite posterior ao cadastro (onboarding antigo, só o campo)', async () => {
        const id = await inserirConta('onboarding-antigo@escola.test', {
            perfil: 'responsavel',
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: DIAS_DEPOIS,
        });

        await migracao.up();

        const doc = await usuarios().findOne({ _id: id });
        expect(doc.consentimentoAceiteEm).toEqual(DIAS_DEPOIS);
        expect(doc).not.toHaveProperty('consentimentoInvalidado');
    });

    it('respeita a tolerância: dentro dela sai, fora dela fica', async () => {
        const noLimite = await inserirConta('no-limite@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: new Date(CRIADA_EM.getTime() + migracao.TOLERANCIA_MS),
        });
        const logoDepois = await inserirConta('logo-depois@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: new Date(CRIADA_EM.getTime() + migracao.TOLERANCIA_MS + 1),
        });

        await migracao.up();

        expect(await usuarios().findOne({ _id: noLimite })).not.toHaveProperty(
            'consentimentoAceiteEm'
        );
        expect(
            (await usuarios().findOne({ _id: logoDepois })).consentimentoAceiteEm
        ).toBeInstanceOf(Date);
    });

    it('NÃO toca conta sem createdAt — sem ele não há como provar que é carimbo', async () => {
        const id = await inserirConta('sem-createdat@escola.test', {
            consentimentoAceiteEm: MESMO_INSTANTE,
        });

        await migracao.up();

        const doc = await usuarios().findOne({ _id: id });
        expect(doc.consentimentoAceiteEm).toEqual(MESMO_INSTANTE);
    });

    it('é idempotente: a segunda execução não encontra nada', async () => {
        await inserirConta('carimbo@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: MESMO_INSTANTE,
        });

        expect((await migracao.up()).invalidados).toBe(1);
        expect((await migracao.up()).invalidados).toBe(0);
    });

    it('down devolve o carimbo e só mexe no que o up marcou', async () => {
        const carimbo = await inserirConta('carimbo@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: MESMO_INSTANTE,
            consentimentoVersao: '1.0',
        });
        const portal = await inserirConta('portal@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: MESMO_INSTANTE,
            lgpdHistory: [aceitePeloPortal(MESMO_INSTANTE)],
        });
        const antesPortal = await usuarios().findOne({ _id: portal });

        await migracao.up();
        const resultado = await migracao.down();

        expect(resultado.revertidos).toBe(1);
        const doc = await usuarios().findOne({ _id: carimbo });
        expect(doc.consentimentoAceiteEm).toEqual(MESMO_INSTANTE);
        expect(doc.consentimentoVersao).toBe('1.0');
        expect(doc).not.toHaveProperty('consentimentoInvalidado');
        expect(await usuarios().findOne({ _id: portal })).toEqual(antesPortal);
    });

    it('o campo de auditoria não vaza pelo model', async () => {
        // Registro de correção, não dado de tela. Deixá-lo fora do schema NÃO
        // bastaria: o `strict` do Mongoose só barra o que é gravado, e o que
        // vem do banco sai inteiro no `toJSON`. Quem o esconde é o
        // `select: false` — e este teste já pegou a versão que confiava no
        // `strict`.
        await inserirConta('carimbo@escola.test', {
            createdAt: CRIADA_EM,
            consentimentoAceiteEm: MESMO_INSTANTE,
        });
        await migracao.up();

        // Por e-mail, não por `findById`: a conta foi inserida direto na
        // coleção, e o model não a acha pelo ObjectId cru.
        const pelaApi = (await Usuario.findOne({ email: 'carimbo@escola.test' })).toJSON();
        expect(pelaApi).not.toHaveProperty('consentimentoInvalidado');

        // E continua disponível para quem o pede pelo nome — a auditoria.
        const auditoria = await Usuario.findOne({ email: 'carimbo@escola.test' }).select(
            '+consentimentoInvalidado'
        );
        expect(auditoria.consentimentoInvalidado.motivo).toMatch(/#236/);
    });
});
