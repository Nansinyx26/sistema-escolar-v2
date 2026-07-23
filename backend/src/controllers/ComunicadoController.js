const Comunicado = require('../models/Comunicado');
const Usuario = require('../models/Usuario');
const ImageProcessor = require('../utils/imageProcessor');
const logger = require('../utils/logger');
const escapeRegex = require('../utils/escapeRegex');
const { emitirParaEscola } = require('../utils/realtime');

/**
 * Restringe a consulta à escola ativa. Admin enxerga a rede toda.
 * Sem isso, getById/delete alcançavam comunicados de qualquer escola só
 * sabendo o _id — que vazava no broadcast global do Socket.IO.
 */
function escopoEscola(req, query) {
    if (!req.escolaId || req.user?.perfil === 'admin') return query;
    return { ...query, escolaId: String(req.escolaId) };
}

/**
 * true se o comunicado é endereçado ao usuário logado.
 * Replica a regra de destinatários do getAll — o getById não a aplicava,
 * então qualquer usuário lia comunicados internos sabendo o _id.
 */
async function podeVerComunicado(comunicado, user) {
    const perfil = String(user?.perfil || '').toLowerCase();
    if (['diretor', 'admin', 'secretaria'].includes(perfil)) return true;

    const destinatarios = Array.isArray(comunicado.destinatarios) ? comunicado.destinatarios : [];
    const alvos = ['todos', `usuario:${user.id || user._id}`];
    if (perfil === 'professor') alvos.push('professores');

    if (perfil === 'responsavel' && user.email) {
        alvos.push('responsaveis');
        const Aluno = require('../models/Aluno');
        const emailRegex = new RegExp(`^${escapeRegex(String(user.email))}$`, 'i');
        const alunos = await Aluno.find({
            $or: [
                { responsavel: emailRegex },
                { 'responsavelDados.email': emailRegex },
                { 'responsaveis.email': emailRegex }
            ]
        }).select('turma turmaId').lean();
        alunos.forEach(a => {
            const t = a.turma || a.turmaId;
            if (t) alvos.push(t, `turma:${t}`);
        });
    }

    return destinatarios.some(d => alvos.includes(d));
}

