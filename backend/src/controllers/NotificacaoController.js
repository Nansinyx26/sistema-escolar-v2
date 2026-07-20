const Notificacao = require('../models/Notificacao');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const { escolaMatch } = require('../middleware/filtrarPorEscola');

module.exports = {
    async getAll(req, res) {
        try {
            const userPerfil = req.user?.perfil || '';
            const userId = String(req.user?._id || req.user?.id || '');
            let filter = {};
            // Multi-escola: filtro tolerante (escola ativa + registros legados
            // sem escolaId/'default'), aplicado ao final sobre o filtro por perfil.
            const escolaFilter = escolaMatch(req.escolaId);

            // Filtrar notificações por perfil do usuário logado
            if (userPerfil === 'professor') {
                // Professor vê:
                // 1. Avisos liberados pela direção aos responsáveis (paraResponsavel: true)
                // 2. Avisos internos de funcionários (paraResponsavel != true) direcionados a 'todos', 'professores', ou suas turmas
                const professor = await Professor.findOne({ idUsuario: userId }).lean();
                let professorTurmas = [];
                if (professor) {
                    if (professor.salaPrincipal) professorTurmas.push(professor.salaPrincipal);
                    if (Array.isArray(professor.salasAdicionais)) professorTurmas.push(...professor.salasAdicionais);
                    if (Array.isArray(professor.turmas)) professorTurmas.push(...professor.turmas);
                }
                professorTurmas = [...new Set(professorTurmas.filter(Boolean))];

                filter = {
                    $or: [
                        { paraResponsavel: true },
                        {
                            paraResponsavel: { $ne: true },
                            destinatarios: { $in: ['todos', 'professores', ...professorTurmas] }
                        }
                    ]
                };
            } else if (userPerfil === 'diretor') {
                // Diretor gerencia tudo, mas vê por padrão avisos administrativos (todos, diretores) e avisos enviados aos pais
                filter = {
                    $or: [
                        { paraResponsavel: true },
                        {
                            paraResponsavel: { $ne: true },
                            destinatarios: { $in: ['todos', 'diretores'] }
                        }
                    ]
                };
            } else if (userPerfil === 'responsavel') {
                // Responsável/Pai NUNCA vê notificações internas de funcionários
                // Só vê notificações marcadas com paraResponsavel: true filtradas pelas informações vinculadas
                const email = req.user?.email;
                if (email) {
                    const query = { $or: [{ responsavel: email }, { responsavel: new RegExp(`^${email}$`, 'i') }] };
                    const alunos = await Aluno.find(query).lean();
                    const destinatariosList = ['todos'];
                    alunos.forEach(a => {
                        const turmaId = a.turma || a.turmaId;
                        if (turmaId) destinatariosList.push(turmaId);
                        destinatariosList.push(String(a._id));
                        if (a.id) destinatariosList.push(String(a.id));
                    });
                    
                    filter = {
                        paraResponsavel: true,
                        destinatarios: { $in: destinatariosList }
                    };
                } else {
                    filter = { paraResponsavel: true, destinatarios: 'todos' };
                }
            } else if (userPerfil === 'admin') {
                // Admin vê tudo sem filtros
                filter = {};
            }

            const temEscolaFilter = escolaFilter && Object.keys(escolaFilter).length > 0;
            const filtroFinal = temEscolaFilter ? { $and: [filter, escolaFilter] } : filter;
            const notificacoes = await Notificacao.find(filtroFinal).sort({ dataCriacao: -1 }).lean();
            
            // Adiciona campo lidoPorMim para que o frontend saiba quais já foram lidas pelo usuário atual
            const formatted = notificacoes.map(n => ({
                ...n,
                id: n.id || String(n._id),
                lidoPorMim: Array.isArray(n.lido) && userId ? n.lido.includes(userId) : false
            }));

            res.json({ success: true, data: formatted });
        } catch (error) {
            console.error('Erro em NotificacaoController.getAll:', error);
            res.status(500).json({ success: false, error: 'Erro ao buscar notificações', details: error.message });
        }
    },

    async create(req, res) {
        try {
            const userPerfil = req.user?.perfil || '';
            const data = req.body;
            
            // Regra 6: Professores NÃO podem enviar notificações diretamente para responsáveis.
            if (data.paraResponsavel === true && userPerfil !== 'diretor' && userPerfil !== 'admin') {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Acesso negado. Apenas diretores e administradores podem enviar avisos aos responsáveis/pais.' 
                });
            }
            
            // Ensure ID exists
            if (!data.id) {
                data.id = 'notif_' + Date.now();
            }

            // Atribui o nome do remetente (diretor/admin que enviou)
            data.criadoPor = req.user?.nome || req.user?.email || 'Direção';

            // Multi-escola: nova notificação pertence à escola ativa da sessão
            if (req.escolaId) data.escolaId = req.escolaId;

            const notificacao = await Notificacao.create(data);
            res.status(201).json({ success: true, data: notificacao });
        } catch (error) {
            console.error('Erro em NotificacaoController.create:', error);
            res.status(400).json({ success: false, error: 'Erro ao criar notificação', details: error.message });
        }
    },

    async delete(req, res) {
        try {
            const { id } = req.params;
            const deleted = await Notificacao.findOneAndDelete({ $or: [{ _id: id }, { id: id }] });
            
            if (!deleted) {
                return res.status(404).json({ success: false, error: 'Notificação não encontrada' });
            }
            res.json({ success: true, message: 'Notificação removida com sucesso' });
        } catch (error) {
            console.error('Erro em NotificacaoController.delete:', error);
            res.status(500).json({ success: false, error: 'Erro ao deletar notificação', details: error.message });
        }
    },

    async marcarComoLida(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user?._id || req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Não autenticado' });
            }
            const notificacao = await Notificacao.findOne({ $or: [{ _id: id }, { id: id }] });
            if (!notificacao) {
                return res.status(404).json({ success: false, error: 'Notificação não encontrada.' });
            }
            if (!notificacao.lido) {
                notificacao.lido = [];
            }
            if (!notificacao.lido.includes(String(userId))) {
                notificacao.lido.push(String(userId));
                await notificacao.save();
            }
            res.json({ success: true, message: 'Notificação marcada como lida.' });
        } catch (error) {
            console.error('Erro em NotificacaoController.marcarComoLida:', error);
            res.status(500).json({ success: false, error: 'Erro ao marcar como lida' });
        }
    },

    async marcarTodasComoLidas(req, res) {
        try {
            const userId = req.user?._id || req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Não autenticado' });
            }
            const userPerfil = req.user?.perfil || '';
            let filter = {};

            if (userPerfil === 'professor') {
                const professor = await Professor.findOne({ idUsuario: userId }).lean();
                let professorTurmas = [];
                if (professor) {
                    if (professor.salaPrincipal) professorTurmas.push(professor.salaPrincipal);
                    if (Array.isArray(professor.salasAdicionais)) professorTurmas.push(...professor.salasAdicionais);
                    if (Array.isArray(professor.turmas)) professorTurmas.push(...professor.turmas);
                }
                professorTurmas = [...new Set(professorTurmas.filter(Boolean))];
                filter = {
                    $or: [
                        { paraResponsavel: true },
                        {
                            paraResponsavel: { $ne: true },
                            destinatarios: { $in: ['todos', 'professores', ...professorTurmas] }
                        }
                    ]
                };
            } else if (userPerfil === 'diretor') {
                filter = {
                    $or: [
                        { paraResponsavel: true },
                        {
                            paraResponsavel: { $ne: true },
                            destinatarios: { $in: ['todos', 'diretores'] }
                        }
                    ]
                };
            } else if (userPerfil === 'responsavel') {
                const email = req.user?.email;
                const query = { $or: [{ responsavel: email }, { responsavel: new RegExp(`^${email}$`, 'i') }] };
                const alunos = await Aluno.find(query).lean();
                const destinatariosList = ['todos'];
                alunos.forEach(a => {
                    const turmaId = a.turma || a.turmaId;
                    if (turmaId) destinatariosList.push(turmaId);
                    destinatariosList.push(String(a._id));
                    if (a.id) destinatariosList.push(String(a.id));
                });
                filter = {
                    paraResponsavel: true,
                    destinatarios: { $in: destinatariosList }
                };
            } else if (userPerfil === 'admin') {
                filter = {};
            }

            // Add userId to lido of all notifications matching filter that don't already have it
            const escolaFilter = escolaMatch(req.escolaId);
            const baseFilter = (escolaFilter && Object.keys(escolaFilter).length > 0)
                ? { $and: [filter, escolaFilter] }
                : filter;
            await Notificacao.updateMany(
                { ...baseFilter, lido: { $ne: String(userId) } },
                { $push: { lido: String(userId) } }
            );
            res.json({ success: true, message: 'Todas as notificações marcadas como lidas.' });
        } catch (error) {
            console.error('Erro em NotificacaoController.marcarTodasComoLidas:', error);
            res.status(500).json({ success: false, error: 'Erro ao marcar todas como lidas' });
        }
    }
};
