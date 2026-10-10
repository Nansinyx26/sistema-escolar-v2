const Notificacao = require('../models/Notificacao');
const Usuario = require('../models/Usuario');
const EmailService = require('./EmailService');
const WebPushService = require('./WebPushService');
const logger = require('../utils/logger');
const obs = require('../observability');
const {
    contasDasTurmas,
    membrosDaEscola,
    turmasDosDestinatarios,
} = require('./publicoDoComunicado');

/**
 * Hub central de notificações.
 */
function normalizeCategoria(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    const aliases = {
        direção: 'direcao',
        direcao: 'direcao',
        academico: 'academico',
        acadêmico: 'academico',
        financeiro: 'financeiro',
        saude: 'saude',
        evento: 'evento',
        informativo: 'informativo',
        todos: 'todos',
        professores: 'professores',
        responsaveis: 'responsaveis',
        responsáveis: 'responsaveis',
        sistema: 'sistema',
    };
    return aliases[normalized] || 'informativo';
}

function normalizePrioridade(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    const aliases = {
        baixa: 'normal',
        media: 'normal',
        média: 'normal',
        normal: 'normal',
        importante: 'alta',
        urgente: 'alta',
        alta: 'alta',
    };
    return aliases[normalized] || 'normal';
}

/**
 * Perfis que recebem o aviso INTERNO (`paraResponsavel: false`). Responsável
 * fica de fora: aviso de staff não chega ao celular, ao e-mail nem ao socket
 * de uma família.
 */
const PERFIS_DA_EQUIPE = ['admin', 'diretor', 'professor', 'secretaria'];

/**
 * Para onde o clique no push e no e-mail leva, por perfil. O padrão antigo era
 * `/dashboard`, rota que não existe — o clique caía num 404.
 */
const LINK_PADRAO = {
    equipe: '/html/dashboard.html',
    responsavel: '/portal-responsavel/dist/index.html',
};

function linkPara(link, perfil) {
    if (link) return link;
    return perfil === 'responsavel' ? LINK_PADRAO.responsavel : LINK_PADRAO.equipe;
}

/**
 * Notificação não vai para o e-mail: fica no sininho e no push. A única que
 * sai por e-mail é o resumo mensal de correções e novidades
 * (jobs/SystemUpdateJob.js, dia 1 às 16h). Antes todo aviso — inclusive o
 * resumo diário das 16h — virava e-mail.
 */
function vaiPorEmail(tipo, resumoEmail) {
    return tipo === 'atualizacao_sistema' && Boolean(resumoEmail);
}

/** `usuario:<id>` é endereçamento a uma pessoa, não a um público. */
function ehUsuario(dest) {
    return String(dest).startsWith('usuario:');
}

/**
 * Salas de perfil que a notificação alcança. `usuario:<id>` não entra aqui:
 * vai direto para `user:<id>`, sem depender de escola nem de perfil.
 */
function salasDePerfil(destList, paraResponsavel) {
    const salas = new Set();
    for (const d of destList) {
        if (d === 'todos') {
            for (const p of PERFIS_DA_EQUIPE) salas.add(`role:${p}`);
            if (paraResponsavel) salas.add('role:responsavel');
        } else if (d === 'professores') salas.add('role:professor');
        else if (d === 'responsaveis') salas.add('role:responsavel');
        else if (d === 'diretores' || d === 'diretor') {
            salas.add('role:diretor');
            salas.add('role:admin');
        }
        // `turma:<id>` (ou o id cru de turma) não abre sala de perfil: virava
        // `role:professor` e `role:responsavel` da escola INTEIRA, e o aviso de
        // uma turma chegava, com o conteúdo, a todas as famílias (Issue #686).
        // As contas da turma são resolvidas em `contasDasTurmas`.
    }
    if (!paraResponsavel) salas.delete('role:responsavel');
    return salas;
}

/**
 * Entrega `notification:new` a quem está na escola E numa das salas de perfil.
 *
 * `io.to(a).to(b)` no Socket.IO é UNIÃO, não interseção: a versão anterior
 * entregava o aviso a todo mundo da escola (responsáveis incluídos) e a todo
 * mundo daquele perfil, de qualquer escola. A interseção é feita aqui, socket a
 * socket — `fetchSockets` também responde pelos sockets das outras instâncias
 * pelo adapter compartilhado (ver realtime/adapter.js).
 */
