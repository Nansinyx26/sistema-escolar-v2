const Notificacao = require('../models/Notificacao');
const Usuario = require('../models/Usuario');
const EmailService = require('./EmailService');
const WebPushService = require('./WebPushService');
const logger = require('../utils/logger');

/**
 * Hub central de notificações.
 */
function normalizeCategoria(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const aliases = {
        'direção': 'direcao',
        'direcao': 'direcao',
        'academico': 'academico',
        'acadêmico': 'academico',
        'financeiro': 'financeiro',
        'saude': 'saude',
        'evento': 'evento',
        'informativo': 'informativo',
        'todos': 'todos',
        'professores': 'professores',
        'responsaveis': 'responsaveis',
        'responsáveis': 'responsaveis',
        'sistema': 'sistema'
    };
    return aliases[normalized] || 'informativo';
}

function normalizePrioridade(value) {
    const normalized = String(value || '').trim().toLowerCase();
    const aliases = {
        'baixa': 'normal',
        'media': 'normal',
        'média': 'normal',
        'normal': 'normal',
        'importante': 'alta',
        'urgente': 'alta',
        'alta': 'alta'
    };
    return aliases[normalized] || 'normal';
}

exports.notify = async ({
    tipo = 'informativo',
    categoria = 'academico',
    prioridade = 'normal',
    titulo,
    mensagem,
    corpoHtml,
    destinatarios, // 'todos', 'professores', 'responsaveis', 'usuario:ID', 'turma:ID' ou array
    criadoPor,
    link = '/dashboard',
    comunicadoId = null,
    paraResponsavel = null,
    escolaId = null
}) => {
    try {
        const destList = Array.isArray(destinatarios) ? destinatarios : [destinatarios];
        const includesResponsaveis = destList.some(d =>
            d === 'todos' || d === 'responsaveis' || String(d).startsWith('turma:') || String(d).startsWith('usuario:')
        );

        // 1. Salvar no Banco de Dados
        const novaNotif = new Notificacao({
            tipo,
            categoria: normalizeCategoria(categoria),
            prioridade: normalizePrioridade(prioridade),
            titulo,
            mensagem,
            corpoHtml,
            destinatarios: destList,
            criadoPor,
            comunicadoId,
            escolaId: escolaId || undefined,
            paraResponsavel: paraResponsavel != null ? paraResponsavel : includesResponsaveis
        });
        await novaNotif.save();

        // 2. Entrega em Tempo Real (Socket.io) — DIRECIONADA por sala em vez
        // de broadcast global (antes toda a rede recebia todo aviso). Cada
        // destinatário recebe só o que lhe pertence; escolaId no payload
        // permite ao cliente descartar avisos de outra escola.
        if (global.io) {
            const populada = await Notificacao.findById(novaNotif._id)
                .populate('criadoPor', 'nome foto fotoGoogle perfil')
                .lean();
            const payload = { ...populada, link, escolaId: escolaId || null };

            // Salas de destino conforme a lista de destinatários
            const rooms = new Set();
            for (const d of destList) {
                if (d === 'todos') { rooms.add('role:professor'); rooms.add('role:responsavel'); rooms.add('role:diretor'); rooms.add('role:admin'); rooms.add('role:secretaria'); }
                else if (d === 'professores') rooms.add('role:professor');
                else if (d === 'responsaveis') rooms.add('role:responsavel');
                else if (d === 'diretores' || d === 'diretor') { rooms.add('role:diretor'); rooms.add('role:admin'); }
                else if (String(d).startsWith('usuario:')) rooms.add(`user:${String(d).split(':')[1]}`);
                else if (String(d).startsWith('turma:')) { rooms.add('role:responsavel'); rooms.add('role:professor'); }
            }

            if (rooms.size > 0) {
                // Interseção com a sala da escola: as salas `role:` sozinhas
                // alcançavam o mesmo perfil em TODAS as escolas da rede.
                let emitter = global.io;
                if (escolaId) emitter = emitter.to(`escola:${escolaId}`);
                rooms.forEach(r => { emitter = emitter.to(r); });
                emitter.emit('notification:new', payload);
            } else if (escolaId) {
                // Sem sala de perfil resolvida, entrega no máximo à escola —
                // nunca um broadcast global (o fallback anterior mandava o
                // aviso interno para todos os sockets conectados).
                global.io.to(`escola:${escolaId}`).emit('notification:new', payload);
            }
        }

        // 3. Processar Entrega Assíncrona (Email e Push) baseado em preferências
        const targetUsers = await this.getTargetUsers(destList, escolaId);

        targetUsers.forEach(async (user) => {
            const prefs = user.notificacoesPreferencias || { portal: true, push: true, email: true };

            // Email
            if (prefs.email && user.email) {
                const sent = await EmailService.sendNotificationEmail(
                    user.email,
                    titulo,
                    titulo,
                    mensagem,
                    `${process.env.FRONTEND_URL || 'http://localhost:3000'}${link}`
                );
                if (sent) {
                    await Notificacao.findByIdAndUpdate(novaNotif._id, { enviadoEmail: true });
                }
            }

            // Push
            if (prefs.push && user.pushSubscriptions && user.pushSubscriptions.length > 0) {
                const payload = {
                    title: titulo,
                    body: mensagem,
                    icon: '/favicon/favicon.png',
                    data: { url: link, id: novaNotif._id }
                };

                for (const sub of user.pushSubscriptions) {
                    const result = await WebPushService.sendPushNotification(sub, payload);
                    if (result === 'expired') {
                        // Limpar inscrição expirada
                        await Usuario.findByIdAndUpdate(user._id, {
                            $pull: { pushSubscriptions: { endpoint: sub.endpoint } }
                        });
                    }
                }
                await Notificacao.findByIdAndUpdate(novaNotif._id, { enviadoPush: true });
            }
        });

        return novaNotif;
    } catch (error) {
        logger.error(`Error in NotificationService: ${error.message}`);
        throw error;
    }
};

