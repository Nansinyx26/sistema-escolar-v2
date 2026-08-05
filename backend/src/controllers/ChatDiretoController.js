const mongoose = require('mongoose');
const crypto = require('crypto');
const ChatDireto = require('../models/ChatDireto');
const Usuario = require('../models/Usuario');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const { EXT_POR_MIME } = require('../middleware/uploadChat');

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

/** Página de histórico: 30 mensagens por vez alimentam o lazy loading. */
const PAGINA_HISTORICO = 30;

/**
 * Valida um anexo/áudio informado pelo cliente contra o que existe no GridFS.
 *
 * O corpo da requisição chegava direto no banco: bastava mandar
 * `anexo: { url: 'javascript:…' }` ou `{ url: 'https://phishing…' }` para o
 * outro lado receber um cartão de download clicável apontando para lá — e um
 * `gridfsId` alheio referenciava arquivo de outra conversa. Aqui só passa
 * arquivo que ESTE remetente subiu pela rota do chat, e a URL é reconstruída
 * pelo servidor (o que o cliente mandou é descartado).
 */
async function validarAnexo(bruto, remetenteId) {
    if (!bruto || typeof bruto !== 'object') return null;

    const gridfsId = String(bruto.gridfsId || '');
    if (!mongoose.Types.ObjectId.isValid(gridfsId)) {
        throw new Error('Anexo inválido.');
    }

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const docs = await bucket.find({ _id: new mongoose.Types.ObjectId(gridfsId) }).limit(1).toArray();
    const arquivo = docs[0];

    const meta = arquivo && arquivo.metadata ? arquivo.metadata : {};
    if (!arquivo || meta.type !== 'chat_anexo' || String(meta.usuarioId) !== String(remetenteId)) {
        throw new Error('Anexo não encontrado ou não pertence a você.');
    }

    // Nome/tipo/tamanho saem do arquivo real, não do que o cliente afirmou.
    return {
        gridfsId,
        url: `/api/chat-direto/anexo/${gridfsId}`,
        nome: String(meta.nomeOriginal || arquivo.filename || 'arquivo').slice(0, 255),
        tipo: arquivo.contentType || 'application/octet-stream',
        tamanho: arquivo.length || 0
    };
}

/**
 * Acrescenta um usuário à lista de quem pode baixar um anexo já existente.
 * Usado no encaminhamento: o arquivo continua sendo o mesmo no GridFS, mas
 * passa a valer também para o novo destinatário.
 */
async function liberarAnexoPara(anexo, novoUsuarioId) {
    const gridfsId = anexo && anexo.gridfsId ? String(anexo.gridfsId) : '';
    if (!mongoose.Types.ObjectId.isValid(gridfsId)) return;

    await mongoose.connection.db.collection('uploads.files').updateOne(
        { _id: new mongoose.Types.ObjectId(gridfsId), 'metadata.type': 'chat_anexo' },
        { $addToSet: { 'metadata.compartilhadoCom': String(novoUsuarioId) } }
    );
}

/** Mesma validação para áudio, preservando só a duração informada. */
async function validarAudio(bruto, remetenteId) {
    const validado = await validarAnexo(bruto, remetenteId);
    if (!validado) return null;
    const duracao = Number(bruto.duracao);
    return {
        url: validado.url,
        gridfsId: validado.gridfsId,
        duracao: Number.isFinite(duracao) && duracao >= 0 ? Math.min(duracao, 60 * 60) : 0
    };
}

/**
 * MATRIZ DE PERMISSÃO DE CONVERSA — lista branca explícita.
 *
 * Antes a regra era por exclusão: negava alguns pares e liberava o resto por
 * omissão. Um perfil novo no enum de Usuario passaria a conversar com todo
 * mundo sem ninguém decidir isso. Aqui vale o inverso — par que não estiver
 * declarado abaixo é negado.
 *
 * A matriz é SIMÉTRICA: declarar A→B já autoriza B→A (ver `paresPermitidos`).
 *
 *   professor   ↔ professor, diretor, secretaria, responsavel
 *   diretor     ↔ diretor, secretaria, responsavel
 *   secretaria  ↔ secretaria, responsavel
 *   responsavel ↔ (apenas equipe escolar — nunca outro responsável)
 *
 * `admin` é tratado à parte: conversa com qualquer perfil e atravessa escolas,
 * porque é o papel de suporte da rede.
 */
