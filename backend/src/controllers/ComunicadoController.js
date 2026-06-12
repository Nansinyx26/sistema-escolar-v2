const Comunicado = require('../models/Comunicado');
const Usuario = require('../models/Usuario');
const ImageProcessor = require('../utils/imageProcessor');
const logger = require('../utils/logger');

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
            titulo,
            conteudo,
            imagens: imagensValidadas,
            diretorId,
            diretorNome: diretor.nome,
            diretorFoto: diretor.foto || diretor.fotoGoogle || '',
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
                comunicadoId: novoComunicado._id
            });

            if (global.io) {
                global.io.emit('comunicado:new', novoComunicado.toObject());
            }
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

        // Filtro base: apenas ativos e (não agendados OU já passados da data)
        const agora = new Date();
        let query = { 
            ativo: true,
            $or: [
                { dataAgendada: null },
                { dataAgendada: { $lte: agora } }
            ]
        };

        // Filtro por categoria (se fornecido)
        if (categoria && categoria !== 'Todos') {
            query.categoria = categoria;
        }

        // Busca textual
        if (busca) {
            query.$or = [
                { titulo: { $regex: busca, $options: 'i' } },
                { conteudo: { $regex: busca, $options: 'i' } }
            ];
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

        res.json({ success: true, data: comunicados });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getById = async (req, res) => {
    try {
        const comunicado = await Comunicado.findById(req.params.id).lean();
        if (!comunicado) {
            return res.status(404).json({ success: false, error: 'Comunicado não encontrado.' });
        }
        res.json({ success: true, data: comunicado });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const comunicado = await Comunicado.findByIdAndUpdate(req.params.id, { ativo: false }, { new: true });
        if (!comunicado) {
            return res.status(404).json({ success: false, error: 'Comunicado não encontrado.' });
        }
        
        if (global.io) {
            global.io.emit('comunicado:remove', { id: comunicado._id });
        }
        
        res.json({ success: true, message: 'Comunicado removido.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const comunicado = await Comunicado.findByIdAndUpdate(
            req.params.id,
            { $addToSet: { visualizacoes: userId } },
            { new: true }
        );
        
        res.json({ success: true, data: comunicado });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
