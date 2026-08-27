/**
 * moderacaoService.matriz.test.js — §5.1 da ESPEC-MODERACAO-CHAT.md.
 *
 * A matriz é função pura de propósito: dá para exercer a tabela inteira sem
 * subir Mongo e sem mockar provedor nenhum. Se um dia alguém precisar de banco
 * para testar "quando é que a escola bloqueia", a política vazou para fora
 * daqui e é isso que precisa ser consertado.
 */

const matriz = require('../services/moderacao/politicas/matrizSeveridade');

describe('matrizSeveridade — a tabela de §5.1', () => {
    it('traduz os níveis do léxico para a escala de severidade', () => {
        // O léxico fala 'moderado' (nível) e a moderação fala 'moderada'
        // (severidade). Comparar os dois direto devolveria false em silêncio.
        expect(matriz.severidadeDoLexico('leve')).toBe('leve');
        expect(matriz.severidadeDoLexico('moderado')).toBe('moderada');
        expect(matriz.severidadeDoLexico('grave')).toBe('grave');
        expect(matriz.severidadeDoLexico('inexistente')).toBe('nenhuma');
    });

    it('cada severidade tem a ação da tabela', () => {
        expect(matriz.decidir({ severidadeLexico: 'grave' })).toMatchObject({
            severidade: 'grave',
            decisao: 'bloqueada',
            entrega: false,
            fila: true,
        });

        expect(matriz.decidir({ severidadeLexico: 'moderado' })).toMatchObject({
            severidade: 'moderada',
            decisao: 'em_revisao',
            entrega: false,
            fila: true,
        });

        // LEVE é o único caso que ENTREGA e mesmo assim registra.
        expect(matriz.decidir({ severidadeLexico: 'leve' })).toMatchObject({
            severidade: 'leve',
            decisao: 'entregue_com_registro',
            entrega: true,
            fila: false,
        });

        expect(matriz.decidir({})).toMatchObject({
            severidade: 'nenhuma',
            decisao: null,
            entrega: true,
            fila: false,
        });
    });

    it('CRÍTICA escalona à direção, não só entra na fila', () => {
        const decisao = matriz.decidir({ severidadeImagem: 'critica' });
        expect(decisao).toMatchObject({
            severidade: 'critica',
            decisao: 'bloqueada',
            escalonar: true,
            prioridade: 'maxima',
        });
    });

    it('a severidade final é a MAIOR entre as camadas', () => {
        // Nenhuma camada abaixa o que outra levantou.
        const decisao = matriz.decidir({
            severidadeLexico: 'leve',
            severidadeImagem: 'grave',
        });
        expect(decisao.severidade).toBe('grave');
    });

    /**
     * A linha da tabela que existe para o falso positivo do modelo não barrar
     * mensagem de pai sem ninguém olhar: classificador `grave` SEM confirmação
     * do léxico vira MODERADA (retenção), não bloqueio.
     */
    it('classificador grave sem confirmação do léxico vira MODERADA', () => {
        const semConfirmacao = matriz.decidir({ severidadeClassificador: 'grave' });
        expect(semConfirmacao.severidade).toBe('moderada');
        expect(semConfirmacao.decisao).toBe('em_revisao');

        const comConfirmacao = matriz.decidir({
            severidadeClassificador: 'grave',
            severidadeLexico: 'grave',
            confirmadoPeloLexico: true,
        });
        expect(comConfirmacao.severidade).toBe('grave');
        expect(comConfirmacao.decisao).toBe('bloqueada');
    });
});

describe('matrizSeveridade — agravamento por reincidência', () => {
    it('LEVE de reincidente vira MODERADA', () => {
        const decisao = matriz.decidir({ severidadeLexico: 'leve', reincidente: true });
        expect(decisao.severidade).toBe('moderada');
        expect(decisao.agravada).toBe(true);
        expect(decisao.fila).toBe(true);
    });

    /**
     * Reincidência só sobe de LEVE. Se subisse de MODERADA para GRAVE, o
     * histórico viraria pena crescente automática — bloqueio sem nenhuma
     * decisão humana no caminho.
     */
    it('não agrava além de LEVE', () => {
        const decisao = matriz.decidir({ severidadeLexico: 'moderado', reincidente: true });
        expect(decisao.severidade).toBe('moderada');
        expect(decisao.agravada).toBe(false);
    });
});

describe('matrizSeveridade — atenuação do atestado com ferimento', () => {
    const categoriasMedicas = { medical: 0.9, adult: 0.1, violence: 0.2 };

    it('secretaria com eixo medical dominante entrega em vez de reter', () => {
        const decisao = matriz.decidir({
            severidadeImagem: 'moderada',
            categorias: categoriasMedicas,
            perfilRemetente: 'secretaria',
        });

        expect(decisao.severidade).toBe('leve');
        expect(decisao.atenuada).toBe(true);
        expect(decisao.entrega).toBe(true);
    });

    it('responsável NÃO recebe a atenuação', () => {
        const decisao = matriz.decidir({
            severidadeImagem: 'moderada',
            categorias: categoriasMedicas,
            perfilRemetente: 'responsavel',
        });

        expect(decisao.severidade).toBe('moderada');
        expect(decisao.atenuada).toBe(false);
    });

    /**
     * A porta do atestado não pode virar passagem para o resto: com `adult`
     * alto, a atenuação não se aplica nem para quem está na lista de perfis.
     */
    it('não atenua quando adult ou violence competem com medical', () => {
        const decisao = matriz.decidir({
            severidadeImagem: 'moderada',
            categorias: { medical: 0.6, adult: 0.8 },
            perfilRemetente: 'diretor',
        });

        expect(decisao.severidade).toBe('moderada');
        expect(decisao.atenuada).toBe(false);
    });

    it('não atenua severidade GRAVE, nem para perfil da equipe', () => {
        const decisao = matriz.decidir({
            severidadeImagem: 'grave',
            categorias: categoriasMedicas,
            perfilRemetente: 'diretor',
        });

        expect(decisao.severidade).toBe('grave');
        expect(decisao.atenuada).toBe(false);
    });
});