const MATRIZ_CONVERSA = {
    professor: ['professor', 'diretor', 'secretaria', 'responsavel'],
    diretor: ['diretor', 'secretaria', 'responsavel', 'professor'],
    secretaria: ['secretaria', 'responsavel', 'professor', 'diretor'],
    // Responsável não inicia nem recebe conversa de outro responsável: a escola
    // é sempre a intermediária entre duas famílias.
    responsavel: ['professor', 'diretor', 'secretaria']
};

/** true se o par de perfis está na matriz, em qualquer direção. */
function paresPermitidos(perfilA, perfilB) {
    if (perfilA === 'admin' || perfilB === 'admin') return true;
    const deA = MATRIZ_CONVERSA[perfilA];
    const deB = MATRIZ_CONVERSA[perfilB];
    if (!deA || !deB) return false; // perfil desconhecido nunca conversa
    return deA.includes(perfilB) && deB.includes(perfilA);
}

/**
 * Verifica se dois usuários podem trocar mensagens diretas.
 *
 * Antes, `enviarMensagem` aceitava qualquer destinatarioId — sem validar
 * vínculo, perfil ou escola —, então qualquer conta autenticada mandava
 * mensagem para qualquer outra da rede inteira.
 *
 * Duas barreiras, nesta ordem: mesma escola (multi-tenant) e par de perfis
 * presente na MATRIZ_CONVERSA.
 */
async function podeConversar(remetente, destinatarioId) {
    const destinatario = await Usuario.findById(String(destinatarioId))
        .select('perfil escolaId ativo')
        .lean();

    if (!destinatario || destinatario.ativo === false) {
        return { ok: false, status: 404, error: 'Destinatário não encontrado.' };
    }

    const perfilRemetente = String(remetente.perfil || '').toLowerCase();
    const perfilDestino = String(destinatario.perfil || '').toLowerCase();

    if (perfilRemetente !== 'admin') {
        const escolaRemetente = remetente.escolaId ? String(remetente.escolaId) : null;
        const escolaDestino = destinatario.escolaId ? String(destinatario.escolaId) : null;
        if (escolaRemetente && escolaDestino && escolaRemetente !== escolaDestino) {
            return { ok: false, status: 403, error: 'Este usuário pertence a outra escola.' };
        }
    }

    if (!paresPermitidos(perfilRemetente, perfilDestino)) {
        // Mensagem específica para o caso de longe mais comum, genérica para o resto.
        const erro = (perfilRemetente === 'responsavel' && perfilDestino === 'responsavel')
            ? 'Responsáveis não conversam entre si. Fale com a equipe escolar.'
            : 'Este tipo de conversa não é permitido.';
        return { ok: false, status: 403, error: erro };
    }

    return { ok: true, destinatario };
}

// Janelas de tempo para mexer numa mensagem já entregue. Ambas contam a partir
// de `createdAt` e são verificadas NO SERVIDOR — esconder o botão no cliente
// não impede um POST direto.
const JANELA_EDICAO_MS = 15 * 60 * 1000;        // 15 minutos
const JANELA_APAGAR_TODOS_MS = 60 * 60 * 1000;  // 1 hora

/** true se `criadaEm` já passou do prazo. Data ausente conta como fora. */
function foraDaJanela(criadaEm, janelaMs) {
    if (!criadaEm) return true;
    const t = new Date(criadaEm).getTime();
    if (!Number.isFinite(t)) return true;
    return Date.now() - t > janelaMs;
}

