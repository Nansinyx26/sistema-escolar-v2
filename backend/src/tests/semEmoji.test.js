/**
 * semEmoji.test.js — o assistente não usa emoji.
 *
 * O que estes testes protegem:
 *   1. a remoção não deixa rastro (espaço duplo, espaço pendurado no fim);
 *   2. sequências compostas (ZWJ, tom de pele, bandeira, keycap) saem INTEIRAS
 *      — o defeito clássico aqui é sobrar o segundo pictograma de "👨‍🏫";
 *   3. `©`, `®` e `™` NÃO são tratados como emoji (são pontuação de texto);
 *   4. no streaming, um emoji cortado entre dois chunks ainda sai inteiro;
 *   5. os textos fixos do assistente nasceram sem emoji e continuam assim.
 */

const fs = require('node:fs');
const path = require('node:path');

const { removerEmojis, criarFiltroEmoji } = require('../utils/semEmoji');
const { PERSONA_PROMPT_PREFIX } = require('../services/assistantPersona');

/** Qualquer pictograma, para asserção genérica de ausência. */
const TEM_EMOJI = /\p{Extended_Pictographic}/u;

describe('removerEmojis — texto completo', () => {
    it('emoji entre duas palavras deixa exatamente um espaço', () => {
        expect(removerEmojis('Olá! 😊 Sou o assistente.')).toBe('Olá! Sou o assistente.');
    });

    it('emoji no fim da frase não deixa espaço pendurado', () => {
        expect(removerEmojis('Até mais! Estarei por aqui. 👋')).toBe('Até mais! Estarei por aqui.');
    });

    it('emoji colado numa palavra sai sem abrir espaço', () => {
        expect(removerEmojis('🎉Parabéns')).toBe('Parabéns');
    });

    it('vários emojis seguidos contam como um só buraco', () => {
        expect(removerEmojis('Dois 😊👋 juntos')).toBe('Dois juntos');
    });

    describe('sequências compostas saem inteiras', () => {
        it('emenda por ZWJ (profissão) não deixa o segundo pictograma', () => {
            const saida = removerEmojis('Professores 👨‍🏫 da turma');
            expect(saida).toBe('Professores da turma');
            expect(saida).not.toMatch(TEM_EMOJI);
        });

        it('modificador de tom de pele sai com o pictograma', () => {
            expect(removerEmojis('Tom 👍🏽 ok')).toBe('Tom ok');
        });

        it('bandeira (par de indicadores regionais)', () => {
            expect(removerEmojis('Bandeira 🇧🇷 aqui')).toBe('Bandeira aqui');
        });

        it('keycap não deixa o dígito para trás', () => {
            const saida = removerEmojis('Keycap 1️⃣ fim');
            expect(saida).toBe('Keycap fim');
            expect(saida).not.toMatch(/1/);
        });
    });

    describe('o que não é emoji fica', () => {
        it('preserva ©, ® e ™ — são pontuação, não decoração', () => {
            expect(removerEmojis('Windows® e © 2026 ™')).toBe('Windows® e © 2026 ™');
        });

        it('não mexe em número, acento ou pontuação', () => {
            const texto = 'A média do 3º ano é 7,5 — frequência de 92%.';
            expect(removerEmojis(texto)).toBe(texto);
        });

        it('devolve entradas não-string sem quebrar', () => {
            expect(removerEmojis(null)).toBeNull();
            expect(removerEmojis(undefined)).toBeUndefined();
            expect(removerEmojis('')).toBe('');
        });
    });
});

