/**
 * dadosAbertosAnonimato.test.js — a supressão que separa a LAI da LGPD.
 *
 * POR QUE ESTES TESTES SÃO O CORAÇÃO DO MÓDULO
 * --------------------------------------------
 * Publicar indicador educacional é obrigação (LAI); publicar dado de criança é
 * proibido (LGPD, art. 14). O que separa um do outro é UMA função — a que
 * decide que célula é pequena demais para ir a público.
 *
 * O erro clássico não é esquecer de suprimir: é suprimir uma célula só e deixar
 * o total publicado. Aí a célula "escondida" volta por subtração, e a planilha
 * do portal da transparência entrega o que a lei mandava proteger. O teste
 * "não dá para deduzir por subtração" abaixo é a razão de a função ser
 * iterativa em vez de um `filter`.
 */
const { agruparPequenos, LIMIAR_ANONIMATO } = require('../services/conformidade/dadosAbertos');

const chaves = (resultado) => resultado.itens.map((i) => i.chave);
const total = (resultado) => resultado.itens.reduce((s, i) => s + i.valor, 0);

describe('supressão com limiar (k-anonimato)', () => {
    it('publica normalmente quando toda célula tem 5 ou mais estudantes', () => {
        const r = agruparPequenos([
            { chave: '1A', valor: 28 },
            { chave: '1B', valor: 5 },
        ]);
        expect(chaves(r)).toEqual(['1A', '1B']);
        expect(r.suprimidos).toBe(0);
    });

    it('soma as células pequenas num balde "Outros" em vez de publicá-las', () => {
        const r = agruparPequenos([
            { chave: '1A', valor: 30 },
            { chave: 'Turma multisseriada', valor: 3 },
            { chave: 'Classe hospitalar', valor: 2 },
        ]);
        expect(chaves(r)).toEqual(['1A', expect.stringContaining('Outros')]);
        expect(r.itens[1].valor).toBe(5);
        expect(r.itens[1].agregado).toBe(true);
    });

    it('não dá para deduzir a célula suprimida por subtração do total', () => {
        // Com uma única turma pequena, "Outros = 2" seria tão revelador quanto
        // publicar a turma. A função puxa a menor célula pública para dentro do
        // balde até ele deixar de identificar alguém.
        const r = agruparPequenos([
            { chave: '1A', valor: 30 },
            { chave: '1B', valor: 6 },
            { chave: 'Classe hospitalar', valor: 2 },
        ]);
        expect(chaves(r)).toEqual(['1A', expect.stringContaining('Outros')]);
        expect(r.itens[1].valor).toBe(8); // 6 + 2 — a turma de 2 não é isolável
        expect(r.suprimidos).toBe(2);
    });

    it('preserva o total: anonimizar não é perder o número da rede', () => {
        const entrada = [
            { chave: '1A', valor: 30 },
            { chave: '1B', valor: 7 },
            { chave: '1C', valor: 1 },
            { chave: '1D', valor: 2 },
        ];
        const r = agruparPequenos(entrada);
        expect(total(r)).toBe(40);
    });

    it('quando a escola inteira é menor que o limiar, nada é publicado em separado', () => {
        const r = agruparPequenos([
            { chave: 'Turma única', valor: 2 },
            { chave: 'Outra', valor: 1 },
        ]);
        // Sobra só o agregado: com 3 estudantes no total, qualquer recorte
        // identifica todos eles.
        expect(r.itens).toHaveLength(1);
        expect(r.itens[0].agregado).toBe(true);
        expect(r.itens[0].valor).toBe(3);
    });

    it('ignora célula zerada em vez de publicar "0", que também informa', () => {
        const r = agruparPequenos([
            { chave: '1A', valor: 30 },
            { chave: 'Indígena', valor: 0 },
        ]);
        expect(chaves(r)).toEqual(['1A']);
    });

    it('o limiar padrão é 5', () => {
        expect(LIMIAR_ANONIMATO).toBe(5);
    });
});