/** Prévia curta do que chegou — texto, ou o tipo do anexo quando não há texto. */
function previaDaMensagem({ mensagem, anexo, audio }) {
    const texto = String(mensagem || '').replace(/\s+/g, ' ').trim();
    if (texto) return texto.length > 120 ? `${texto.slice(0, 120).trimEnd()}…` : texto;
    if (audio) return '🎤 Mensagem de voz';
    if (anexo) return anexo.nome ? `📎 ${anexo.nome}` : '📎 Anexo';
    return 'Nova mensagem';
}

/**
 * Dispara o push do chat para a barra de notificações do celular.
 *
 * Vai SEMPRE, mesmo com o destinatário conectado por Socket.IO: estar com uma
 * aba aberta no computador não significa que a pessoa está olhando para ela, e
 * o celular no bolso é justamente o canal que faltava. O `tag` por remetente
 * faz o Service Worker substituir a notificação anterior em vez de empilhar
 * uma por mensagem numa rajada.
 *
 * Nunca lança: é chamada sem await e uma falha aqui não pode afetar o envio.
 */
function notificarNoCelular({ destinatarioId, remetenteId, remetenteNome, mensagem, anexo, audio }) {
    NotificationService.pushParaUsuario(destinatarioId, {
        title: remetenteNome,
        body: previaDaMensagem({ mensagem, anexo, audio }),
        // Abre direto na conversa de quem mandou (ver abrirConversaDaUrl em
        // js/chat-direto-manager.js), não num dashboard genérico.
        url: `/html/dashboard.html?chat=${encodeURIComponent(remetenteId)}`,
        tag: `chat-${remetenteId}`
    }).catch((err) => {
        logger.warn(`[ChatDireto] Push não entregue a ${destinatarioId}: ${err.message}`);
    });
}

