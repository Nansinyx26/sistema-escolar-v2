const Notificacao = require('../models/Notificacao');
const Usuario = require('../models/Usuario');
const EmailService = require('./EmailService');
const WebPushService = require('./WebPushService');
const logger = require('../utils/logger');

/**
 * Hub central de notificações.
 */
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
    paraResponsavel = null
}) => {
    try {
        const destList = Array.isArray(destinatarios) ? destinatarios : [destinatarios];
        const includesResponsaveis = destList.some(d =>
            d === 'todos' || d === 'responsaveis' || String(d).startsWith('turma:') || String(d).startsWith('usuario:')
        );

        // 1. Salvar no Banco de Dados
        const novaNotif = new Notificacao({
            tipo,
            categoria,
            prioridade,
            titulo,
            mensagem,
            corpoHtml,
            destinatarios: destList,
            criadoPor,
            comunicadoId,
            paraResponsavel: paraResponsavel != null ? paraResponsavel : includesResponsaveis
        });
        await novaNotif.save();

        // 2. Entrega em Tempo Real (Socket.io)
        if (global.io) {
            global.io.emit('notification:new', {
                ...novaNotif.toObject(),
                link
            });
        }

        // 3. Processar Entrega Assíncrona (Email e Push) baseado em preferências
        const targetUsers = await this.getTargetUsers(destList);

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
                    icon: '/icon-192x192.png',
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
 * Auxiliar para converter string de destinatários em lista de usuários.
 */
exports.getTargetUsers = async (destinatarios) => {
    const destList = Array.isArray(destinatarios) ? destinatarios : [destinatarios];
    const userMap = new Map();

    for (const dest of destList) {
        let query = { ativo: true };

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
