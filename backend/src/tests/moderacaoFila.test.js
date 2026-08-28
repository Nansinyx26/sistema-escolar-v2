/**
 * moderacaoFila.test.js — a fila de §8.5 e o prazo de §5.2.
 *
 * O comportamento mais importante testado aqui não é o caminho feliz: é o que
 * acontece quando o job FALHA cinco vezes. A regra é que o conteúdo vá para a
 * revisão humana em vez de sumir — descarte silencioso numa fila de moderação
 * significa material que ninguém analisou e ninguém sabe que não foi analisado.
 */

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const fila = require('../services/moderacao/fila/moderacaoQueue');
const ModeracaoJob = require('../models/ModeracaoJob');
const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const ModeracaoService = require('../services/moderacao/ModeracaoService');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    fila.limparHandlers();
});

describe('moderacaoQueue — consumo e retentativa', () => {
    it('processa um job pendente e o marca como concluído', async () => {
        const vistos = [];
        fila.registrarHandler('teste', async (payload) => {
            vistos.push(payload.valor);
        });

        await fila.enfileirar('teste', { valor: 42 });

        const resultado = await fila.processarUmLote();

        expect(resultado.processados).toBe(1);
        expect(vistos).toEqual([42]);

        const job = await ModeracaoJob.findOne({ tipo: 'teste' }).lean();
        expect(job.status).toBe('concluido');
        expect(job.tentativas).toBe(1);
    });

    it('não consome job de tipo sem handler registrado', async () => {
        await fila.enfileirar('tipo-sem-dono', {});

        const resultado = await fila.processarUmLote();

        expect(resultado.processados).toBe(0);
        const job = await ModeracaoJob.findOne({}).lean();
        expect(job.status).toBe('pendente');
    });

    it('respeita a concorrência de 2 por lote', async () => {
        fila.registrarHandler('teste', async () => {});
        await fila.enfileirar('teste', {});
        await fila.enfileirar('teste', {});
        await fila.enfileirar('teste', {});

        const resultado = await fila.processarUmLote();

        expect(resultado.processados).toBe(fila.CONCORRENCIA);
        expect(await ModeracaoJob.countDocuments({ status: 'pendente' })).toBe(1);
    });

    it('reagenda com backoff exponencial quando o handler falha', async () => {
        fila.registrarHandler('teste', async () => {
            throw new Error('provedor fora do ar');
        });
        await fila.enfileirar('teste', {});

        const resultado = await fila.processarUmLote();

        expect(resultado.resultados).toEqual(['reagendado']);

        const job = await ModeracaoJob.findOne({}).lean();
        expect(job.status).toBe('pendente');
        expect(job.tentativas).toBe(1);
        expect(job.ultimoErro).toBe('provedor fora do ar');
        // Já não pode ser tentado imediatamente — é isso que o backoff compra.
        expect(new Date(job.proximaTentativaEm).getTime()).toBeGreaterThan(Date.now());
    });

    it('o backoff cresce e para no teto de 60 s', () => {
        expect(fila.atrasoDaTentativa(1)).toBe(1000);
        expect(fila.atrasoDaTentativa(2)).toBe(2000);
        expect(fila.atrasoDaTentativa(3)).toBe(4000);
        expect(fila.atrasoDaTentativa(50)).toBe(60_000);
    });

    /**
     * O fail-safe. Cinco falhas ⇒ o job morre, MAS a ocorrência associada entra
     * na fila humana. Se este teste quebrar, alguma mudança transformou falha de
     * infraestrutura em conteúdo não analisado e invisível.
     */
    it('job esgotado manda a ocorrência para a revisão humana', async () => {
        const ocorrencia = await ModeracaoOcorrencia.create({
            escolaId: 'escola-a',
            tipoConteudo: 'imagem',
            camada: 'imagem_api',
            severidade: 'moderada',
            remetenteId: 'user-1',
            decisaoAutomatica: 'entregue_com_registro',
            statusAtual: 'mantida',
        });

        fila.registrarHandler('teste', async () => {
            throw new Error('sempre falha');
        });
        await fila.enfileirar('teste', { ocorrenciaId: String(ocorrencia._id) });

        // Uma passada por tentativa; a última é a que esgota.
        for (let i = 0; i < fila.MAX_TENTATIVAS; i++) {
            await ModeracaoJob.updateOne({}, { $set: { proximaTentativaEm: new Date(0) } });
            await fila.processarUmLote();
        }

        const job = await ModeracaoJob.findOne({}).lean();
        expect(job.status).toBe('falhou');
        expect(job.tentativas).toBe(fila.MAX_TENTATIVAS);

        const depois = await ModeracaoOcorrencia.findById(ocorrencia._id).lean();
        expect(depois.decisaoAutomatica).toBe('em_revisao');
        expect(depois.statusAtual).toBe('pendente');
    });

    it('o worker nasce desligado em ambiente de teste', () => {
        // Sem isto o laço gira contra o banco in-memory de cada worker do Jest e
        // vira ruído impossível de depurar.
        expect(process.env.NODE_ENV).toBe('test');
        expect(fila.workerHabilitado()).toBe(false);
        expect(fila.iniciarWorker()).toBe(false);
    });
});