exports.enviarMensagem = async (req, res) => {
    try {
        const { destinatarioId, mensagem, anexo, audio, respostaParaId, turmaId, alunoId, contexto } = req.body;
        const remetenteId = String(req.user.id || req.user._id || '');

        if (!destinatarioId || (!mensagem && !anexo && !audio)) {
            return res.status(400).json({ success: false, error: 'Destinatário e conteúdo (mensagem, anexo ou áudio) são obrigatórios.' });
        }

        const permissao = await podeConversar(
            { ...req.user, escolaId: req.escolaId },
            destinatarioId
        );
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        // Anexo e áudio são reconstruídos a partir do arquivo real no GridFS —
        // nada do que o cliente afirmou sobre url/nome/tamanho é aproveitado.
        let anexoValidado;
        let audioValidado;
        try {
            anexoValidado = await validarAnexo(anexo, remetenteId);
            audioValidado = await validarAudio(audio, remetenteId);
        } catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }

        const novaMensagem = await ChatDireto.create({
            remetenteId,
            destinatarioId: String(destinatarioId),
            turmaId,
            alunoId,
            contexto,
            mensagem: mensagem || '',
            anexo: anexoValidado || undefined,
            audio: audioValidado || undefined,
            respostaParaId: respostaParaId || undefined,
            escolaId: req.escolaId ? String(req.escolaId) : undefined
        });

        // Emite via Socket.IO para o destinatário e para as outras abas do
        // remetente. O nome vai junto (campo transitório, fora do banco) para
        // a notificação poder dizer QUEM mandou sem uma consulta extra.
        if (global.io) {
            const evento = { ...novaMensagem.toObject(), remetenteNome: req.user.nome || '' };
            global.io.to(`user:${destinatarioId}`).emit('chat:mensagem', evento);
            global.io.to(`user:${remetenteId}`).emit('chat:mensagem', evento);
        }

        // Notificação no celular. Sem await: a resposta do envio não espera o
        // serviço de push externo, que pode levar segundos ou estar fora do ar.
        notificarNoCelular({
            destinatarioId,
            remetenteId,
            remetenteNome: req.user.nome || 'Nova mensagem',
            mensagem: novaMensagem.mensagem,
            anexo: anexoValidado,
            audio: audioValidado
        });

        res.json({ success: true, data: novaMensagem });
    } catch (error) {
        logger.error(`[ChatDireto] Erro: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao enviar mensagem.' });
    }
};

exports.getHistorico = async (req, res) => {
    try {
        const { outroUsuarioId } = req.params;
        const { before, search, filter, data } = req.query;
        const meuId = String(req.user.id || req.user._id || '');

        // `$and` em vez de sobrescrever `$or`: antes o filtro de busca
        // substituía a cláusula da conversa e o `$or` original se perdia — com
        // `$and` o par de participantes é sempre respeitado.
        const condicoes = [{
            $or: [
                { remetenteId: meuId, destinatarioId: String(outroUsuarioId) },
                { remetenteId: String(outroUsuarioId), destinatarioId: meuId }
            ]
        }];

        // Moderação: o que não foi aprovado não chega ao DESTINATÁRIO por aqui.
        // Sem esta cláusula todo o resto da moderação é decorativo — bastava
        // recarregar a conversa para receber o que o envio bloqueou.
        //
        // O REMETENTE continua vendo as próprias mensagens retidas, com o
        // estado em `moderacao.status`, porque é assim que ele descobre que algo
        // ficou em análise e é dali que sai o botão de contestar (cláusula 9 do
        // Termo de Uso). Esconder dele também transformaria bloqueio em sumiço
        // silencioso.
        //
        // O `$exists: false` não é redundante: o default 'aprovada' do schema só
        // vale para documento gravado DEPOIS desta mudança. As conversas que já
        // estão no banco não têm o campo, e sem este ramo o histórico inteiro
        // anterior à moderação desapareceria para o destinatário.
        condicoes.push({
            $or: [
                { 'moderacao.status': 'aprovada' },
                { 'moderacao.status': { $exists: false } },
                { remetenteId: meuId }
            ]
        });

        const query = { $and: condicoes, apagadaPara: { $ne: meuId } };

        // Paginação para trás (lazy loading do histórico)
        const createdAt = {};
        if (before) {
            const dt = new Date(before);
            if (!isNaN(dt.getTime())) createdAt.$lt = dt;
        }

        // Busca por data: recorta o dia inteiro no fuso local do servidor
        if (data) {
            const dia = new Date(`${String(data).slice(0, 10)}T00:00:00`);
            if (!isNaN(dia.getTime())) {
                const fim = new Date(dia);
                fim.setDate(fim.getDate() + 1);
                createdAt.$gte = dia;
                if (!createdAt.$lt || fim < createdAt.$lt) createdAt.$lt = fim;
            }
        }
        if (Object.keys(createdAt).length > 0) query.createdAt = createdAt;

        if (search && String(search).trim()) {
            const termo = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(termo, 'i');
            condicoes.push({ $or: [{ mensagem: regex }, { 'anexo.nome': regex }] });
        }

        if (filter === 'anexos') {
            query['anexo.url'] = { $exists: true, $ne: null };
        } else if (filter === 'audios') {
            query['audio.url'] = { $exists: true, $ne: null };
        } else if (filter === 'imagens') {
            query['anexo.tipo'] = { $regex: '^image/' };
        }

        const limit = Math.min(Number(req.query.limit) || PAGINA_HISTORICO, 100);

        // Pede um a mais para saber se ainda há página anterior sem um count()
        const encontradas = await ChatDireto.find(query)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .lean();

        const hasMore = encontradas.length > limit;
        const mensagens = hasMore ? encontradas.slice(0, limit) : encontradas;

        // Reverte para ordem cronológica crescente
        mensagens.reverse();

        res.json({
            success: true,
            data: mensagens,
            hasMore,
            cursor: mensagens.length > 0 ? mensagens[0].createdAt : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Marca em lote todas as mensagens recebidas de um contato como lidas.
 * O cliente fazia um PATCH por mensagem — abrir uma conversa com 30 não lidas
 * disparava 30 requisições; aqui é uma só.
 */
exports.marcarConversaComoLida = async (req, res) => {
    try {
        const { outroUsuarioId } = req.params;
        const meuId = String(req.user.id || req.user._id || '');

        const filtro = {
            remetenteId: String(outroUsuarioId),
            destinatarioId: meuId,
            lida: { $ne: true }
        };

        const ids = await ChatDireto.find(filtro).select('_id').lean();
        if (ids.length === 0) {
            return res.json({ success: true, data: { atualizadas: 0, ids: [] } });
        }

        await ChatDireto.updateMany(filtro, { lida: true, status: 'lida' });

        const listaIds = ids.map((m) => String(m._id));
        if (global.io) {
            global.io.to(`user:${outroUsuarioId}`).emit('chat:lidas', {
                mensagemIds: listaIds,
                destinatarioId: meuId
            });
        }

        res.json({ success: true, data: { atualizadas: listaIds.length, ids: listaIds } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.marcarComoLida = async (req, res) => {
    try {
        const { mensagemId } = req.params;
        const meuId = String(req.user.id || req.user._id || '');

        const atualizada = await ChatDireto.findOneAndUpdate(
            { _id: String(mensagemId), destinatarioId: meuId },
            { lida: true, status: 'lida' },
            { new: true }
        );

        if (!atualizada) {
            return res.status(404).json({ success: false, error: 'Mensagem não encontrada.' });
        }

        if (global.io) {
            global.io.to(`user:${atualizada.remetenteId}`).emit('chat:lida', {
                mensagemId: atualizada._id,
                destinatarioId: meuId
            });
        }

        res.json({ success: true, data: atualizada });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.editarMensagem = async (req, res) => {
    try {
        const { mensagemId } = req.params;
        const { novaMensagem } = req.body;
        const meuId = String(req.user.id || req.user._id || '');

        if (!novaMensagem || !novaMensagem.trim()) {
            return res.status(400).json({ success: false, error: 'O novo conteúdo da mensagem é obrigatório.' });
        }

        // Janela de edição: passado o prazo, a mensagem é registro da conversa.
        // Sem isso, o autor reescrevia uma mensagem de meses atrás e o outro
        // lado via o texto novo como se sempre tivesse sido aquele.
        const original = await ChatDireto.findOne({
            _id: String(mensagemId), remetenteId: meuId, apagadaParaTodos: { $ne: true }
        }).select('createdAt mensagem').lean();
        const textoAnterior = original ? original.mensagem : '';

        if (!original) {
            return res.status(404).json({ success: false, error: 'Mensagem não encontrada ou sem permissão para editar.' });
        }
        if (foraDaJanela(original.createdAt, JANELA_EDICAO_MS)) {
            return res.status(403).json({
                success: false,
                error: `Mensagens só podem ser editadas nos primeiros ${JANELA_EDICAO_MS / 60000} minutos.`
            });
        }

        const atualizada = await ChatDireto.findOneAndUpdate(
            { _id: String(mensagemId), remetenteId: meuId, apagadaParaTodos: { $ne: true } },
            { mensagem: novaMensagem.trim(), editada: true, editadaEm: new Date() },
            { new: true }
        );

        if (!atualizada) {
            return res.status(404).json({ success: false, error: 'Mensagem não encontrada ou sem permissão para editar.' });
        }

        // Edição altera um registro que a outra pessoa já leu — fica na trilha.
        const { logAction } = require('../utils/auditHelper');
        await logAction(req, 'CHAT_EDIT_MESSAGE', 'ChatDireto', {
            recursoId: String(atualizada._id),
            escolaId: atualizada.escolaId,
            valorAnterior: textoAnterior,
            valorNovo: atualizada.mensagem,
            descricao: `Mensagem editada na conversa com ${atualizada.destinatarioId}.`
        });

        if (global.io) {
            global.io.to(`user:${atualizada.destinatarioId}`).emit('chat:editada', atualizada);
            global.io.to(`user:${meuId}`).emit('chat:editada', atualizada);
        }

        res.json({ success: true, data: atualizada });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.apagarMensagem = async (req, res) => {
    try {
        const { mensagemId } = req.params;
        const { tipo } = req.query; // 'para_mim' ou 'para_todos'
        const meuId = String(req.user.id || req.user._id || '');

        const msg = await ChatDireto.findById(String(mensagemId));
        if (!msg) {
            return res.status(404).json({ success: false, error: 'Mensagem não encontrada.' });
        }

        // Mesma regra da reação: só quem está na conversa mexe nela. Sem isso,
        // "apagar para mim" aceitava qualquer id e ia empilhando estranhos no
        // array `apagadaPara` de mensagens alheias.
        if (String(msg.remetenteId) !== meuId && String(msg.destinatarioId) !== meuId) {
            return res.status(403).json({ success: false, error: 'Você não participa desta conversa.' });
        }

        if (tipo === 'para_todos') {
            if (String(msg.remetenteId) !== meuId) {
                return res.status(403).json({ success: false, error: 'Apenas o autor pode apagar a mensagem para todos.' });
            }
            // "Apagar para todos" reescreve o que a outra pessoa já leu, então
            // vale só logo após o envio. Passada a janela, resta "apagar para
            // mim", que não altera o lado do destinatário.
            if (foraDaJanela(msg.createdAt, JANELA_APAGAR_TODOS_MS)) {
                return res.status(403).json({
                    success: false,
                    error: `Só é possível apagar para todos na primeira hora. Você ainda pode apagar apenas para você.`
                });
            }
            // Auditoria ANTES de sobrescrever: registrar depois guardaria o
            // placeholder, não o que foi de fato removido da vista do outro.
            const { logAction } = require('../utils/auditHelper');
            await logAction(req, 'CHAT_DELETE_FOR_ALL', 'ChatDireto', {
                recursoId: String(msg._id),
                escolaId: msg.escolaId,
                valorAnterior: previaDaMensagem({
                    mensagem: msg.mensagem, anexo: msg.anexo, audio: msg.audio
                }),
                descricao: `Mensagem apagada para todos na conversa com ${msg.destinatarioId}.`
            });

            msg.mensagem = 'Esta mensagem foi apagada.';
            msg.anexo = undefined;
            msg.audio = undefined;
            msg.apagadaParaTodos = true;
            await msg.save();

            if (global.io) {
                global.io.to(`user:${msg.destinatarioId}`).emit('chat:apagada', { mensagemId: msg._id, paraTodos: true });
                global.io.to(`user:${meuId}`).emit('chat:apagada', { mensagemId: msg._id, paraTodos: true });
            }
        } else {
            // Apagar apenas para mim
            if (!msg.apagadaPara.includes(meuId)) {
                msg.apagadaPara.push(meuId);
                await msg.save();
            }
            if (global.io) {
                global.io.to(`user:${meuId}`).emit('chat:apagada', { mensagemId: msg._id, paraTodos: false });
            }
        }

        res.json({ success: true, message: 'Mensagem apagada com sucesso.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.reagirMensagem = async (req, res) => {
    try {
        const { mensagemId, emoji } = req.body;
        const meuId = String(req.user.id || req.user._id || '');
        const meuNome = req.user.nome || 'Usuário';

        if (!mensagemId || !emoji) {
            return res.status(400).json({ success: false, error: 'ID da mensagem e emoji são obrigatórios.' });
        }

        const msg = await ChatDireto.findById(String(mensagemId));
        if (!msg) {
            return res.status(404).json({ success: false, error: 'Mensagem não encontrada.' });
        }

        // A busca era só por _id: qualquer conta autenticada que descobrisse um
        // id reagia numa conversa da qual não participa (e o nome dela aparecia
        // para os dois lados). Reagir é privilégio de quem está na conversa.
        if (String(msg.remetenteId) !== meuId && String(msg.destinatarioId) !== meuId) {
            return res.status(403).json({ success: false, error: 'Você não participa desta conversa.' });
        }

        // Remove reação anterior do mesmo usuário se existir
        msg.reacoes = msg.reacoes.filter(r => String(r.usuarioId) !== meuId);

        // Se enviou o mesmo emoji, o clique remove (toggle), se for diferente adicione
        if (emoji !== 'REMOVE') {
            msg.reacoes.push({
                usuarioId: meuId,
                usuarioNome: meuNome,
                emoji,
                criadoEm: new Date()
            });
        }

        await msg.save();

        if (global.io) {
            global.io.to(`user:${msg.destinatarioId}`).emit('chat:reacao', { mensagemId: msg._id, reacoes: msg.reacoes });
            global.io.to(`user:${msg.remetenteId}`).emit('chat:reacao', { mensagemId: msg._id, reacoes: msg.reacoes });
        }

        res.json({ success: true, data: msg.reacoes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * POST /api/chat-direto/upload — anexos e áudios da conversa.
 *
 * O chat usava /api/upload/documento, que só aceita PDF/JPG/PNG (Word, Excel,
 * ZIP, vídeo e o audio/webm da gravação de voz eram rejeitados) e gravava
 * `metadata.usuarioId` do remetente — o destinatário tomava 403 ao abrir o
 * arquivo que acabara de receber. Aqui o metadata guarda os dois lados da
 * conversa e o FileController libera para ambos (e só para eles).
 */
exports.uploadAnexo = async (req, res) => {
    try {
        const { destinatarioId } = req.body;
        const remetenteId = String(req.user.id || req.user._id || '');

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado.' });
        }
        if (!destinatarioId) {
            return res.status(400).json({ success: false, error: 'Destinatário é obrigatório.' });
        }

        // Mesma checagem do envio de texto: sem vínculo válido não há upload.
        const permissao = await podeConversar(
            { ...req.user, escolaId: req.escolaId },
            destinatarioId
        );
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
        const enviados = [];

        for (const file of req.files) {
            const ext = EXT_POR_MIME[String(file.mimetype).toLowerCase()] || '.bin';
            // O nome original nunca vira nome no GridFS — só metadado exibido.
            const filename = crypto.randomBytes(16).toString('hex') + ext;

            const gridfsId = await new Promise((resolve, reject) => {
                const stream = bucket.openUploadStream(filename, {
                    contentType: file.mimetype,
                    metadata: {
                        type: 'chat_anexo',
                        usuarioId: remetenteId,
                        destinatarioId: String(destinatarioId),
                        escolaId: req.escolaId ? String(req.escolaId) : undefined,
                        nomeOriginal: String(file.originalname || '').slice(0, 255)
                    }
                });
                stream.on('error', reject);
                stream.on('finish', () => resolve(String(stream.id)));
                stream.end(file.buffer);
            });

            enviados.push({
                gridfsId,
                url: `/api/chat-direto/anexo/${gridfsId}`,
                nome: String(file.originalname || filename).slice(0, 255),
                tipo: file.mimetype,
                tamanho: file.size
            });
        }

        res.json({ success: true, data: enviados });
    } catch (error) {
        logger.error(`[ChatDireto] Falha no upload: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao enviar arquivo.' });
    }
};