describe('criarFiltroEmoji — texto em pedaços (SSE do copiloto)', () => {
    /** Passa a frase pelo filtro cortada nas posições dadas. */
    function porPedacos(frase, cortes) {
        const filtro = criarFiltroEmoji();
        let saida = '';
        let anterior = 0;
        for (const corte of cortes) {
            saida += filtro.escrever(frase.slice(anterior, corte));
            anterior = corte;
        }
        saida += filtro.escrever(frase.slice(anterior));
        return saida + filtro.finalizar();
    }

    const FRASE = 'Olá! 😊 Nota 8 do aluno 👨‍🏫 hoje. 👋';
    const ESPERADO = removerEmojis(FRASE);

    it('o resultado é o mesmo do texto inteiro, cortando em QUALQUER posição', () => {
        // Corte a corte: filtrar cada chunk isolado falharia exatamente nos
        // cortes que caem dentro de uma sequência com ZWJ.
        for (let corte = 1; corte < FRASE.length; corte++) {
            expect(porPedacos(FRASE, [corte])).toBe(ESPERADO);
        }
    });

    it('sobrevive a chunks de um caractere (pior caso)', () => {
        const cortes = Array.from({ length: FRASE.length }, (_, i) => i + 1);
        expect(porPedacos(FRASE, cortes)).toBe(ESPERADO);
    });

    it('emoji partido no meio do par de surrogates não vira resíduo', () => {
        const emoji = '😊';
        const filtro = criarFiltroEmoji();
        const saida =
            filtro.escrever(`Oi ${emoji[0]}`) +
            filtro.escrever(`${emoji[1]} tchau`) +
            filtro.finalizar();

        expect(saida).toBe('Oi tchau');
        expect(saida).not.toMatch(TEM_EMOJI);
    });

    it('finalizar() libera a cauda retida — o último dígito não some', () => {
        const filtro = criarFiltroEmoji();
        // "7" é cauda incerta (poderia ser a base de um keycap), então fica
        // retido; sem o finalizar, a média chegaria truncada ao banco.
        const saida = filtro.escrever('A média é 7') + filtro.finalizar();
        expect(saida).toBe('A média é 7');
    });

    it('finalizar() é idempotente — o controller o chama duas vezes', () => {
        // O controller drena no fim do `try` E no `finally` (o segundo cobre o
        // caminho de erro/abort). A segunda chamada tem de sair vazia, senão o
        // trecho final apareceria duplicado na resposta gravada.
        const filtro = criarFiltroEmoji();
        const parcial = filtro.escrever('texto ');
        expect(`${parcial}${filtro.finalizar()}`).toBe('texto ');
        expect(filtro.finalizar()).toBe('');
    });

    it('não engole texto: o que entra sai, contando o finalizar', () => {
        const filtro = criarFiltroEmoji();
        const parcial = filtro.escrever('Resposta completa sem emoji.');
        expect(`${parcial}${filtro.finalizar()}`).toBe('Resposta completa sem emoji.');
    });
});

describe('os textos fixos do assistente não têm emoji', () => {
    it('a persona PROÍBE emoji no prompt', () => {
        // O filtro é a garantia; a instrução é o que evita o texto nascer
        // torto. As duas precisam continuar dizendo a mesma coisa.
        expect(PERSONA_PROMPT_PREFIX).toMatch(/NUNCA use emojis/i);
        expect(PERSONA_PROMPT_PREFIX).not.toMatch(TEM_EMOJI);
    });

    it('nenhuma resposta pronta do chatbot traz emoji', () => {
        const { getConversationalFallback } = require('../services/ChatbotService');
        const intencoes = [
            'SAUDACAO', 'AGRADECIMENTO', 'DESPEDIDA',
            'SOBRE_SISTEMA', 'ELOGIO', 'RECLAMACAO',
            'FORA_CONTEXTO', 'INDEFINIDA',
        ];
        for (const intencao of intencoes) {
            expect(getConversationalFallback(intencao)).not.toMatch(TEM_EMOJI);
        }
    });

    it('nenhum template do modo offline traz emoji', () => {
        // Lido do arquivo: os templates não são exportados, e a alternativa
        // (sortear até cair em todos) tornaria o teste instável.
        const arquivo = path.join(__dirname, '..', 'services', 'offlineResponseService.js');
        const fonte = fs.readFileSync(arquivo, 'utf8');
        expect(fonte).not.toMatch(TEM_EMOJI);
    });
});