describe('ModeracaoService.expirarPendencias — o prazo de §5.2', () => {
    async function pendenteDesde(horas, severidade) {
        return ModeracaoOcorrencia.create({
            escolaId: 'escola-a',
            tipoConteudo: 'texto',
            camada: 'lexico',
            severidade,
            remetenteId: 'user-1',
            decisaoAutomatica: 'em_revisao',
            statusAtual: 'pendente',
            criadoEm: new Date(Date.now() - horas * 60 * 60 * 1000),
        });
    }

    it('libera MODERADA vencida e deixa GRAVE bloqueada', async () => {
        const moderada = await pendenteDesde(30, 'moderada');
        const grave = await pendenteDesde(30, 'grave');
        const critica = await pendenteDesde(30, 'critica');

        const resultado = await ModeracaoService.expirarPendencias();

        expect(resultado.liberadas).toBe(1);
        expect(resultado.escalonadas).toBe(2);

        expect((await ModeracaoOcorrencia.findById(moderada._id).lean()).statusAtual).toBe(
            'expirada'
        );
        // Grave e crítica PERMANECEM pendentes: o prazo não absolve o que é grave.
        expect((await ModeracaoOcorrencia.findById(grave._id).lean()).statusAtual).toBe('pendente');
        expect((await ModeracaoOcorrencia.findById(critica._id).lean()).statusAtual).toBe(
            'pendente'
        );
    });

    it('não mexe em quem ainda está dentro do prazo', async () => {
        const recente = await pendenteDesde(2, 'moderada');

        const resultado = await ModeracaoService.expirarPendencias();

        expect(resultado.liberadas).toBe(0);
        expect((await ModeracaoOcorrencia.findById(recente._id).lean()).statusAtual).toBe(
            'pendente'
        );
    });

    it('respeita MODERACAO_PRAZO_FILA_HORAS', async () => {
        const anterior = process.env.MODERACAO_PRAZO_FILA_HORAS;
        process.env.MODERACAO_PRAZO_FILA_HORAS = '1';

        try {
            const item = await pendenteDesde(2, 'moderada');
            const resultado = await ModeracaoService.expirarPendencias();

            expect(resultado.liberadas).toBe(1);
            expect((await ModeracaoOcorrencia.findById(item._id).lean()).statusAtual).toBe(
                'expirada'
            );
        } finally {
            if (anterior === undefined) delete process.env.MODERACAO_PRAZO_FILA_HORAS;
            else process.env.MODERACAO_PRAZO_FILA_HORAS = anterior;
        }
    });
});