/**
 * POST /api/chat-direto/encaminhar — reenvia mensagens existentes a outros
 * contatos. Só encaminha o que o próprio usuário pode ver (é remetente ou
 * destinatário) e revalida a permissão para cada destino.
 */
exports.encaminharMensagem = async (req, res) => {
    try {
        const { mensagemIds, destinatarioIds } = req.body;
        const meuId = String(req.user.id || req.user._id || '');

        const ids = Array.isArray(mensagemIds) ? mensagemIds : [mensagemIds].filter(Boolean);
        const destinos = Array.isArray(destinatarioIds) ? destinatarioIds : [destinatarioIds].filter(Boolean);

        if (ids.length === 0 || destinos.length === 0) {
            return res.status(400).json({ success: false, error: 'Mensagens e destinatários são obrigatórios.' });
        }
        if (ids.length > 20 || destinos.length > 20) {
            return res.status(400).json({ success: false, error: 'Limite de 20 mensagens/destinatários por encaminhamento.' });
        }

        const originais = await ChatDireto.find({
            _id: { $in: ids.map(String) },
            apagadaParaTodos: { $ne: true },
            $or: [{ remetenteId: meuId }, { destinatarioId: meuId }],
            // Encaminhar é o caminho mais curto para transformar UM conteúdo
            // retido em vinte cópias entregues: `liberarAnexoPara` acrescenta
            // cada novo destinatário ao metadata do arquivo no GridFS, então o
            // que estava esperando decisão passaria a ser acessível por gente
            // que nem participava da conversa original.
            //
            // Vale tanto para o que está bloqueado quanto para o que está em
            // análise. Mensagem sem o campo é anterior à moderação e passa.
            $and: [{
                $or: [
                    { 'moderacao.status': 'aprovada' },
                    { 'moderacao.status': { $exists: false } }
                ]
            }]
        }).sort({ createdAt: 1 }).lean();

        if (originais.length === 0) {
            return res.status(404).json({ success: false, error: 'Nenhuma mensagem disponível para encaminhar.' });
        }

        const criadas = [];
        for (const destinatarioId of destinos) {
            const permissao = await podeConversar(
                { ...req.user, escolaId: req.escolaId },
                destinatarioId
            );
            if (!permissao.ok) continue;

            for (const original of originais) {
                // O metadata do arquivo no GridFS só conhece o par da conversa
                // original — sem liberar o novo destinatário, ele receberia a
                // mensagem e tomaria 403 ao abrir o anexo.
                await liberarAnexoPara(original.anexo, destinatarioId);
                await liberarAnexoPara(original.audio, destinatarioId);

                const nova = await ChatDireto.create({
                    remetenteId: meuId,
                    destinatarioId: String(destinatarioId),
                    mensagem: original.mensagem || '',
                    anexo: original.anexo || undefined,
                    audio: original.audio || undefined,
                    encaminhada: true,
                    escolaId: req.escolaId ? String(req.escolaId) : undefined
                });

                if (global.io) {
                    const evento = { ...nova.toObject(), remetenteNome: req.user.nome || '' };
                    global.io.to(`user:${destinatarioId}`).emit('chat:mensagem', evento);
                    global.io.to(`user:${meuId}`).emit('chat:mensagem', evento);
                }

                // Encaminhada também precisa alcançar o celular. O `tag` por
                // remetente garante uma notificação só, mesmo encaminhando
                // várias mensagens de uma vez.
                notificarNoCelular({
                    destinatarioId,
                    remetenteId: meuId,
                    remetenteNome: req.user.nome || 'Nova mensagem',
                    mensagem: nova.mensagem,
                    anexo: nova.anexo,
                    audio: nova.audio
                });

                criadas.push(nova);
            }
        }

        if (criadas.length === 0) {
            return res.status(403).json({ success: false, error: 'Nenhum destinatário permitido.' });
        }

        // Encaminhar 3 e ver 2 chegarem, sem explicação, é pior do que o
        // bloqueio em si. `ignoradas` deixa o front avisar. O texto não diz
        // QUAL mensagem nem por quê — quem encaminha pode nem ser o autor do
        // conteúdo retido, e o motivo não é assunto dele.
        const ignoradas = ids.length - originais.length;
        res.json({
            success: true,
            data: criadas,
            total: criadas.length,
            ...(ignoradas > 0 ? {
                ignoradas,
                aviso: ignoradas === 1
                    ? 'Uma mensagem não pôde ser encaminhada.'
                    : `${ignoradas} mensagens não puderam ser encaminhadas.`
            } : {})
        });
    } catch (error) {
        logger.error(`[ChatDireto] Falha ao encaminhar: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao encaminhar mensagem.' });
    }
};

/**
 * GET /api/chat-direto/presenca/:outroUsuarioId — status do contato para o
 * cabeçalho da conversa (online/ausente/offline + visto por último). Só
 * responde para quem tem permissão de conversar com esse usuário.
 */
exports.getPresenca = async (req, res) => {
    try {
        const { outroUsuarioId } = req.params;
        const permissao = await podeConversar(
            { ...req.user, escolaId: req.escolaId },
            outroUsuarioId
        );
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        const presence = require('../realtime/presence');
        const info = req.escolaId
            ? presence.infoDe(req.escolaId, outroUsuarioId)
            : { status: 'offline', online: false, onlineDesde: null, ultimoAcesso: null };

        res.json({ success: true, data: info });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