async function emitirNotificacao({ escolaId, salas, usuarios, payload }) {
    const io = global.io;
    if (!io) return;
    const evento = { notification: payload };

    for (const uid of usuarios) io.to(`user:${uid}`).emit('notification:new', evento);
    if (salas.size === 0) return;

    if (!escolaId) {
        // Aviso sem escola (resumo diário, pré-migração): só o recorte de perfil.
        io.to([...salas]).emit('notification:new', evento);
        return;
    }

    let sockets;
    try {
        sockets = await io.in(`escola:${escolaId}`).fetchSockets();
    } catch (err) {
        // A notificação já está gravada e o sino a busca no próximo carregamento;
        // falhar aqui não pode desfazer quem a originou (publicar o comunicado).
        logger.warn(`[NotificationService] tempo real indisponível: ${err.message}`);
        return;
    }
    const jaEntregue = new Set(usuarios.map((uid) => `user:${uid}`));
    for (const s of sockets) {
        const rooms = s.rooms instanceof Set ? s.rooms : new Set(s.rooms || []);
        if ([...jaEntregue].some((r) => rooms.has(r))) continue;
        if ([...salas].some((r) => rooms.has(r))) s.emit('notification:new', evento);
    }
}

exports.notify = async ({
    tipo = 'informativo',
    categoria = 'academico',
    prioridade = 'normal',
    titulo,
    mensagem,
    corpoHtml,
    destinatarios, // 'todos', 'professores', 'responsaveis', 'diretor(es)', 'usuario:ID', 'turma:ID' ou array
    criadoPor,
    link = null,
    comunicadoId = null,
    paraResponsavel = null,
    escolaId = null,
    resumoEmail = null, // dados estruturados do resumo mensal (só para o e-mail)
}) => {
    try {
        const destList = Array.isArray(destinatarios) ? destinatarios : [destinatarios];
        // `usuario:<id>` não conta como público de responsáveis: a resposta a
        // um comentário de professor não é aviso para famílias.
        const includesResponsaveis = destList.some(
            (d) => d === 'todos' || d === 'responsaveis' || String(d).startsWith('turma:')
        );
        const alcancaResponsavel =
            paraResponsavel != null ? Boolean(paraResponsavel) : includesResponsaveis;

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
            paraResponsavel: alcancaResponsavel,
        });
        await novaNotif.save();

        // 2. Entrega em Tempo Real (Socket.io) — escola × perfil
        if (global.io) {
            const payload = {
                ...novaNotif.toObject(),
                id: novaNotif.id,
                link: link || null,
                escolaId: escolaId || null,
            };
            const usuarios = new Set(
                destList.filter(ehUsuario).map((d) => String(d).split(':')[1])
            );
            for (const id of await contasDasTurmas(escolaId, turmasDosDestinatarios(destList), {
                incluirResponsaveis: alcancaResponsavel,
            })) {
                usuarios.add(id);
            }
            await emitirNotificacao({
                escolaId,
                salas: salasDePerfil(destList, alcancaResponsavel),
                usuarios: [...usuarios],
                payload,
            });
        }

        // 3. E-mail e push saem fora da requisição, mas nunca como promessa
        // solta: o erro é registrado em vez de virar rejeição não tratada.
        exports
            .entregarForaDoPortal(novaNotif, {
                destList,
                escolaId,
                alcancaResponsavel,
                tipo,
                titulo,
                mensagem,
                link,
                resumoEmail,
            })
            .catch((err) => {
                logger.error(`[NotificationService] entrega: ${err.message}`);
                obs.captureException(err, { tipo: 'notificacao.entrega' });
            });

        return novaNotif;
    } catch (error) {
        logger.error(`Error in NotificationService: ${error.message}`);
        throw error;
    }
};

/**
 * E-mail e push de uma notificação já gravada. Cada destinatário é uma
 * entrega independente: a falha de um não interrompe os outros.
 *
 * @returns {Promise<{ entregues: number, falhas: number }>}
 */
exports.entregarForaDoPortal = (novaNotif, opcoes) =>
    obs.withSpan(
        'notificacao.entrega',
        { destinatarios: opcoes.destList.length, 'escola.id': String(opcoes.escolaId || '') },
        async (span) => {
            const resultado = await entregar(novaNotif, opcoes);
            span.setAttribute('entregas.ok', resultado.entregues);
            span.setAttribute('entregas.falhas', resultado.falhas);
            return resultado;
        }
    );

