/**
 * moderacaoService.reincidencia.test.js
 *
 * A contagem de §5.1 e o que ela deliberadamente NÃO conta.
 */

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const reincidencia = require('../services/moderacao/politicas/reincidencia');
const ModeracaoService = require('../services/moderacao/ModeracaoService');

const REMETENTE = 'usuario-reincidente';

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

async function criarOcorrencia(overrides = {}) {
    return ModeracaoOcorrencia.create({
        escolaId: 'escola-a',
        tipoConteudo: 'texto',
        camada: 'lexico',
        severidade: 'leve',
        remetenteId: REMETENTE,
        decisaoAutomatica: 'entregue_com_registro',
        statusAtual: 'mantida',
        criadoEm: new Date(),
        ...overrides,
    });
}

describe('reincidencia — a contagem dos últimos 30 dias', () => {
    it('conta as ocorrências do remetente na janela', async () => {
        await criarOcorrencia();
        await criarOcorrencia();

        expect(await reincidencia.contarOcorrencias(REMETENTE)).toBe(2);
        expect(await reincidencia.ehReincidente(REMETENTE)).toBe(false);

        await criarOcorrencia();
        expect(await reincidencia.ehReincidente(REMETENTE)).toBe(true);
    });

    it('ignora o que caiu fora da janela de 30 dias', async () => {
        const quarentaDiasAtras = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await criarOcorrencia({ criadoEm: quarentaDiasAtras });
        await criarOcorrencia({ criadoEm: quarentaDiasAtras });
        await criarOcorrencia({ criadoEm: quarentaDiasAtras });

        expect(await reincidencia.ehReincidente(REMETENTE)).toBe(false);
    });

    /**
     * O ponto mais importante deste arquivo. Se a decisão revertida continuasse
     * contando, o falso positivo que a escola JÁ reconheceu como erro seguiria
     * produzindo efeito contra a pessoa — e a revisão humana viraria teatro.
     */
    it('não conta ocorrência revertida pela revisão humana', async () => {
        await criarOcorrencia({ statusAtual: 'revertida' });
        await criarOcorrencia({ statusAtual: 'revertida' });
        await criarOcorrencia({ statusAtual: 'revertida' });

        expect(await reincidencia.contarOcorrencias(REMETENTE)).toBe(0);
        expect(await reincidencia.ehReincidente(REMETENTE)).toBe(false);
    });

    it('isola por escola quando a escola é informada', async () => {
        await criarOcorrencia({ escolaId: 'escola-a' });
        await criarOcorrencia({ escolaId: 'escola-b' });

        expect(await reincidencia.contarOcorrencias(REMETENTE, { escolaId: 'escola-a' })).toBe(1);
        expect(await reincidencia.contarOcorrencias(REMETENTE)).toBe(2);
    });

    it('remetente sem id não é reincidente de ninguém', async () => {
        expect(await reincidencia.contarOcorrencias(null)).toBe(0);
        expect(await reincidencia.ehReincidente(undefined)).toBe(false);
    });
});

describe('ModeracaoService.analisarTexto — Camada 1 ligada de ponta a ponta', () => {
    it('texto limpo não vira ocorrência', async () => {
        const veredito = await ModeracaoService.analisarTexto({
            texto: 'Bom dia, a reunião foi remarcada para sexta.',
            contexto: { escolaId: 'escola-a', remetenteId: REMETENTE },
        });

        expect(veredito.severidade).toBe('nenhuma');
        expect(veredito.ocorrencia).toBeNull();
        expect(await ModeracaoOcorrencia.countDocuments({})).toBe(0);
    });

    it('texto bloqueado pelo léxico registra ocorrência sem guardar o texto', async () => {
        // As palavras ao redor do palavrão são o que a ocorrência não pode
        // guardar: são conteúdo da conversa, e podem citar aluno, endereço ou
        // qualquer outra coisa que ninguém autorizou a arquivar.
        const veredito = await ModeracaoService.analisarTexto({
            texto: 'a diretora Marta é uma merda e mora na rua Tal',
            contexto: {
                escolaId: 'escola-a',
                remetenteId: REMETENTE,
                remetentePerfil: 'responsavel',
                destinatarioId: 'prof-1',
            },
        });

        expect(veredito.severidade).not.toBe('nenhuma');
        expect(veredito.ocorrencia).toBeTruthy();

        const gravada = await ModeracaoOcorrencia.findOne({ remetenteId: REMETENTE }).lean();
        expect(gravada.camada).toBe('lexico');
        expect(gravada.escolaId).toBe('escola-a');
        expect(gravada.destinatarioId).toBe('prof-1');

        // §6.1: o CONTEÚDO nunca é gravado. `termosDetectados` é a única
        // exceção prevista em §6.2 — aquelas palavras já estão no dicionário
        // público deste repositório, então registrá-las não revela nada novo.
        // O que não pode sobrar é o resto da frase: é ali que aparecem nomes,
        // endereços e tudo mais que ninguém autorizou a arquivar.
        const serializada = JSON.stringify(gravada);
        expect(serializada).not.toContain('Marta');
        expect(serializada).not.toContain('diretora');
        expect(serializada).not.toContain('rua Tal');
        expect(gravada.termosDetectados).toContain('merda');
        // O hash existe para detectar reenvio sem guardar o material.
        expect(gravada.conteudoHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('o mesmo texto reenviado gera o mesmo hash, com ou sem acento', async () => {
        const a = ModeracaoService.hashDoTexto('Não faça isso');
        const b = ModeracaoService.hashDoTexto('nao   FAÇA isso ');
        expect(a).toBe(b);
    });

    it('MODERACAO_ATIVA=false desliga o registro por completo', async () => {
        const anterior = process.env.MODERACAO_ATIVA;
        process.env.MODERACAO_ATIVA = 'false';

        try {
            const veredito = await ModeracaoService.analisarTexto({
                texto: 'seu merda',
                contexto: { escolaId: 'escola-a', remetenteId: REMETENTE },
            });

            expect(veredito.severidade).toBe('nenhuma');
            expect(await ModeracaoOcorrencia.countDocuments({})).toBe(0);
        } finally {
            if (anterior === undefined) delete process.env.MODERACAO_ATIVA;
            else process.env.MODERACAO_ATIVA = anterior;
        }
    });
});
