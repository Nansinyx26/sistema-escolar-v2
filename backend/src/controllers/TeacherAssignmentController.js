const AtribuicaoProfessor = require('../models/AtribuicaoProfessor');
const mongoose = require('mongoose');

class TeacherAssignmentController {
    // Listar todas as atribuições
    async index(req, res) {
        try {
            console.log('[GET] /api/atribuicoes - Buscando lista');

            // Mecanismo de auto-correção: garante que todo Professor ativo tenha um registro na coleção de atribuições
            const Professor = require('../models/Professor');
            const professoresAtivos = await Professor.find({ ativo: { $ne: false } }).lean();
            const atribuicoesExistentes = await AtribuicaoProfessor.find().lean();
            
            const nomesExistentes = new Set(atribuicoesExistentes.map(a => (a.nome || '').trim().toLowerCase()));

            for (const p of professoresAtivos) {
                if (p.nome && !nomesExistentes.has(p.nome.trim().toLowerCase())) {
                    console.log(`🔧 [AUTO-HEAL] Criando atribuição inicial para o professor: ${p.nome}`);
                    await AtribuicaoProfessor.create({
                        nome: p.nome.trim(),
                        classe: p.disciplina || 'Geral',
                        pontuacao: 0,
                        serieTurma: p.salaPrincipal || '',
                        ha: 4,
                        rp: 4,
                        estudoL: 3,
                        estudoEsc: 2,
                        cargaHoraria: '40h',
                        observacoes: ''
                    });
                }
            }

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