async function entregar(
    novaNotif,
    { destList, escolaId, alcancaResponsavel, tipo, titulo, mensagem, link, resumoEmail }
) {
    const targetUsers = await exports.getTargetUsers(destList, escolaId, {
        incluirResponsaveis: alcancaResponsavel,
    });

    const resultados = await Promise.allSettled(
        targetUsers.map(async (user) => {
            const prefs = user.notificacoesPreferencias || {
                portal: true,
                push: true,
                email: true,
            };
            const destino = linkPara(link, user.perfil);

            if (vaiPorEmail(tipo, resumoEmail) && prefs.email && user.email) {
                const sent = await EmailService.sendNotificationEmail(
                    user.email,
                    titulo,
                    titulo,
                    mensagem,
                    `${process.env.FRONTEND_URL || 'http://localhost:3000'}${destino}`,
                    {
                        tipo,
                        resumo: resumoEmail,
                        categoria: novaNotif.categoria,
                        prioridade: novaNotif.prioridade,
                    }
                );
                if (sent)
                    await Notificacao.findByIdAndUpdate(novaNotif._id, { enviadoEmail: true });
            }

            if (
                prefs.push !== false &&
                Array.isArray(user.pushSubscriptions) &&
                user.pushSubscriptions.length > 0
            ) {
                const payload = {
                    title: titulo,
                    body: mensagem,
                    icon: '/img/icons/icon-192.png',
                    data: { url: destino, id: String(novaNotif._id) },
                };
                for (const sub of user.pushSubscriptions) {
                    const result = await WebPushService.sendPushNotification(sub, payload);
                    if (result === 'expired') {
                        await Usuario.findByIdAndUpdate(user._id, {
                            $pull: { pushSubscriptions: { endpoint: sub.endpoint } },
                        });
                    }
                }
                await Notificacao.findByIdAndUpdate(novaNotif._id, { enviadoPush: true });
            }
        })
    );

    const falhas = resultados.filter((r) => r.status === 'rejected');
    for (const f of falhas) {
        obs.captureException(f.reason, { tipo: 'notificacao.entrega_destinatario' });
        logger.error(
            `[NotificationService] entrega a um destinatário falhou: ${f.reason?.message || f.reason}`
        );
    }
    return { entregues: resultados.length - falhas.length, falhas: falhas.length };
}

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
            data: { url, id: tag },
        };

        let entregues = 0;
        for (const sub of user.pushSubscriptions) {
            const resultado = await WebPushService.sendPushNotification(sub, payload);
            if (resultado === true) entregues++;
            else if (resultado === 'expired') {
                await Usuario.findByIdAndUpdate(usuarioId, {
                    $pull: { pushSubscriptions: { endpoint: sub.endpoint } },
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
exports.getTargetUsers = async (
    destinatarios,
    escolaId = null,
    { incluirResponsaveis = true } = {}
) => {
    const destList = Array.isArray(destinatarios) ? destinatarios : [destinatarios];
    const userMap = new Map();

    // Turma: as contas dela, na escola (Issue #686). `query.turma` não casava
    // com conta nenhuma, e o id cru de turma era ignorado.
    const daTurma = await contasDasTurmas(escolaId, turmasDosDestinatarios(destList.map(String)), {
        incluirResponsaveis,
    });
    if (daTurma.length) {
        const contas = await Usuario.find({ _id: { $in: daTurma }, ativo: true }).lean();
        for (const u of contas) userMap.set(String(u._id), u);
    }

    // Públicos amplos só alcançam quem é da escola (Issue #745): a família
    // com filho matriculado nela, a equipe com vínculo nela. Calculado uma vez,
    // e só se algum destinatário precisar.
    let membros = null;
    const daEscola = async (u) => {
        const perfil = String(u.perfil || '').toLowerCase();
        if (perfil === 'admin') return true; // a rede inteira é dele
        if (!membros) membros = await membrosDaEscola(escolaId);
        const email = String(u.email || '').toLowerCase();
        if (perfil === 'responsavel') return membros.familias.has(email);
        return (
            String(u.escolaId || '') === String(escolaId) ||
            membros.equipeIds.has(String(u._id)) ||
            membros.equipeEmails.has(email)
        );
    };

    for (const dest of destList) {
        const query = { ativo: true };
        // Multi-tenant: a conta da escola ou sem escola gravada (a do login
        // Google e a do primeiro acesso nascem assim). Quem é desta escola de
        // fato decide `daEscola`, logo abaixo — o "legado sem escolaId" aceito
        // sem conferência entregava os avisos de todas as escolas a essas
        // contas.
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
        } else {
            continue;
        }

        // Aviso interno não alcança responsável — exceto quem foi endereçado
        // pelo nome (`usuario:<id>`).
        if (!incluirResponsaveis && !String(dest).startsWith('usuario:')) {
            if (query.perfil === 'responsavel') continue;
            if (!query.perfil) query.perfil = { $ne: 'responsavel' };
        }

        const users = await Usuario.find(query).lean();
        const pessoal = String(dest).startsWith('usuario:');
        for (const u of users) {
            if (escolaId && !pessoal && !(await daEscola(u))) continue;
            userMap.set(String(u._id), u);
        }
    }

    return Array.from(userMap.values());
};
