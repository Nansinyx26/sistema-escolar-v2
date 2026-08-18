/**
 * Migração: campos e índices do módulo "Alunos por Turma / Importação SEDUC".
 *
 * O QUE ESTA MIGRAÇÃO FAZ
 * ----------------------
 * 1. Preenche `nomeNormalizado` nos alunos existentes. Sem isso, o autocomplete
 *    da secretaria e a detecção de duplicata por nome só enxergam alunos
 *    criados DEPOIS do deploy — os antigos ficam invisíveis na busca.
 * 2. Preenche os defaults dos campos novos (`raUf`, `situacao`, `origemCadastro`)
 *    nos documentos que não os têm.
 * 3. Cria os índices novos.
 *
 * O QUE ELA NÃO FAZ
 * -----------------
 * Não toca em `matricula` (o RA), não separa dígito verificador do RA existente
 * e não apaga nada. Alunos legados seguem sem `raDigito` — o campo é opcional e
 * a ausência dele nunca bloqueia uma importação (ver `classificador.js`).
 *
 * IDEMPOTENTE: pode rodar mais de uma vez sem efeito colateral.
 */

module.exports = {
    version: '1.1',

    async up() {
        const mongoose = require('mongoose');
        const Aluno = require('../src/models/Aluno');
        const Matricula = require('../src/models/Matricula');
        const ImportacaoAlunos = require('../src/models/ImportacaoAlunos');
        const { normalizarNome } = require('../src/utils/nomeAluno');

        // ── 1. nomeNormalizado ───────────────────────────────────────────────
        // Em blocos: uma escola grande tem milhares de alunos e carregar todos
        // de uma vez estoura a memória do plano free do Render.
        const TAMANHO_BLOCO = 500;
        let processados = 0;
        let ultimoId = null;

        for (;;) {
            const filtro = {
                $or: [{ nomeNormalizado: { $exists: false } }, { nomeNormalizado: null }, { nomeNormalizado: '' }],
            };
            if (ultimoId) filtro._id = { $gt: ultimoId };

            const bloco = await Aluno.find(filtro).sort({ _id: 1 }).limit(TAMANHO_BLOCO)
                .select('_id nome sobrenome').lean();
            if (bloco.length === 0) break;

            const operacoes = bloco.map((aluno) => ({
                updateOne: {
                    filter: { _id: aluno._id },
                    update: { $set: { nomeNormalizado: normalizarNome(`${aluno.nome || ''} ${aluno.sobrenome || ''}`) } },
                },
            }));
            await Aluno.bulkWrite(operacoes, { ordered: false });

            processados += bloco.length;
            ultimoId = bloco[bloco.length - 1]._id;
            console.log(`  … ${processados} alunos normalizados`);
        }

        // ── 2. Defaults dos campos novos ─────────────────────────────────────
        const uf = await Aluno.updateMany({ raUf: { $exists: false } }, { $set: { raUf: 'SP' } });
        const situacao = await Aluno.updateMany({ situacao: { $exists: false } }, { $set: { situacao: 'ativo' } });
        const origem = await Aluno.updateMany({ origemCadastro: { $exists: false } }, { $set: { origemCadastro: 'manual' } });

        // ── 3. Índice legado que bloqueia a criação dos novos ────────────────
        //
        // `alunos.matricula_1` existe em bases antigas como `unique: true`
        // GLOBAL — de antes do multi-escola. Ele contradiz a regra que o schema
        // documenta ("um RA na Escola A é independente do mesmo número na
        // Escola B") e, na prática, impediria duas escolas de terem o mesmo RA.
        //
        // Ele também trava esta migração: o schema pede um `matricula_1` sparse
        // e NÃO-unique, mesmo nome e opções diferentes, e o `createIndexes`
        // abaixo recusa em vez de reconciliar.
        //
        // A derrubada é EXPLÍCITA e restrita a esse formato. Não se usa
        // `syncIndexes` aqui de propósito: ele derrubaria qualquer índice fora
        // do schema, incluindo os que nada têm a ver com esta entrega.
        //
        // `{escolaId, matricula}` unique — a proteção real contra RA duplicado
        // dentro da escola — não é tocado e segue de pé o tempo todo.
        let indiceLegadoRemovido = false;
        try {
            const indices = await Aluno.collection.indexes();
            const legado = indices.find(
                (indice) => indice.name === 'matricula_1' && indice.unique === true
            );
            if (legado) {
                await Aluno.collection.dropIndex('matricula_1');
                indiceLegadoRemovido = true;
                console.log(
                    '  ⚠️  índice legado alunos.matricula_1 (unique global) removido — ' +
                        'a unicidade do RA é por escola, garantida por {escolaId, matricula}'
                );
            }
        } catch (erro) {
            // Collection ainda não existe numa base nova: nada a remover.
            if (erro.codeName !== 'NamespaceNotFound') throw erro;
        }

        // ── 4. Índices ───────────────────────────────────────────────────────
        // `createIndexes`, NÃO `syncIndexes`.
        //
        // `syncIndexes` também DERRUBA todo índice que existe no banco e não
        // está no schema — e a base real tem drift anterior a esta feature
        // (`matricula_1` no Atlas foi criado sem as opções que o schema
        // declara). Uma migração de funcionalidade não pode reconstruir índice
        // alheio como efeito colateral: numa collection grande isso é uma
        // operação cara e sem relação nenhuma com o que está sendo entregue.
        //
        // Aqui só se ACRESCENTA. O único {escolaId, matricula} — a proteção
        // contra RA duplicado — fica de pé o tempo todo.
        await Aluno.createIndexes();
        await Matricula.createIndexes();
        await ImportacaoAlunos.createIndexes();

        // Confirma que o TTL da collection de importação existe: é ele que
        // garante que a cópia temporária de dado de criança não fica para
        // sempre no banco.
        const indices = await mongoose.connection.db.collection('importacoes_alunos').indexes();
        const temTtl = indices.some((indice) => indice.expireAfterSeconds !== undefined);
        if (!temTtl) throw new Error('Índice TTL de importacoes_alunos não foi criado — verifique antes de seguir.');

        return {
            message: 'Campos e índices do módulo de alunos por turma aplicados',
            indiceLegadoRemovido,
            nomeNormalizadoPreenchido: processados,
            raUfPreenchido: uf.modifiedCount,
            situacaoPreenchida: situacao.modifiedCount,
            origemCadastroPreenchida: origem.modifiedCount,
        };
    },

    /**
     * ROLLBACK.
     *
     * Remove SÓ os campos que esta migração introduziu e a collection
     * temporária de importações. `matricula` (o RA), nome, nascimento e as
     * matrículas NÃO são tocados — nada de dado real é perdido no rollback.
     *
     * Atenção: `importacaoId` e `origemCadastro` são o que permite desfazer uma
     * importação. Removê-los torna as importações já confirmadas
     * irreversíveis; os alunos continuam existindo normalmente.
     */
    async down() {
        const mongoose = require('mongoose');
        const Aluno = require('../src/models/Aluno');
        const Matricula = require('../src/models/Matricula');

        const alunos = await Aluno.updateMany({}, {
            $unset: {
                nomeNormalizado: 1, raDigito: 1, raUf: 1, situacao: 1,
                dataMovimentacao: 1, transtornos: 1, origemCadastro: 1, importacaoId: 1,
            },
        });

        const matriculas = await Matricula.updateMany({}, { $unset: { serie: 1, importacaoId: 1 } });

        const derrubarIndice = async (Model, nome) => {
            try { await Model.collection.dropIndex(nome); } catch (e) { /* já não existe */ }
        };
        await derrubarIndice(Aluno, 'escolaId_1_nomeNormalizado_1');
        await derrubarIndice(Aluno, 'escolaId_1_importacaoId_1');
        await derrubarIndice(Matricula, 'escolaId_1_turmaId_1_anoLetivo_1');
        await derrubarIndice(Matricula, 'escolaId_1_importacaoId_1');

        try {
            await mongoose.connection.db.collection('importacoes_alunos').drop();
        } catch (e) { /* collection pode nem ter sido criada */ }

        return {
            message: 'Campos e índices do módulo de alunos por turma removidos',
            alunosAfetados: alunos.modifiedCount,
            matriculasAfetadas: matriculas.modifiedCount,
        };
    },
};