exports.create = async (req, res) => {
    try {
        const { titulo, conteudo, imagens, destinatarios, categoria, prioridade, arquivos, dataAgendada } = req.body;
        const diretorId = req.user.id || req.user._id;

        if (!titulo || !conteudo || !destinatarios || destinatarios.length === 0) {
            return res.status(400).json({ success: false, error: 'Título, conteúdo e destinatários são obrigatórios.' });
        }

        // Validar e limpar imagens base64 — máx 5 imagens, cada uma até 3MB em base64
        const MAX_IMAGES = 5;
        const MAX_IMAGE_B64_BYTES = 3 * 1024 * 1024; // 3MB por imagem
        let imagensValidadas = [];

        if (Array.isArray(imagens) && imagens.length > 0) {
            if (imagens.length > MAX_IMAGES) {
                return res.status(400).json({ success: false, error: `Máximo de ${MAX_IMAGES} imagens por comunicado.` });
            }
            for (const img of imagens) {
                if (typeof img !== 'string') continue;
                // Aceita URLs externas ou base64
                if (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('/')) {
                    imagensValidadas.push(img);
                } else if (img.startsWith('data:image/')) {
                    const base64Part = img.split(',')[1] || '';
                    if (base64Part.length > MAX_IMAGE_B64_BYTES) {
                        return res.status(400).json({ success: false, error: 'Uma das imagens é muito grande. Máximo permitido: 3MB por imagem.' });
                    }
                    // Garante WebP no backend (double-safety — frontend já converte)
                    try {
                        const webp = img.startsWith('data:image/webp')
                            ? img
                            : await ImageProcessor.convertToWebPBase64(img, 82);
                        imagensValidadas.push(webp);
                    } catch (_) {
                        // Se sharp falhar (formato inválido), mantém original
                        imagensValidadas.push(img);
                    }
                }
                // ignora outros formatos inválidos silenciosamente
            }
        }

        const diretor = await Usuario.findById(diretorId).lean();
        if (!diretor) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado.' });
        }

        const novoComunicado = new Comunicado({
            escolaId: req.escolaId || undefined,
            titulo,
            conteudo,
            imagens: imagensValidadas,
            diretorId,
            diretorNome: diretor.nome,
            diretorFoto: diretor.foto || diretor.fotoGoogle || '',
            diretorPerfil: diretor.perfil || 'Direção',
            destinatarios,
            categoria: categoria || 'Direção',
            prioridade: prioridade || 'Normal',
            arquivos: arquivos || [],
            dataAgendada: dataAgendada ? new Date(dataAgendada) : null
        });

        await novoComunicado.save();

        // Se NÃO for agendado para o futuro, notifica agora
        const agora = new Date();
        if (!dataAgendada || new Date(dataAgendada) <= agora) {
            const NotificationService = require('../services/NotificationService');
            await NotificationService.notify({
                tipo: 'informativo',
                categoria: (categoria || 'direcao').toLowerCase(),
                prioridade: prioridade === 'Urgente' ? 'alta' : 'media',
                titulo,
                mensagem: conteudo.replace(/<[^>]*>/g, '').substring(0, 150) + (conteudo.length > 150 ? '...' : ''),
                corpoHtml: conteudo,
                destinatarios,
                criadoPor: diretorId,
                link: '/dashboard',
                comunicadoId: novoComunicado._id,
                escolaId: req.escolaId || req.session?.escolaAtivaId || novoComunicado.escolaId || null
            });

            // Broadcast restrito à escola do comunicado — o emit global
            // entregava título, HTML e imagens a toda a rede.
            emitirParaEscola(
                novoComunicado.escolaId || req.escolaId,
                'comunicado:new',
                novoComunicado.toObject()
            );
        }

        res.status(201).json({ success: true, data: novoComunicado });
    } catch (error) {
        logger.error(`Error creating comunicado: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAll = async (req, res) => {
    try {
        const { categoria, busca } = req.query;
        const user = req.user;
        const userId = user.id || user._id;
        const perfil = user.perfil;

        // Filtro base: apenas ativos e (não agendados OU já passados da data).
        // A condição de agendamento vive num $and próprio — antes ela morava
        // em query.$or e a busca textual a SOBRESCREVIA, expondo comunicados
        // agendados para o futuro que ainda não deveriam ser visíveis.
        const agora = new Date();
        const condicoes = [
            { $or: [{ dataAgendada: null }, { dataAgendada: { $lte: agora } }] }
        ];
        let query = { ativo: true, $and: condicoes };

        // Multi-escola: isola por tenant quando o contexto está resolvido
        if (req.escolaId) query.escolaId = String(req.escolaId);

        // Filtro por categoria (se fornecido)
        if (categoria && categoria !== 'Todos') {
            query.categoria = String(categoria);
        }

        // Busca textual — regex ESCAPADA: `?busca=(x+x+)+y` travava o event loop
        if (busca) {
            const termo = escapeRegex(String(busca));
            condicoes.push({
                $or: [
                    { titulo: { $regex: termo, $options: 'i' } },
                    { conteudo: { $regex: termo, $options: 'i' } }
                ]
            });
        }

        if (perfil !== 'diretor' && perfil !== 'admin') {
            const targets = ['todos'];
            if (perfil === 'professor') targets.push('professores');
            
            if (perfil === 'responsavel') {
                targets.push('responsaveis');
                
                // Buscar turmas dos alunos vinculados a este responsável
                const email = user.email;
                if (email) {
                    const Aluno = require('../models/Aluno');
                    const emailRegex = new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
                    const alunos = await Aluno.find({
                        $or: [
                            { responsavel: emailRegex },
                            { 'responsavelDados.email': emailRegex },
                            { 'responsaveis.email': emailRegex }
                        ]
                    }).select('turma turmaId').lean();
                    
                    alunos.forEach(aluno => {
                        const tId = aluno.turma || aluno.turmaId;
                        if (tId) {
                            targets.push(tId);
                            targets.push(`turma:${tId}`);
                        }
                    });
                }
            }
            
            query.destinatarios = { 
                $in: [
                    ...targets,
                    `usuario:${userId}`
                ]
            };
        }

        const comunicados = await Comunicado.find(query)
            .sort({ dataCriacao: -1 })
            .lean();

        // População manual robusta para lidar com tipos mistos (ObjectId vs String)
        const diretorIds = [...new Set(comunicados.map(c => c.diretorId ? c.diretorId.toString() : null).filter(Boolean))];
        const diretores = await Usuario.find({ _id: { $in: diretorIds } }).select('nome foto fotoGoogle perfil').lean();
        
        const diretoresMap = {};
        diretores.forEach(d => {
            diretoresMap[d._id.toString()] = d;
        });

        const formatted = comunicados.map(c => {
            const dId = c.diretorId ? c.diretorId.toString() : null;
            const diretor = dId ? diretoresMap[dId] : null;
            
            return {
                ...c,
                diretorNome: diretor?.nome || c.diretorNome || "Direção",
                diretorFoto: diretor?.foto || diretor?.fotoGoogle || c.diretorFoto || "",
                diretorPerfil: diretor?.perfil || c.diretorPerfil || "Diretor"
            };
        });

        res.json({ success: true, data: formatted });
    } catch (error) {
        logger.error(`[ComunicadoController.getAll] Error: ${error.message}`, { stack: error.stack });
        res.status(500).json({ success: false, error: "Erro ao buscar comunicados." });
    }
};

exports.getById = async (req, res) => {
    try {
        // Escola + destinatários: as duas checagens que só existiam no getAll
        const comunicado = await Comunicado.findOne(
            escopoEscola(req, { _id: String(req.params.id), ativo: true })
        ).lean();

        if (!comunicado) {
            return res.status(404).json({ success: false, error: 'Comunicado não encontrado.' });
        }

        if (!(await podeVerComunicado(comunicado, req.user))) {
            return res.status(403).json({ success: false, error: 'Você não tem acesso a este comunicado.' });
        }

        // População manual para garantir o vínculo correto da foto
        const diretor = await Usuario.findById(comunicado.diretorId ? comunicado.diretorId.toString() : null).select('nome foto fotoGoogle perfil').lean();

        // Format consistent output
        const formatted = {
            ...comunicado,
            diretorNome: diretor?.nome || comunicado.diretorNome || "Direção",
            diretorFoto: diretor?.foto || diretor?.fotoGoogle || comunicado.diretorFoto || "",
            diretorPerfil: diretor?.perfil || comunicado.diretorPerfil || "Diretor"
        };

        res.json({ success: true, data: formatted });
    } catch (error) {
        logger.error(`[ComunicadoController.getById] Error: ${error.message}`, { id: req.params.id });
        res.status(500).json({ success: false, error: "Erro ao buscar comunicado." });
    }
};

exports.delete = async (req, res) => {
    try {
        // Multi-escola: um diretor da Escola A não remove comunicados da Escola B
        const comunicado = await Comunicado.findOneAndUpdate(
            escopoEscola(req, { _id: String(req.params.id) }),
            { ativo: false },
            { new: true }
        );
        if (!comunicado) {
            return res.status(404).json({ success: false, error: 'Comunicado não encontrado.' });
        }

        emitirParaEscola(comunicado.escolaId, 'comunicado:remove', { id: comunicado._id });

        const { logAction } = require('../utils/auditHelper');
        await logAction(req, 'DELETE_ANNOUNCEMENT', 'Comunicados', {
            recursoId: comunicado._id,
            descricao: `Comunicado "${comunicado.titulo}" removido.`
        });

        res.json({ success: true, message: 'Comunicado removido.' });
    } catch (error) {
        logger.error(`[ComunicadoController.delete] Error: ${error.message}`, { id: req.params.id });
        res.status(500).json({ success: false, error: "Erro ao remover comunicado." });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        if (!userId) return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });

        const comunicado = await Comunicado.findByIdAndUpdate(
            req.params.id,
            { $addToSet: { visualizacoes: userId } },
            { new: true }
        );
        
        if (!comunicado) {
            return res.status(404).json({ success: false, error: 'Comunicado não encontrado.' });
        }

        res.json({ success: true, data: comunicado });
    } catch (error) {
        logger.error(`[ComunicadoController.markAsRead] Error: ${error.message}`, { id: req.params.id, userId: req.user?.id });
        res.status(500).json({ success: false, error: "Erro ao marcar como lido." });
    }
};
