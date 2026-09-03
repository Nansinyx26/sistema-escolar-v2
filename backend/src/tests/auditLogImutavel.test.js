/**
 * auditLogImutavel.test.js — o log que ninguém pode reescrever.
 *
 * POR QUE ISTO IMPORTA MAIS QUE UM TESTE DE CRUD
 * ---------------------------------------------
 * O art. 15 do Marco Civil obriga a guarda dos registros de acesso, e em escola
 * pública o log é a prova de quem alterou nota, justificou falta ou exportou
 * dado de aluno. Prova que o autor da fraude consegue apagar não é prova — e
 * quem altera a nota é exatamente quem tem motivo para remover a linha.
 *
 * Os testes abaixo não passam por banco de propósito: o middleware do mongoose
 * recusa a operação ANTES de qualquer ida ao servidor, e é isso que se quer
 * fixar. Se um dia alguém trocar o hook por uma checagem feita no controller,
 * estes testes continuam sendo a régua.
 */
const AuditLog = require('../models/AuditLog');

const esperarBloqueio = async (promessa) => {
    await expect(promessa).rejects.toMatchObject({ codigo: 'AUDIT_LOG_IMUTAVEL' });
};

describe('audit_logs é append-only', () => {
    it('recusa apagar um log específico', async () => {
        await esperarBloqueio(AuditLog.deleteOne({ acao: 'ALTERACAO_NOTA' }));
    });

    it('recusa limpar a coleção inteira', async () => {
        // O caminho que um "faxina de logs antigos" bem-intencionado tomaria.
        // A retenção correta já existe e é feita pelo TTL do próprio mongod.
        await esperarBloqueio(AuditLog.deleteMany({}));
    });

    it('recusa editar o valor registrado', async () => {
        await esperarBloqueio(
            AuditLog.updateOne({ acao: 'ALTERACAO_NOTA' }, { $set: { 'detalhes.valorNovo': 10 } })
        );
        await esperarBloqueio(
            AuditLog.findOneAndUpdate({ acao: 'ALTERACAO_NOTA' }, { $set: { perfil: 'admin' } })
        );
        await esperarBloqueio(AuditLog.replaceOne({ acao: 'X' }, { acao: 'Y' }));
    });

    it('recusa `save()` sobre documento já existente — edição disfarçada de gravação', async () => {
        const doc = new AuditLog({ acao: 'ALTERACAO_NOTA', recurso: 'Notas' });
        doc.isNew = false; // é o estado de um documento vindo do banco
        doc.acao = 'CONSULTA';
        await esperarBloqueio(doc.save());
    });

    it('a mensagem do erro diz qual lei está em jogo', async () => {
        // Quem topar com isto num log de produção precisa entender em um
        // segundo que não é bug — é a regra.
        await expect(AuditLog.deleteMany({})).rejects.toThrow(/append-only.*Marco Civil/);
    });
});

describe('inserir continua permitido', () => {
    it('um log novo passa pela validação sem ser bloqueado', () => {
        const doc = new AuditLog({ acao: 'EXPORTAR_EDUCACENSO', recurso: 'Conformidade' });
        expect(doc.isNew).toBe(true);
        expect(doc.validateSync()).toBeUndefined();
    });
});
