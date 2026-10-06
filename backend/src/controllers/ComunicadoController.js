const Comunicado = require('../models/Comunicado');
const Usuario = require('../models/Usuario');
const ImageProcessor = require('../utils/imageProcessor');
const logger = require('../utils/logger');
const escapeRegex = require('../utils/escapeRegex');
const { emitirParaEscola } = require('../utils/realtime');
const { emitirComunicadoNovo } = require('../services/publicoDoComunicado');
const { extrairPaginacao } = require('../middleware/pagination');
const { alvosDoUsuario, alunosDoResponsavel } = require('../services/vinculoDoResponsavel');

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
    // O responsável só alcança `todos`/`responsaveis` com filho vinculado na
    // escola do comunicado (Issue #687).
    const alvos = await alvosDoUsuario(user, comunicado.escolaId);
    return destinatarios.some((d) => alvos.includes(String(d)));
}

// Reexportados para o ComentarioController: quem pode LER/COMENTAR um
// comunicado é exatamente quem pode vê-lo. Duplicar a regra lá significaria
// duas definições de visibilidade que divergem com o tempo.
exports.podeVerComunicado = podeVerComunicado;
exports.escopoEscola = escopoEscola;

exports.create = async (req, res) => {
    try {
        const {
            titulo,
            conteudo,
            imagens,
            destinatarios,
            categoria,
            prioridade,
            arquivos,
            dataAgendada,
        } = req.body;
        const diretorId = req.user.id || req.user._id;

        if (!titulo || !conteudo || !destinatarios || destinatarios.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Título, conteúdo e destinatários são obrigatórios.',
            });
        }

        // Validar e limpar imagens base64 — máx 5 imagens, cada uma até 3MB em base64
        const MAX_IMAGES = 5;
        const MAX_IMAGE_B64_BYTES = 3 * 1024 * 1024; // 3MB por imagem
        const imagensValidadas = [];

        if (Array.isArray(imagens) && imagens.length > 0) {
            if (imagens.length > MAX_IMAGES) {
                return res.status(400).json({
                    success: false,
                    error: `Máximo de ${MAX_IMAGES} imagens por comunicado.`,
                });
            }
            for (const img of imagens) {
                if (typeof img !== 'string') continue;
                // Aceita URLs externas ou base64
                if (
                    img.startsWith('http://') ||
                    img.startsWith('https://') ||
                    img.startsWith('/')
                ) {
                    imagensValidadas.push(img);
                } else if (img.startsWith('data:image/')) {
                    const base64Part = img.split(',')[1] || '';
                    if (base64Part.length > MAX_IMAGE_B64_BYTES) {
                        return res.status(400).json({
                            success: false,
                            error: 'Uma das imagens é muito grande. Máximo permitido: 3MB por imagem.',
                        });
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
            dataAgendada: dataAgendada ? new Date(dataAgendada) : null,
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
                mensagem:
                    conteudo.replace(/<[^>]*>/g, '').substring(0, 150) +
                    (conteudo.length > 150 ? '...' : ''),
                corpoHtml: conteudo,
                destinatarios,
                criadoPor: diretorId,
                comunicadoId: novoComunicado._id,
                escolaId:
                    req.escolaId || req.session?.escolaAtivaId || novoComunicado.escolaId || null,
            });

            // Só para o público do comunicado (Issue #663). A sala da escola
            // entregava o comunicado interno ou de turma a todos os conectados,
            // responsáveis inclusive.
            emitirComunicadoNovo(novoComunicado, req.escolaId);
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
        const condicoes = [{ $or: [{ dataAgendada: null }, { dataAgendada: { $lte: agora } }] }];
        const query = { ativo: true, $and: condicoes };

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
                    { conteudo: { $regex: termo, $options: 'i' } },
                ],
            });
        }

        if (perfil !== 'diretor' && perfil !== 'admin') {
            // Mesma regra do `podeVerComunicado` (Issue #687): o responsável
            // só alcança `todos`/`responsaveis` com filho vinculado na escola.
            const targets = await alvosDoUsuario(user, req.escolaId);
            if (perfil === 'responsavel' && !req.escolaId) {
                // Sem escola resolvida, só as escolas dos próprios filhos.
                const escolas = (await alunosDoResponsavel(user.email))
                    .map((a) => a.escolaId)
                    .filter(Boolean)
                    .map(String);
                query.escolaId = { $in: [...new Set(escolas)] };
            }
            query.destinatarios = { $in: [...targets, `usuario:${userId}`] };
        }

        const paginacao = extrairPaginacao(req.query);
        let comunicados;
        let totalDocs = 0;

        if (paginacao) {
            [comunicados, totalDocs] = await Promise.all([
                Comunicado.find(query)
                    .sort({ dataCriacao: -1 })
                    .skip(paginacao.skip)
                    .limit(paginacao.limit)
                    .lean(),
                Comunicado.countDocuments(query),
            ]);
        } else {
            comunicados = await Comunicado.find(query).sort({ dataCriacao: -1 }).lean();
        }

        // População manual robusta para lidar com tipos mistos (ObjectId vs String)
        const diretorIds = [
            ...new Set(
                comunicados
                    .map((c) => (c.diretorId ? c.diretorId.toString() : null))
                    .filter(Boolean)
            ),
        ];
        const diretores = await Usuario.find({ _id: { $in: diretorIds } })
            .select('nome foto fotoGoogle perfil')
            .lean();

        const diretoresMap = {};
        diretores.forEach((d) => {
            diretoresMap[d._id.toString()] = d;
        });

        const formatted = comunicados.map((c) => {
            const dId = c.diretorId ? c.diretorId.toString() : null;
            const diretor = dId ? diretoresMap[dId] : null;

            return {
                ...c,
                diretorNome: diretor?.nome || c.diretorNome || 'Direção',
                diretorFoto: diretor?.foto || diretor?.fotoGoogle || c.diretorFoto || '',
                diretorPerfil: diretor?.perfil || c.diretorPerfil || 'Diretor',
            };
        });

        if (paginacao) {
            return res.json(paginacao.formatarResposta(formatted, totalDocs));
        }

        res.json({ success: true, data: formatted });
    } catch (error) {
        logger.error(`[ComunicadoController.getAll] Error: ${error.message}`, {
            stack: error.stack,
        });
        res.status(500).json({ success: false, error: 'Erro ao buscar comunicados.' });
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
            return res
                .status(403)
                .json({ success: false, error: 'Você não tem acesso a este comunicado.' });
        }

        // População manual para garantir o vínculo correto da foto
        const diretor = await Usuario.findById(
            comunicado.diretorId ? comunicado.diretorId.toString() : null
        )
            .select('nome foto fotoGoogle perfil')
            .lean();

        // Format consistent output
        const formatted = {
            ...comunicado,
            diretorNome: diretor?.nome || comunicado.diretorNome || 'Direção',
            diretorFoto: diretor?.foto || diretor?.fotoGoogle || comunicado.diretorFoto || '',
            diretorPerfil: diretor?.perfil || comunicado.diretorPerfil || 'Diretor',
        };

        res.json({ success: true, data: formatted });
    } catch (error) {
        logger.error(`[ComunicadoController.getById] Error: ${error.message}`, {
            id: req.params.id,
        });
        res.status(500).json({ success: false, error: 'Erro ao buscar comunicado.' });
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
            descricao: `Comunicado "${comunicado.titulo}" removido.`,
        });

        res.json({ success: true, message: 'Comunicado removido.' });
    } catch (error) {
        logger.error(`[ComunicadoController.delete] Error: ${error.message}`, {
            id: req.params.id,
        });
        res.status(500).json({ success: false, error: 'Erro ao remover comunicado.' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        if (!userId)
            return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });

        // Mesmas checagens do getById (Issue #663): sem elas, esta rota
        // devolvia o comunicado inteiro de qualquer escola ou público a quem
        // soubesse o _id — e o `_id` chegava pelo evento de tempo real.
        const comunicado = await Comunicado.findOne(
            escopoEscola(req, { _id: String(req.params.id), ativo: true })
        )
            .select('_id escolaId destinatarios')
            .lean();
        if (!comunicado || !(await podeVerComunicado(comunicado, req.user))) {
            return res.status(404).json({ success: false, error: 'Comunicado não encontrado.' });
        }

        await Comunicado.updateOne(
            { _id: comunicado._id },
            { $addToSet: { visualizacoes: userId } }
        );

        // Marcar como lido não devolve o comunicado: quem precisa do conteúdo
        // usa o GET, que tem as mesmas checagens.
        res.json({ success: true });
    } catch (error) {
        logger.error(`[ComunicadoController.markAsRead] Error: ${error.message}`, {
            id: req.params.id,
            userId: req.user?.id,
        });
        res.status(500).json({ success: false, error: 'Erro ao marcar como lido.' });
    }
};
