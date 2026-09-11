/**
 * Migração: tirar o `consentimentoAceiteEm` que foi carimbado no cadastro.
 *
 * POR QUE ELA EXISTE (Issue #236)
 * -------------------------------
 * Sete caminhos de criação de conta gravavam `consentimentoAceiteEm: now` no
 * próprio `Usuario.create` — sem tela de consentimento e sem ninguém marcar
 * nada. O código parou de gravar; esta migração cuida do que já está no banco.
 *
 * Deixar o carimbo não é neutro. `utils/consentimentoLgpd.js` o trata como
 * consentimento válido, e por isso:
 *
 *   • "Meus Dados" (Art. 18 da LGPD) informa ao titular um consentimento que
 *     ele nunca deu, com a data do cadastro;
 *   • o `ModeracaoController` só grava o aceite auditável quando o titular AINDA
 *     NÃO consentiu — com o carimbo, nunca grava, nem quando a pessoa assina de
 *     verdade;
 *   • o `EditarPerfil` do portal abre as caixas de consentimento já marcadas.
 *
 * E pelo Art. 8º, §2º, cabe ao controlador provar o consentimento. Um carimbo
 * sem nenhum ato por trás não prova nada.
 *
 * O QUE ELA CONSIDERA CARIMBO — as três condições juntas
 * -----------------------------------------------------
 *   1. o campo existe e é data;
 *   2. NÃO há entrada `politica_privacidade` no `lgpdHistory` — quem consentiu
 *      pelo portal tem essa entrada (`UserController.updateProfile`,
 *      `newLgpdRecords`), então nunca é tocado aqui, mesmo que tenha aceitado
 *      segundos depois de criar a conta;
 *   3. o carimbo está a no máximo `TOLERANCIA_MS` do `createdAt`. É a
 *      assinatura do carimbo de cadastro: ele e o `createdAt` saem do mesmo
 *      `Usuario.create`, com milissegundos de diferença. Um aceite posterior —
 *      o onboarding antigo, que gravava só o campo — fica fora.
 *
 * Conta sem `createdAt` (anterior ao `timestamps: true` do model) fica como
 * está: sem ele não há como provar que o carimbo é de cadastro, e na dúvida
 * esta migração não mexe.
 *
 * NADA É APAGADO
 * --------------
 * O valor sai de `consentimentoAceiteEm` e vai para `consentimentoInvalidado`,
 * junto de quando e por quê. Isso mantém o rastro da correção — quem fizer
 * auditoria vê o que havia e por que deixou de valer — e é o que permite o
 * `down`.
 *
 * O campo novo está declarado no schema do `Usuario` com `select: false`. Não
 * basta deixá-lo fora do schema: o `strict` do Mongoose só barra o que é
 * GRAVADO — o que vem do banco é carregado inteiro e sairia no `toJSON` de
 * qualquer rota que devolva o usuário. É registro de auditoria, não dado de
 * tela.
 *
 * O EFEITO NA TELA
 * ----------------
 * Ninguém perde acesso: nada no sistema bloqueia quem está sem consentimento.
 * A pessoa passa a ver "não registrado" e é convidada a aceitar — e, quando
 * aceitar, o registro que fica é o auditável.
 *
 * IDEMPOTENTE: depois da primeira execução, nenhuma conta satisfaz mais a
 * condição 1 com carimbo de cadastro.
 */

const { CONSENTIMENTO_ID } = require('../src/utils/consentimentoLgpd');

/**
 * Distância máxima entre o carimbo e o `createdAt` para contar como carimbo de
 * cadastro. Os dois saem do mesmo `Usuario.create` — na prática, milissegundos.
 * Um minuto é folga larga para relógio e latência, e ainda muito menor que o
 * tempo de alguém criar a conta e passar pelo onboarding.
 */
const TOLERANCIA_MS = 60 * 1000;

const MOTIVO =
    'Issue #236: carimbado no cadastro, sem ato do titular e sem registro em lgpdHistory';

/** O filtro das três condições — exportado para o teste usar o mesmo. */
const FILTRO_CARIMBO_DE_CADASTRO = {
    consentimentoAceiteEm: { $type: 'date' },
    createdAt: { $type: 'date' },
    'lgpdHistory.termoId': { $ne: CONSENTIMENTO_ID },
    $expr: {
        $lte: [
            { $abs: { $subtract: ['$consentimentoAceiteEm', '$createdAt'] } },
            TOLERANCIA_MS,
        ],
    },
};

module.exports = {
    version: '1.4',

    FILTRO_CARIMBO_DE_CADASTRO,
    TOLERANCIA_MS,

    async up() {
        const mongoose = require('mongoose');
        const usuarios = mongoose.connection.db.collection('usuarios');

        // `updateMany` com pipeline roda inteiro no servidor: nenhuma conta é
        // carregada no processo, então não precisa de blocos como as migrações
        // que leem documento por documento.
        const resultado = await usuarios.updateMany(FILTRO_CARIMBO_DE_CADASTRO, [
            {
                $set: {
                    consentimentoInvalidado: {
                        consentimentoAceiteEm: '$consentimentoAceiteEm',
                        consentimentoVersao: '$consentimentoVersao',
                        invalidadoEm: '$$NOW',
                        motivo: MOTIVO,
                    },
                },
            },
            { $unset: ['consentimentoAceiteEm', 'consentimentoVersao'] },
        ]);

        console.log(`  … ${resultado.modifiedCount} conta(s) sem o carimbo de cadastro`);

        return {
            message: 'consentimentoAceiteEm carimbado no cadastro movido para consentimentoInvalidado',
            invalidados: resultado.modifiedCount,
        };
    },

    /**
     * ROLLBACK.
     *
     * Devolve o valor original ao campo e remove o registro de auditoria — só
     * nas contas que esta migração marcou.
     *
     * Atenção: voltar atrás faz o sistema afirmar de novo um consentimento que
     * ninguém deu. O `down` existe para acompanhar um rollback de código, não
     * para ser usado sozinho.
     */
    async down() {
        const mongoose = require('mongoose');
        const resultado = await mongoose.connection.db.collection('usuarios').updateMany(
            { 'consentimentoInvalidado.motivo': MOTIVO },
            [
                {
                    $set: {
                        consentimentoAceiteEm: '$consentimentoInvalidado.consentimentoAceiteEm',
                        consentimentoVersao: '$consentimentoInvalidado.consentimentoVersao',
                    },
                },
                { $unset: 'consentimentoInvalidado' },
            ]
        );

        return {
            message: 'carimbo de cadastro devolvido a consentimentoAceiteEm',
            revertidos: resultado.modifiedCount,
        };
    },
};
