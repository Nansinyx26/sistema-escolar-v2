/**
 * @jest-environment jsdom
 */

/**
 * iaNarracao.test.js — a narração em trechos do copiloto (`js/ia/`).
 *
 * O que está sob teste é a promessa da funcionalidade: a voz começa DEPOIS DA
 * PRIMEIRA FRASE, e não depois da resposta inteira, e nenhum pedaço do texto
 * fica sem ser falado no caminho.
 *
 * Ambiente jsdom (ver o docblock acima) porque `NarradorStream` mexe com
 * `window`, `Audio` e `URL.createObjectURL`. `SegmentadorFala` é lógica pura e
 * não precisaria de DOM, mas mora na mesma suíte por ser o outro lado da mesma
 * funcionalidade.
 */

const { SegmentadorFala, limparParaFala } = require('../../../js/ia/SegmentadorFala.js');
const { NarradorStream } = require('../../../js/ia/NarradorStream.js');

/** Espera a fila de microtarefas virar — as promessas de busca resolvem aí. */
const assentar = () => new Promise((r) => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────

describe('limparParaFala', () => {
    it('não manda bloco de código para a voz', () => {
        const limpo = limparParaFala('Veja:\n```js\nconst x = {a: 1};\n```\nPronto.');
        expect(limpo).not.toContain('const');
        expect(limpo).toContain('Veja');
        expect(limpo).toContain('Pronto');
    });

    it('bloco de código ainda aberto (stream no meio) também é descartado', () => {
        const limpo = limparParaFala('Segue o exemplo:\n```js\nfunction f(');
        expect(limpo).toBe('Segue o exemplo:');
    });

    it('lê o rótulo do link, nunca a URL', () => {
        expect(limparParaFala('Veja o [calendário](https://escola.exemplo/cal).')).toBe(
            'Veja o calendário.'
        );
    });

    it('some com a marcação que não se pronuncia', () => {
        const limpo = limparParaFala('## Resumo\n\n- **Turma 6A**\n- _30 alunos_\n\n> nota');
        expect(limpo).toBe('Resumo Turma 6A 30 alunos nota');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SegmentadorFala', () => {
    /** Frase de ~60 caracteres, para montar respostas de tamanho previsível. */
    const frase = (n) => `Esta e a frase numero ${n} da resposta do assistente. `;

    it('segura o primeiro trecho enquanto a resposta é curta demais', () => {
        const s = new SegmentadorFala();
        expect(s.alimentar('Oi! Tudo bem?')).toEqual([]);
    });

    it('solta o primeiro trecho assim que uma frase fecha depois do mínimo', () => {
        const s = new SegmentadorFala();
        const texto = frase(1) + frase(2) + frase(3);

        const trechos = s.alimentar(texto);

        expect(trechos).toHaveLength(1);
        // O corte é o PRIMEIRO fim de frase depois do mínimo — a voz começa a
        // sair com um pedaço curto, que é o ponto de toda a funcionalidade.
        expect(trechos[0].fala.length).toBeLessThan(200);
        expect(trechos[0].fala).toContain('frase numero 2');
        expect(trechos[0].fala).not.toContain('frase numero 3');
    });

    it('os trechos seguintes são maiores que o primeiro', () => {
        const s = new SegmentadorFala();
        let texto = '';
        for (let i = 1; i <= 20; i++) texto += frase(i);

        const trechos = s.alimentar(texto);

        expect(trechos.length).toBeGreaterThan(1);
        expect(trechos[1].fala.length).toBeGreaterThan(trechos[0].fala.length);
    });

    it('não corta no ponto de um item numerado', () => {
        const s = new SegmentadorFala();
        // O "1." está bem depois do mínimo: sem a proteção ele viraria um
        // trecho que a voz leria como um "um" solto.
        const texto = `${frase(1)}${frase(2)}\n1. Primeiro item da lista que continua aqui.\n`;

        const trechos = s.alimentar(texto);

        expect(trechos[0].fala).not.toMatch(/1\.?\s*$/);
    });

    it('finalizar entrega o resto que não fechou frase', () => {
        const s = new SegmentadorFala();
        const texto = `${frase(1)}${frase(2)}${frase(3)}e um final sem ponto`;

        s.alimentar(texto);
        const resto = s.finalizar();

        expect(resto.length).toBeGreaterThan(0);
        expect(resto[resto.length - 1].fala).toContain('final sem ponto');
    });

    it('a resposta inteira é coberta, sem buraco nem sobreposição', () => {
        const s = new SegmentadorFala();
        let texto = '';
        for (let i = 1; i <= 12; i++) texto += frase(i);

        const trechos = [...s.alimentar(texto), ...s.finalizar()];

        let cursor = 0;
        for (const t of trechos) {
            expect(t.inicio).toBe(cursor);
            cursor = t.fim;
        }
        // O que sobra depois do último trecho não pode ter NADA a dizer: um
        // espaço final é aceitável, uma palavra perdida seria uma frase que a
        // narração simplesmente pulou.
        expect(texto.slice(cursor).trim()).toBe('');
    });

    /**
     * A garantia de custo. Cada trecho é uma requisição de síntese contra a
     * cota paga (ver ttsUsuarioLimiter), e é durante o STREAMING que o
     * segmentador tende a cortar cedo demais — ali ele só conhece o texto que
     * já chegou. Este teste é o que segura os mínimos de PERFIS no lugar.
     */
    it('uma resposta longa chegando aos poucos não vira uma enxurrada de trechos', () => {
        let texto = '';
        for (let i = 1; i <= 40; i++) texto += frase(i); // ~2000 caracteres

        const s = new SegmentadorFala();
        const trechos = [];
        // O stream real entrega de poucos caracteres por vez — o pior caso para
        // quem corta assim que passa do mínimo.
        for (let i = 20; i <= texto.length; i += 20) {
            trechos.push(...s.alimentar(texto.slice(0, i)));
        }
        trechos.push(...s.alimentar(texto), ...s.finalizar());

        expect(trechos.length).toBeGreaterThan(1); // não virou uma espera só
        expect(trechos.length).toBeLessThanOrEqual(6);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('NarradorStream', () => {
    let tocados;

    class AudioFalso {
        constructor(url) {
            this.src = url;
            this._ouvintes = {};
            AudioFalso.vivos.push(this);
        }
        addEventListener(nome, fn) {
            this._ouvintes[nome] = fn;
        }
        play() {
            tocados.push(this.src);
            return Promise.resolve();
        }
        pause() {}
        /** Simula o fim natural do áudio deste trecho. */
        terminar() {
            this._ouvintes.ended?.();
        }
    }

    beforeEach(() => {
        tocados = [];
        AudioFalso.vivos = [];

        window.Audio = AudioFalso;
        global.Audio = AudioFalso;
        // jsdom não implementa nenhum dos dois.
        URL.createObjectURL = jest.fn(() => `blob:trecho-${URL.createObjectURL.mock.calls.length}`);
        URL.revokeObjectURL = jest.fn();

        global.fetch = jest.fn(async () => ({
            ok: true,
            blob: async () => new Blob(['x'.repeat(500)]),
        }));
    });

    /** Trecho no formato que o SegmentadorFala produz. */
    const trecho = (fala) => ({ inicio: 0, fim: fala.length, fala });

    it('toca os trechos na ordem, um depois do outro', async () => {
        const falados = [];
        const n = new NarradorStream({ aoTocarTrecho: (t) => falados.push(t.fala) });

        n.enfileirar(trecho('Primeira frase.'));
        n.enfileirar(trecho('Segunda frase.'));
        await assentar();

        // Só o primeiro tocou; o segundo espera o fim dele.
        expect(falados).toEqual(['Primeira frase.']);

        AudioFalso.vivos[0].terminar();
        await assentar();

        expect(falados).toEqual(['Primeira frase.', 'Segunda frase.']);
    });

    it('busca o trecho seguinte enquanto o atual ainda toca', async () => {
        const n = new NarradorStream();

        n.enfileirar(trecho('Primeira frase.'));
        n.enfileirar(trecho('Segunda frase.'));
        await assentar();

        // A síntese do segundo já saiu, com o primeiro ainda no ar. É isso que
        // evita o silêncio entre uma frase e a outra.
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(tocados).toHaveLength(1);
    });

    it('avisa o fim só quando a fila esvazia depois de fechada', async () => {
        const aoTerminar = jest.fn();
        const n = new NarradorStream({ aoTerminar });

        n.enfileirar(trecho('Frase única.'));
        n.fechar();
        await assentar();

        expect(aoTerminar).not.toHaveBeenCalled();

        AudioFalso.vivos[0].terminar();
        await assentar();

        expect(aoTerminar).toHaveBeenCalledTimes(1);
    });

    it('parar cala o áudio e não sintetiza mais nada', async () => {
        const falados = [];
        const n = new NarradorStream({ aoTocarTrecho: (t) => falados.push(t.fala) });

        n.enfileirar(trecho('Primeira frase.'));
        await assentar();
        const chamadasAteAqui = global.fetch.mock.calls.length;

        n.parar();
        n.enfileirar(trecho('Esta não deve ser falada.'));
        await assentar();

        expect(falados).toEqual(['Primeira frase.']);
        expect(global.fetch).toHaveBeenCalledTimes(chamadasAteAqui);
    });

    it('desiste da narração quando a síntese falha seguidamente', async () => {
        global.fetch = jest.fn(async () => ({ ok: false, status: 500 }));
        const aoFalhar = jest.fn();
        const n = new NarradorStream({ aoFalhar });

        n.enfileirar(trecho('Primeira frase.'));
        n.enfileirar(trecho('Segunda frase.'));
        await assentar();
        await assentar();

        expect(aoFalhar).toHaveBeenCalledTimes(1);
        expect(tocados).toEqual([]);
    });

    it('áudio truncado pelo servidor conta como falha, não como som', async () => {
        // 200 OK com corpo minúsculo é como alguns erros do provedor voltam.
        global.fetch = jest.fn(async () => ({
            ok: true,
            blob: async () => new Blob(['x']),
        }));
        const n = new NarradorStream();

        n.enfileirar(trecho('Primeira frase.'));
        await assentar();

        expect(tocados).toEqual([]);
    });
});
