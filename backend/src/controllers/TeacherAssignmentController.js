const AtribuicaoProfessor = require('../models/AtribuicaoProfessor');
const mongoose = require('mongoose');

class TeacherAssignmentController {
    // Listar todas as atribuições
    async index(req, res) {
        try {
            console.log('[GET] /api/atribuicoes - Buscando lista');
            const atribuicoes = await AtribuicaoProfessor.find().sort({ nome: 1 });
            return res.status(200).json({ success: true, data: atribuicoes });
        } catch (error) {
            console.error('❌ Erro ao listar atribuições:', error);
            return res.status(500).json({ success: false, error: 'Erro ao buscar atribuições' });
        }
    }

    async sync(req, res) {
        try {
            console.log('--- 📥 INÍCIO DA REQUISIÇÍO DE SINCRONIZAÇÍO ---');
            const { atribuicoes } = req.body;

            if (!atribuicoes || !Array.isArray(atribuicoes)) {
                console.log('🔴 Erro: atribuicoes não é um array');
                return res.status(400).json({ success: false, error: 'Formato de dados inválido' });
            }

            console.log(`Recebidos ${atribuicoes.length} itens para processar.`);

            // Filtrar IDs válidos para a query de delete
            const idsValidos = atribuicoes
                .map(a => a._id || a.id)
                .filter(id => id && mongoose.Types.ObjectId.isValid(id));

            console.log('IDs válidos para manter:', idsValidos);

            // Deletar quem não está na lista (sincronização total)
            // Somente deletamos se a lista enviada for válida
            const deleteResult = await AtribuicaoProfessor.deleteMany({
                _id: { $nin: idsValidos.map(id => new mongoose.Types.ObjectId(id)) }
            });
            console.log(`🗑️ Itens removidos do banco: ${deleteResult.deletedCount}`);

            // Processar cada item (Update ou Create)
            for (const item of atribuicoes) {
                const id = item._id || item.id;
                const dados = { ...item };
                delete dados._id;
                delete dados.id;

                if (id && mongoose.Types.ObjectId.isValid(id)) {
                    // Update
                    await AtribuicaoProfessor.findByIdAndUpdate(id, dados, {
                        new: true,
                        runValidators: true
                    });
                } else {
                    // Create
                    await AtribuicaoProfessor.create(dados);
                }
            }

            const listaFinal = await AtribuicaoProfessor.find().sort({ nome: 1 });
            console.log(`✅ Sincronização finalizada com sucesso. Total: ${listaFinal.length}`);

            return res.status(200).json({ success: true, data: listaFinal });
        } catch (error) {
            console.error('❌ ERRO CRÍTICO NO SYNC:', error);
            // Garante que SEMPRE retorna JSON mesmo em erro
            return res.status(500).json({
                success: false,
                error: 'Erro interno no servidor de atribuições',
                message: error.message
            });
        }
    }

    // Deletar uma atribuição específica
    async delete(req, res) {
        try {
            const { id } = req.params;
            console.log(`[DELETE] /api/atribuicoes/${id}`);
            if (!mongoose.Types.ObjectId.isValid(id)) {
                return res.status(400).json({ success: false, error: 'ID inválido' });
            }
            await AtribuicaoProfessor.findByIdAndDelete(id);
            return res.status(200).json({ success: true, message: 'Atribuição removida com sucesso' });
        } catch (error) {
            console.error('❌ Erro ao deletar:', error);
            return res.status(500).json({ success: false, error: 'Erro ao deletar atribuição' });
        }
    }
}

module.exports = new TeacherAssignmentController();