/**
 * Envia um Web Push direto a um usuário, sem criar registro em Notificacao.
 *
 * Usado pelo chat interno: a conversa já tem histórico próprio (ChatDireto),
 * então gravar uma Notificacao a cada mensagem duplicaria os dados e encheria
 * o sino de avisos. O que faltava era só o alcance — com o portal fechado o
 * Socket.IO não entrega nada, e a mensagem só aparecia no próximo acesso.
 *
 * Respeita `notificacoesPreferencias.push` e remove inscrições expiradas.
 *
 * @returns {Promise<number>} quantidade de dispositivos que receberam o push.
 */
exports.pushParaUsuario = async (usuarioId, { title, body, url = '/', tag } = {}) => {
    if (!usuarioId || !title) return 0;

    try {
        const user = await Usuario.findById(usuarioId)
            .select('pushSubscriptions notificacoesPreferencias ativo')
            .lean();

        if (!user || user.ativo === false) return 0;

        const prefs = user.notificacoesPreferencias || {};
        if (prefs.push === false) return 0;
        if (!Array.isArray(user.pushSubscriptions) || user.pushSubscriptions.length === 0) return 0;

        const payload = {
            title,
            body,
            icon: '/img/icons/icon-192.png',
            data: { url, id: tag }
        };

        let entregues = 0;
        for (const sub of user.pushSubscriptions) {
            const resultado = await WebPushService.sendPushNotification(sub, payload);
            if (resultado === true) entregues++;
            else if (resultado === 'expired') {
                await Usuario.findByIdAndUpdate(usuarioId, {
                    $pull: { pushSubscriptions: { endpoint: sub.endpoint } }
                });
            }
        }
        return entregues;
    } catch (error) {
        // Push é entrega auxiliar: falhar aqui não pode derrubar a ação que
        // originou o aviso (enviar a mensagem, publicar o comunicado).
        logger.error(`[NotificationService.pushParaUsuario] ${error.message}`);
        return 0;
    }
};

/**
 * Auxiliar para converter string de destinatários em lista de usuários.
 */
exports.getTargetUsers = async (destinatarios, escolaId = null) => {
    const destList = Array.isArray(destinatarios) ? destinatarios : [destinatarios];
    const userMap = new Map();

    for (const dest of destList) {
        let query = { ativo: true };
        // Multi-tenant: prioriza usuários da mesma escola, mas inclui os
        // legados sem escolaId (ex.: contas da Jaguari anteriores à migração)
        // para não deixar de notificar quem já existe.
        if (escolaId) {
            query.$or = [{ escolaId }, { escolaId: { $exists: false } }, { escolaId: null }];
        }

        if (dest === 'todos') {
            // Sem filtro adicional
        } else if (dest === 'professores') {
            query.perfil = 'professor';
        } else if (dest === 'responsaveis') {
            query.perfil = 'responsavel';
        } else if (dest === 'diretores' || dest === 'diretor') {
            query.perfil = { $in: ['diretor', 'admin'] };
        } else if (String(dest).startsWith('usuario:')) {
            query._id = String(dest).split(':')[1];
        } else if (String(dest).startsWith('turma:')) {
            query.turma = String(dest).split(':')[1];
        } else {
            continue;
        }

        const users = await Usuario.find(query).lean();
        users.forEach(u => userMap.set(String(u._id), u));
    }

    return Array.from(userMap.values());
};
