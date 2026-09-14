/**
 * Migração: levar para a escala 0–10 as notas de avaliação gravadas em pontos.
 *
 * POR QUE ELA EXISTE (Issue #330)
 * -------------------------------
 * Desde o PR #309 a avaliação estruturada tem `valor` (pontuação máxima, de
 * 0,1 a 10), e o lançamento aceita de 0 até esse valor. Até a Issue #330 o que
 * o professor digitava ia direto para `Nota.nota` — em PONTOS. Só que o
 * boletim, o portal da família, os dashboards, o BI, os dados abertos da LAI e
 * as ferramentas da IA calculam média direto em `Nota.nota`, supondo 0–10: um
 * 4 numa prova que vale 5 (8,0, aprovado) entrava no boletim como 4,0.
 *
 * O código novo grava `nota` já convertida e guarda os pontos em `pontos`.
 * Esta migração faz o mesmo com o que já está no banco.
 *
 * O QUE ELA TOCA
 * --------------
 * Só notas de avaliação que vale MENOS de 10 (nas de valor 10, pontos e nota
 * são o mesmo número), que têm nota numérica e ainda não têm `pontos`:
 *
 *   pontos         ← nota (o que foi lançado)
 *   valorAvaliacao ← valor da avaliação
 *   nota           ← pontos ÷ valor × 10, com uma casa (arredondando meio para cima)
 *
 * Aluno pendente (nota vazia) fica como está: não há o que converter. O
 * `status` já saía da proporção desde o PR #309 e não muda.
 *
 * IDEMPOTENTE: depois da primeira execução toda nota convertida tem `pontos`,
 * e o filtro deixa de encontrá-la.
 */

/** Valor de avaliação que dispensa conversão: a escala do sistema. */
const ESCALA = 10;

/** Notas desta avaliação que ainda estão em pontos — exportado para o teste. */
function filtroEmPontos(avaliacaoId) {
    return {
        avaliacaoId: String(avaliacaoId),
        pontos: { $exists: false },
        nota: { $type: 'number' },
    };
}

/**
 * `pontos ÷ valor × 10` com uma casa, meio para cima — o mesmo arredondamento
 * de `Math.round` que o controller usa. O `$round` do MongoDB arredonda meio
 * para o PAR (6,25 → 6,2), e a nota migrada sairia diferente da lançada hoje.
 */
function conversaoPara(valor) {
    return {
        $divide: [
            { $floor: { $add: [{ $multiply: [{ $divide: ['$nota', valor] }, ESCALA * 10] }, 0.5] } },
            10,
        ],
    };
}

module.exports = {
    version: '1.5',

    filtroEmPontos,

    async up() {
        const mongoose = require('mongoose');
        const db = mongoose.connection.db;

        const avaliacoes = await db
            .collection('avaliacoes')
            .find({ valor: { $gt: 0, $lt: ESCALA } }, { projection: { _id: 1, valor: 1 } })
            .toArray();

        let convertidas = 0;
        for (const avaliacao of avaliacoes) {
            const resultado = await db.collection('notas').updateMany(filtroEmPontos(avaliacao._id), [
                {
                    $set: {
                        pontos: '$nota',
                        valorAvaliacao: avaliacao.valor,
                        nota: conversaoPara(avaliacao.valor),
                    },
                },
            ]);
            convertidas += resultado.modifiedCount;
        }

        console.log(
            `  … ${convertidas} nota(s) convertida(s) para 0–10 em ${avaliacoes.length} avaliação(ões) com valor < ${ESCALA}`
        );

        return {
            message: 'notas de avaliação com valor < 10 levadas para a escala 0–10',
            avaliacoes: avaliacoes.length,
            convertidas,
        };
    },

    /**
     * ROLLBACK.
     *
     * Devolve os pontos a `nota` e remove os dois campos — em toda nota que os
     * tenha, inclusive as lançadas depois do código novo. É o formato que o
     * código anterior à Issue #330 espera, e o `down` existe para acompanhar
     * esse rollback: sozinho, ele volta a mandar pontos para o boletim.
     */
    async down() {
        const mongoose = require('mongoose');
        const resultado = await mongoose.connection.db
            .collection('notas')
            .updateMany({ pontos: { $exists: true } }, [
                { $set: { nota: '$pontos' } },
                { $unset: ['pontos', 'valorAvaliacao'] },
            ]);

        return {
            message: 'pontos devolvidos a nota',
            revertidas: resultado.modifiedCount,
        };
    },
};
