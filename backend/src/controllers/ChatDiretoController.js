const mongoose = require('mongoose');
const crypto = require('crypto');
const ChatDireto = require('../models/ChatDireto');
const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const { vinculoDoResponsavel, emailsDeResponsaveisDaEscola } = require('../services/vinculoTurmas');
const { formatarPresenca } = require('../utils/formatarPresenca');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');
const NotificationService = require('../services/NotificationService');
const { EXT_POR_MIME } = require('../middleware/uploadChat');

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

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads',
    });
    const docs = await bucket
        .find({ _id: new mongoose.Types.ObjectId(gridfsId) })
        .limit(1)
        .toArray();
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
        tamanho: arquivo.length || 0,
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

    await mongoose.connection.db
        .collection('uploads.files')
        .updateOne(
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
        duracao: Number.isFinite(duracao) && duracao >= 0 ? Math.min(duracao, 60 * 60) : 0,
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
 *   professor   ↔ professor, diretor, secretaria
 *   diretor     ↔ diretor, secretaria, professor
 *   secretaria  ↔ secretaria, professor, diretor, responsavel
 *   responsavel ↔ secretaria, e só
 *
 * A SECRETARIA É A PORTA ÚNICA DA FAMÍLIA (Issue #204)
 * ----------------------------------------------------
 * O responsável não alcança professor nem direção pelo chat. O canal da família
 * com a escola é a SECRETARIA — e não qualquer uma: a da escola em que o filho
 * dele está matriculado (ver `vinculoDeEscolaOk`).
 *
 * O motivo é institucional, não técnico. Combinar horário com o professor,
 * questionar nota, pedir reunião com a direção: tudo isso passa a ter um
 * registro único, na secretaria, em vez de virar conversa paralela que a escola
 * não vê e não consegue responder por escrito depois. Professor e direção
 * continuam conversando entre si e com a secretaria normalmente — o que fechou
 * foi só a ponta que ligava a família diretamente a eles.
 *
 * Antes desta política, `professor ↔ responsavel` existia e era recortado por
 * turma em comum (Issue #68). Esse recorte não some por ser errado; ele some
 * porque o par que ele protegia deixou de existir. Se a política for revista, é
 * ele que volta — `services/vinculoTurmas.js` ainda responde a pergunta.
 *
 * `admin` é tratado à parte: conversa com qualquer perfil e atravessa escolas,
 * porque é o papel de suporte da rede. A ÚNICA exceção é o responsável — o
 * suporte também não fala com a família. Uma porta só significa uma porta: se o
 * admin continuasse alcançável, a família teria dois canais e o segundo seria
 * justamente o que ninguém da escola vê.
 */
const MATRIZ_CONVERSA = {
    professor: ['professor', 'diretor', 'secretaria'],
    diretor: ['diretor', 'secretaria', 'professor'],
    secretaria: ['secretaria', 'professor', 'diretor', 'responsavel'],
    // Responsável não inicia nem recebe conversa de outro responsável (a escola
    // é sempre a intermediária entre duas famílias), nem de professor ou
    // direção. Sobra a secretaria — e mesmo ela ainda precisa passar por
    // `vinculoDeEscolaOk`.
    responsavel: ['secretaria'],
};

/** true se o par de perfis está na matriz, em qualquer direção. */
function paresPermitidos(perfilA, perfilB) {
    const envolveResponsavel = perfilA === 'responsavel' || perfilB === 'responsavel';

    // O atalho do admin vem DEPOIS da guarda de propósito: "suporte fala com
    // todo mundo" vale para a equipe, não para a família. Sem isto o suporte da
    // rede seria a segunda porta que esta matriz existe para não ter.
    if (!envolveResponsavel && (perfilA === 'admin' || perfilB === 'admin')) return true;

    const deA = MATRIZ_CONVERSA[perfilA];
    const deB = MATRIZ_CONVERSA[perfilB];
    // Perfil que não está na matriz nunca conversa — e `admin` é um deles, que
    // é o que faz o par admin↔responsavel cair aqui como negado.
    if (!deA || !deB) return false;
    return deA.includes(perfilB) && deB.includes(perfilA);
}

/**
 * O texto da recusa de um par que a matriz não autoriza.
 *
 * Vale a pena distinguir os casos porque "não é permitido" sozinho vira um bug
 * aos olhos de quem lê: o responsável que tentar falar com o professor precisa
 * saber PARA ONDE ir, senão ele liga para a escola perguntando por que o chat
 * quebrou. As frases dizem o caminho, e nenhuma delas revela quem existe do
 * outro lado — o par de perfis já veio da sessão e do destinatário.
 *
 * Escrito nos dois sentidos: a autorização roda em quem envia, então o
 * professor que tenta responder uma família também cai aqui.
 */
function recusaDePar(perfilRemetente, perfilDestino) {
    if (perfilRemetente === 'responsavel' && perfilDestino === 'responsavel') {
        return 'Responsáveis não conversam entre si. Fale com a secretaria da escola.';
    }

    if (perfilRemetente === 'responsavel' || perfilDestino === 'responsavel') {
        return perfilRemetente === 'responsavel'
            ? 'Pelo chat, o contato da família é com a secretaria da escola — ela encaminha à professora, à direção ou ao suporte.'
            : 'Responsáveis conversam apenas com a secretaria da escola. Fale com ela para chegar à família.';
    }

    return 'Este tipo de conversa não é permitido.';
}

/**
 * Escolas que uma conta de secretaria atende.
 *
 * O vínculo de escola da equipe mora em `vinculos[]`; `escolaId` é a escola
 * principal e nem sempre está preenchido. Os dois entram, porque o cadastro
 * real tem as duas formas conforme a época.
 *
 * Conjunto VAZIO significa "não dá para saber", e não "nenhuma": é o cadastro
 * legado, anterior ao multi-escola. Quem decide o que fazer com isso é
 * `vinculoDeEscolaOk` — aqui a função só relata o que existe.
 *
 * @param {string} usuarioId `Usuario._id` da secretaria
 * @returns {Promise<Set<string>>}
 */
async function escolasDaSecretaria(usuarioId) {
    const doc = await Secretaria.findOne({ idUsuario: String(usuarioId) })
        .select('escolaId vinculos.escolaId')
        .lean();

    const escolas = new Set();
    if (!doc) return escolas;
    if (doc.escolaId) escolas.add(String(doc.escolaId));
    for (const vinculo of doc.vinculos || []) {
        if (vinculo?.escolaId) escolas.add(String(vinculo.escolaId));
    }
    return escolas;
}

/**
 * Confere o vínculo REAL entre um responsável e uma secretaria.
 *
 * `paresPermitidos` autoriza a COMBINAÇÃO de perfis; esta função responde a
 * pergunta que sobra: essa família tem alguma coisa a ver com essa escola?
 * Sem ela, "responsável fala com a secretaria" significaria falar com a
 * secretaria de QUALQUER escola da rede — inclusive com um cadastro de
 * responsável sem nenhum filho matriculado em lugar nenhum.
 *
 * DUAS BARREIRAS, NESTA ORDEM
 * ---------------------------
 *   1. o responsável precisa ter ao menos um filho cadastrado (falha FECHADA:
 *      sem filho, não há canal escolar nenhum a abrir);
 *   2. a escola desse filho precisa ser uma das que a secretaria atende.
 *
 * A segunda só é aplicada quando os DOIS lados declaram escola. Cadastro legado
 * — aluno ou secretaria sem `escolaId`, de antes do multi-escola — não tem como
 * ser recortado por escola, e recortar assim mesmo bloquearia a rede inteira
 * enquanto a migração não roda. Nesse caso vale o recorte que já aconteceu
 * antes, em `podeConversar`: o `escolaId` da sessão dos dois lados.
 *
 * Só se aplica ao par responsavel↔secretaria. Entre membros da equipe o vínculo
 * é o cargo, e ele já foi conferido pela escola da sessão.
 *
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
async function vinculoDeEscolaOk(remetente, perfilRemetente, destinatario, perfilDestino) {
    const ehParResponsavelSecretaria =
        (perfilRemetente === 'responsavel' && perfilDestino === 'secretaria') ||
        (perfilRemetente === 'secretaria' && perfilDestino === 'responsavel');

    if (!ehParResponsavelSecretaria) return { ok: true };

    const responsavel = perfilRemetente === 'responsavel' ? remetente : destinatario;
    const secretaria = perfilRemetente === 'secretaria' ? remetente : destinatario;

    const [vinculo, escolasDaEquipe] = await Promise.all([
        vinculoDoResponsavel(responsavel.email),
        escolasDaSecretaria(secretaria._id || secretaria.id),
    ]);

    // Mensagem deliberadamente igual para os dois sentidos e sem detalhe: dizer
    // "esse responsável não tem filho nesta escola" confirmaria a existência do
    // vínculo (ou a falta dele) para quem está sondando a lista de alunos.
    const negar = {
        ok: false,
        status: 403,
        error: 'A secretaria só conversa com responsáveis de alunos da escola dela.',
    };

    if (!vinculo.filhos) return negar;

    const podeRecortarPorEscola = vinculo.escolas.size > 0 && escolasDaEquipe.size > 0;
    if (!podeRecortarPorEscola) return { ok: true };

    for (const escola of escolasDaEquipe) {
        if (vinculo.escolas.has(escola)) return { ok: true };
    }
    return negar;
}

/**
 * Verifica se dois usuários podem trocar mensagens diretas.
 *
 * Antes, `enviarMensagem` aceitava qualquer destinatarioId — sem validar
 * vínculo, perfil ou escola —, então qualquer conta autenticada mandava
 * mensagem para qualquer outra da rede inteira.
 *
 * TRÊS barreiras, nesta ordem — da mais barata para a mais cara:
 *   1. mesma escola (multi-tenant);
 *   2. par de perfis presente na MATRIZ_CONVERSA;
 *   3. para responsavel↔secretaria, filho matriculado na escola dela.
 *
 * A terceira existe porque as duas primeiras juntas ainda liberariam a
 * secretaria de uma escola para a família de outra: os dois passam no perfil, e
 * o `escolaId` da sessão de um responsável é resolvido pela escola ATIVA da
 * rede (`middleware/filtrarPorEscola.js`, ramo 3), não pela matrícula do filho
 * — quem tem filho na escola A pode estar com a escola B na sessão.
 */
async function podeConversar(remetente, destinatarioId) {
    const destinatario = await Usuario.findById(String(destinatarioId))
        // `email` entra por causa do vínculo fino: é por ele que se acha os
        // alunos de um responsável (ver services/vinculoTurmas.js).
        .select('perfil escolaId ativo email')
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
        return { ok: false, status: 403, error: recusaDePar(perfilRemetente, perfilDestino) };
    }

    // Perfis compatíveis não bastam: responsavel↔secretaria ainda precisa do
    // filho matriculado na escola dela. Fica DEPOIS da matriz de propósito — é
    // a checagem cara (duas consultas), e só faz sentido para um par que já
    // passou no barato.
    const vinculo = await vinculoDeEscolaOk(
        remetente,
        perfilRemetente,
        destinatario,
        perfilDestino
    );
    if (!vinculo.ok) return vinculo;

    return { ok: true, destinatario };
}

// Janelas de tempo para mexer numa mensagem já entregue. Ambas contam a partir
// de `createdAt` e são verificadas NO SERVIDOR — esconder o botão no cliente
// não impede um POST direto.
const JANELA_EDICAO_MS = 15 * 60 * 1000; // 15 minutos
const JANELA_APAGAR_TODOS_MS = 60 * 60 * 1000; // 1 hora

/** true se `criadaEm` já passou do prazo. Data ausente conta como fora. */
function foraDaJanela(criadaEm, janelaMs) {
    if (!criadaEm) return true;
    const t = new Date(criadaEm).getTime();
    if (!Number.isFinite(t)) return true;
    return Date.now() - t > janelaMs;
}

/** Prévia curta do que chegou — texto, ou o tipo do anexo quando não há texto. */
function previaDaMensagem({ mensagem, anexo, audio }) {
    const texto = String(mensagem || '')
        .replace(/\s+/g, ' ')
        .trim();
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
function notificarNoCelular({
    destinatarioId,
    remetenteId,
    remetenteNome,
    mensagem,
    anexo,
    audio,
}) {
    NotificationService.pushParaUsuario(destinatarioId, {
        title: remetenteNome,
        body: previaDaMensagem({ mensagem, anexo, audio }),
        // Abre direto na conversa de quem mandou (ver abrirConversaDaUrl em
        // js/chat-direto-manager.js), não num dashboard genérico.
        url: `/html/dashboard.html?chat=${encodeURIComponent(remetenteId)}`,
        tag: `chat-${remetenteId}`,
    }).catch((err) => {
        logger.warn(`[ChatDireto] Push não entregue a ${destinatarioId}: ${err.message}`);
    });
}

exports.enviarMensagem = async (req, res) => {
    try {
        const {
            destinatarioId,
            mensagem,
            anexo,
            audio,
            respostaParaId,
            turmaId,
            alunoId,
            contexto,
        } = req.body;
        const remetenteId = String(req.user.id || req.user._id || '');

        if (!destinatarioId || (!mensagem && !anexo && !audio)) {
            return res.status(400).json({
                success: false,
                error: 'Destinatário e conteúdo (mensagem, anexo ou áudio) são obrigatórios.',
            });
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
            escolaId: req.escolaId ? String(req.escolaId) : undefined,
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
            audio: audioValidado,
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

        // LER É CONVERSAR — a mesma autorização do envio, e não uma mais frouxa.
        //
        // Participar da conversa já não basta. Antes desta política a família
        // trocava mensagem com professor e direção, e essas conversas EXISTEM no
        // banco: sem esta barreira, fechar o envio só impediria a mensagem nova
        // enquanto todo o histórico continuava a um GET de distância, aberto
        // pelos dois lados. O canal ficaria fechado no papel e legível na
        // prática.
        //
        // Vale nos DOIS sentidos, porque a regra é do par: o professor também
        // não reabre a conversa antiga com a família. A conversa não é apagada —
        // ela deixa de ser alcançável por quem não pode mais conversar. Quem
        // precisa do próprio registro continua com a exportação de dados
        // pessoais (`MeusDadosController`, LGPD).
        const permissao = await podeConversar(
            { ...req.user, escolaId: req.escolaId },
            outroUsuarioId
        );
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        // `$and` em vez de sobrescrever `$or`: antes o filtro de busca
        // substituía a cláusula da conversa e o `$or` original se perdia — com
        // `$and` o par de participantes é sempre respeitado.
        const condicoes = [
            {
                $or: [
                    { remetenteId: meuId, destinatarioId: String(outroUsuarioId) },
                    { remetenteId: String(outroUsuarioId), destinatarioId: meuId },
                ],
            },
        ];

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
                { remetenteId: meuId },
            ],
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
            const termo = String(search)
                .trim()
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
            cursor: mensagens.length > 0 ? mensagens[0].createdAt : null,
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
            lida: { $ne: true },
        };

        const ids = await ChatDireto.find(filtro).select('_id').lean();
        if (ids.length === 0) {
            return res.json({ success: true, data: { atualizadas: 0, ids: [] } });
        }

        await ChatDireto.updateMany(filtro, { lida: true, status: 'lida' });

        const listaIds = ids.map((m) => String(m._id));
        if (global.io) {
            // Para o OUTRO lado: "as suas mensagens foram lidas" — é o que faz
            // os tiques ficarem azuis na conversa dele.
            global.io.to(`user:${outroUsuarioId}`).emit('chat:lidas', {
                mensagemIds: listaIds,
                destinatarioId: meuId,
            });

            // Para MIM, nas outras abas e dispositivos: "você leu esta conversa".
            //
            // Evento com NOME PRÓPRIO de propósito. Reemitir `chat:lidas` para
            // mim mesmo pareceria mais simples e estaria errado: o
            // chat-direto-manager lê aquele evento como "o outro leu as MINHAS
            // mensagens" e marcaria as bolhas erradas como lidas.
            //
            // Sem isto, o selo de não lidas do menu (Issue #72) continuava
            // aceso nas outras abas até a revalidação de 60s — o produto
            // apontando mensagem que a pessoa já tinha lido.
            global.io.to(`user:${meuId}`).emit('chat:conversa-lida', {
                comUsuarioId: String(outroUsuarioId),
                quantidade: listaIds.length,
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
                destinatarioId: meuId,
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
            return res
                .status(400)
                .json({ success: false, error: 'O novo conteúdo da mensagem é obrigatório.' });
        }

        // Janela de edição: passado o prazo, a mensagem é registro da conversa.
        // Sem isso, o autor reescrevia uma mensagem de meses atrás e o outro
        // lado via o texto novo como se sempre tivesse sido aquele.
        const original = await ChatDireto.findOne({
            _id: String(mensagemId),
            remetenteId: meuId,
            apagadaParaTodos: { $ne: true },
        })
            .select('createdAt mensagem')
            .lean();
        const textoAnterior = original ? original.mensagem : '';

        if (!original) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada ou sem permissão para editar.',
            });
        }
        if (foraDaJanela(original.createdAt, JANELA_EDICAO_MS)) {
            return res.status(403).json({
                success: false,
                error: `Mensagens só podem ser editadas nos primeiros ${JANELA_EDICAO_MS / 60000} minutos.`,
            });
        }

        const atualizada = await ChatDireto.findOneAndUpdate(
            { _id: String(mensagemId), remetenteId: meuId, apagadaParaTodos: { $ne: true } },
            { mensagem: novaMensagem.trim(), editada: true, editadaEm: new Date() },
            { new: true }
        );

        if (!atualizada) {
            return res.status(404).json({
                success: false,
                error: 'Mensagem não encontrada ou sem permissão para editar.',
            });
        }

        // Edição altera um registro que a outra pessoa já leu — fica na trilha.
        const { logAction } = require('../utils/auditHelper');
        await logAction(req, 'CHAT_EDIT_MESSAGE', 'ChatDireto', {
            recursoId: String(atualizada._id),
            escolaId: atualizada.escolaId,
            valorAnterior: textoAnterior,
            valorNovo: atualizada.mensagem,
            descricao: `Mensagem editada na conversa com ${atualizada.destinatarioId}.`,
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
            return res
                .status(403)
                .json({ success: false, error: 'Você não participa desta conversa.' });
        }

        if (tipo === 'para_todos') {
            if (String(msg.remetenteId) !== meuId) {
                return res.status(403).json({
                    success: false,
                    error: 'Apenas o autor pode apagar a mensagem para todos.',
                });
            }
            // "Apagar para todos" reescreve o que a outra pessoa já leu, então
            // vale só logo após o envio. Passada a janela, resta "apagar para
            // mim", que não altera o lado do destinatário.
            if (foraDaJanela(msg.createdAt, JANELA_APAGAR_TODOS_MS)) {
                return res.status(403).json({
                    success: false,
                    error: `Só é possível apagar para todos na primeira hora. Você ainda pode apagar apenas para você.`,
                });
            }
            // Auditoria ANTES de sobrescrever: registrar depois guardaria o
            // placeholder, não o que foi de fato removido da vista do outro.
            const { logAction } = require('../utils/auditHelper');
            await logAction(req, 'CHAT_DELETE_FOR_ALL', 'ChatDireto', {
                recursoId: String(msg._id),
                escolaId: msg.escolaId,
                valorAnterior: previaDaMensagem({
                    mensagem: msg.mensagem,
                    anexo: msg.anexo,
                    audio: msg.audio,
                }),
                descricao: `Mensagem apagada para todos na conversa com ${msg.destinatarioId}.`,
            });

            msg.mensagem = 'Esta mensagem foi apagada.';
            msg.anexo = undefined;
            msg.audio = undefined;
            msg.apagadaParaTodos = true;
            await msg.save();

            if (global.io) {
                global.io
                    .to(`user:${msg.destinatarioId}`)
                    .emit('chat:apagada', { mensagemId: msg._id, paraTodos: true });
                global.io
                    .to(`user:${meuId}`)
                    .emit('chat:apagada', { mensagemId: msg._id, paraTodos: true });
            }
        } else {
            // Apagar apenas para mim
            if (!msg.apagadaPara.includes(meuId)) {
                msg.apagadaPara.push(meuId);
                await msg.save();
            }
            if (global.io) {
                global.io
                    .to(`user:${meuId}`)
                    .emit('chat:apagada', { mensagemId: msg._id, paraTodos: false });
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
            return res
                .status(400)
                .json({ success: false, error: 'ID da mensagem e emoji são obrigatórios.' });
        }

        const msg = await ChatDireto.findById(String(mensagemId));
        if (!msg) {
            return res.status(404).json({ success: false, error: 'Mensagem não encontrada.' });
        }

        // A busca era só por _id: qualquer conta autenticada que descobrisse um
        // id reagia numa conversa da qual não participa (e o nome dela aparecia
        // para os dois lados). Reagir é privilégio de quem está na conversa.
        if (String(msg.remetenteId) !== meuId && String(msg.destinatarioId) !== meuId) {
            return res
                .status(403)
                .json({ success: false, error: 'Você não participa desta conversa.' });
        }

        // Participar não basta: reagir é interagir, e um fio que a matriz fechou
        // não aceita interação nova. Diferente de `editarMensagem`, aqui não há
        // janela de tempo que resolva sozinha — sem esta checagem a reação seria
        // a única forma de a família ainda alcançar o professor.
        const outroLado = String(msg.remetenteId) === meuId ? msg.destinatarioId : msg.remetenteId;
        const permissao = await podeConversar({ ...req.user, escolaId: req.escolaId }, outroLado);
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        // Remove reação anterior do mesmo usuário se existir
        msg.reacoes = msg.reacoes.filter((r) => String(r.usuarioId) !== meuId);

        // Se enviou o mesmo emoji, o clique remove (toggle), se for diferente adicione
        if (emoji !== 'REMOVE') {
            msg.reacoes.push({
                usuarioId: meuId,
                usuarioNome: meuNome,
                emoji,
                criadoEm: new Date(),
            });
        }

        await msg.save();

        if (global.io) {
            global.io
                .to(`user:${msg.destinatarioId}`)
                .emit('chat:reacao', { mensagemId: msg._id, reacoes: msg.reacoes });
            global.io
                .to(`user:${msg.remetenteId}`)
                .emit('chat:reacao', { mensagemId: msg._id, reacoes: msg.reacoes });
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
                        nomeOriginal: String(file.originalname || '').slice(0, 255),
                    },
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
                tamanho: file.size,
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
        const destinos = Array.isArray(destinatarioIds)
            ? destinatarioIds
            : [destinatarioIds].filter(Boolean);

        if (ids.length === 0 || destinos.length === 0) {
            return res
                .status(400)
                .json({ success: false, error: 'Mensagens e destinatários são obrigatórios.' });
        }
        if (ids.length > 20 || destinos.length > 20) {
            return res.status(400).json({
                success: false,
                error: 'Limite de 20 mensagens/destinatários por encaminhamento.',
            });
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
            $and: [
                {
                    $or: [
                        { 'moderacao.status': 'aprovada' },
                        { 'moderacao.status': { $exists: false } },
                    ],
                },
            ],
        })
            .sort({ createdAt: 1 })
            .lean();

        if (originais.length === 0) {
            return res
                .status(404)
                .json({ success: false, error: 'Nenhuma mensagem disponível para encaminhar.' });
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
                    escolaId: req.escolaId ? String(req.escolaId) : undefined,
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
                    audio: nova.audio,
                });

                criadas.push(nova);
            }
        }

        if (criadas.length === 0) {
            return res
                .status(403)
                .json({ success: false, error: 'Nenhum destinatário permitido.' });
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
            ...(ignoradas > 0
                ? {
                      ignoradas,
                      aviso:
                          ignoradas === 1
                              ? 'Uma mensagem não pôde ser encaminhada.'
                              : `${ignoradas} mensagens não puderam ser encaminhadas.`,
                  }
                : {}),
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

/**
 * IDs de todo mundo com quem esta pessoa já trocou mensagem.
 *
 * `listarContatos` monta a lista a partir do ORGANOGRAMA — coleções de cargo e
 * vínculo aluno↔responsável. Quem não está em nenhuma dessas estruturas nunca
 * apareceria nela, e é exatamente o caso do admin. O histórico é a evidência
 * que falta: se a conversa já existe, o contato existe.
 *
 * Devolve só o que é ObjectId válido: `remetenteId`/`destinatarioId` são String
 * no schema, e um valor fora do formato quebraria o cast do `$in`.
 */
async function idsComQuemJaConversei(meuId) {
    const [recebidos, enviados] = await Promise.all([
        ChatDireto.distinct('remetenteId', { destinatarioId: meuId }),
        ChatDireto.distinct('destinatarioId', { remetenteId: meuId }),
    ]);
    return [...new Set([...recebidos, ...enviados].map(String))].filter(
        (id) => id !== meuId && mongoose.Types.ObjectId.isValid(id)
    );
}

/**
 * GET /api/chat-direto/contatos — com quem esta pessoa pode conversar.
 *
 * POR QUE UM ENDPOINT PRÓPRIO (Issue #69)
 * ---------------------------------------
 * Sem ele, a tela de conversas teria de listar a escola inteira e descobrir a
 * permissão errando: mandar mensagem e ver se volta 403. Além de ruim de usar,
 * isso vaza a existência de contas que a pessoa não pode alcançar — para um
 * responsável, a lista de professores e de famílias da escola inteira.
 *
 * CONSISTÊNCIA COM `podeConversar` É A PARTE DELICADA
 * ---------------------------------------------------
 * Esta função responde "quem?" e `podeConversar` responde "este aqui, pode?".
 * São dois caminhos para a mesma regra, e regra duplicada é regra que diverge:
 * se a lista mostrar alguém que o envio recusa, a pessoa vê um contato que não
 * consegue usar — e o contrário é pior, um contato omitido que ela poderia ter.
 *
 * Elas não podem virar uma só: `podeConversar` faria uma consulta por candidato,
 * e são centenas numa escola média. Aqui os conjuntos são calculados UMA vez e
 * a filtragem acontece em memória. O que amarra as duas é o teste — para cada
 * pessoa da escola, esta lista tem de concordar com `podeConversar`.
 *
 * O que NÃO vem aqui: prévia da última mensagem. A página busca o histórico da
 * conversa que abrir; trazer a última mensagem de cada contato custaria uma
 * agregação a mais por um dado que a maior parte da lista não mostra.
 */
exports.listarContatos = async (req, res) => {
    try {
        const meuId = String(req.user?.id || req.user?._id || '');
        const meuPerfil = String(req.user?.perfil || '').toLowerCase();
        const meuEmail = String(req.user?.email || '').toLowerCase();
        const escolaId = req.escolaId ? String(req.escolaId) : null;

        // Falha FECHADA: sem escola resolvida não há como delimitar o tenant, e
        // listar "todo mundo" seria vazamento entre escolas.
        if (!escolaId) return res.json({ success: true, data: [] });

        // O admin NÃO está na MATRIZ_CONVERSA — `paresPermitidos` o libera à
        // parte, porque é o papel de suporte da rede. Sem este ramo,
        // `MATRIZ_CONVERSA['admin']` é `undefined`, `perfisAlcancaveis` nasce
        // vazio e a lista do próprio admin voltava sempre vazia.
        //
        // O `.filter` vale para os DOIS ramos, e não só para o de baixo: é ele
        // que tira 'responsavel' da lista do admin. O suporte da rede também
        // não fala com a família.
        const perfisAlcancaveis = (
            meuPerfil === 'admin'
                ? [...Object.keys(MATRIZ_CONVERSA)]
                : MATRIZ_CONVERSA[meuPerfil] || []
        ).filter((p) => paresPermitidos(meuPerfil, p));
        if (!perfisAlcancaveis.length) return res.json({ success: true, data: [] });

        // O outro lado do mesmo buraco, e o que fazia a mensagem do admin
        // "não chegar": 'admin' não aparece em nenhuma lista da matriz, então o
        // `perfil: { $in: perfisAlcancaveis }` lá embaixo descartava o admin da
        // lista de TODO MUNDO. O envio dele passava (`podeConversar` libera), a
        // mensagem era gravada e emitida pelo socket — mas o destinatário não
        // tinha por onde reabrir a conversa, e sumia no recarregar da página.
        //
        // Menos para o responsável: para ele o admin não é alcançável, então
        // acrescentá-lo aqui devolveria pelo histórico a porta que a matriz
        // fechou — inclusive as conversas com o suporte que já existiam.
        const alcancoOAdmin = paresPermitidos(meuPerfil, 'admin');
        if (alcancoOAdmin) perfisAlcancaveis.push('admin');

        const querResponsaveis = perfisAlcancaveis.includes('responsavel');

        // ── Equipe ────────────────────────────────────────────────────────
        // Vem das coleções de cargo, não de `Usuario.escolaId`: o vínculo de
        // escola de professor, diretor e secretaria mora em `vinculos[]`, e é
        // assim que o TeacherController já monta a lista da equipe. Filtrar por
        // `Usuario.escolaId` deixaria de fora quem tem o campo vazio.
        const escopoDeCargo = { 'vinculos.escolaId': escolaId };
        const [profs, dirs, secs] = await Promise.all([
            perfisAlcancaveis.includes('professor')
                ? Professor.find(escopoDeCargo).select('idUsuario').lean()
                : [],
            perfisAlcancaveis.includes('diretor')
                ? Diretor.find(escopoDeCargo).select('idUsuario').lean()
                : [],
            perfisAlcancaveis.includes('secretaria')
                ? // `escolaId` e `vinculos` vêm junto porque o responsável só
                  // alcança a secretaria da escola do filho dele — ver o bloco
                  // "Restrição do responsável" logo abaixo.
                  Secretaria.find(escopoDeCargo)
                      .select('idUsuario escolaId vinculos.escolaId')
                      .lean()
                : [],
        ]);

        // ── Restrição do responsável ──────────────────────────────────────
        // A matriz já reduziu a lista da família à secretaria; falta dizer QUAL
        // secretaria. É o mesmo recorte de `vinculoDeEscolaOk`, escrito do
        // outro lado: lá se pergunta "esta secretaria, pode?", aqui "quais?".
        //
        // Sem filho cadastrado, nenhuma — falha FECHADA, e é o `filtro`
        // devolvendo `false` para todas. Filho de cadastro legado, sem
        // `escolaId`, mantém a lista como está: o recorte por escola da sessão
        // já aconteceu no `escopoDeCargo` acima.
        let secretariaAlcancavel = () => true;
        if (meuPerfil === 'responsavel') {
            const { filhos, escolas } = await vinculoDoResponsavel(meuEmail);
            if (!filhos) {
                secretariaAlcancavel = () => false;
            } else if (escolas.size) {
                secretariaAlcancavel = (doc) =>
                    [doc.escolaId, ...(doc.vinculos || []).map((v) => v?.escolaId)].some(
                        (id) => id && escolas.has(String(id))
                    );
            }
        }

        const idsDaEquipe = new Set();
        for (const doc of [...profs, ...dirs]) {
            if (doc.idUsuario) idsDaEquipe.add(String(doc.idUsuario));
        }
        for (const doc of secs) {
            if (doc.idUsuario && secretariaAlcancavel(doc)) idsDaEquipe.add(String(doc.idUsuario));
        }

        // ── Responsáveis ──────────────────────────────────────────────────
        // O responsável não tem coleção de cargo: o que o liga à escola é o
        // filho. Quem chega aqui é só a secretaria (e o admin) — professor e
        // direção não alcançam a família pela matriz —, e ambos falam com todas
        // as famílias da escola por definição do papel.
        let emailsDeResponsaveis = new Set();
        if (querResponsaveis) {
            emailsDeResponsaveis = await emailsDeResponsaveisDaEscola(escolaId);
        }

        const criterios = [];
        if (idsDaEquipe.size) criterios.push({ _id: { $in: [...idsDaEquipe] } });
        if (emailsDeResponsaveis.size) {
            // Regex ancorada e sem caixa, e não um `$in` de strings: o campo
            // `Usuario.email` NÃO é normalizado para minúsculas no schema, e o
            // e-mail no cadastro do aluno é digitado à mão. Comparar literal
            // faria "Maria@escola.test" sumir da lista enquanto `podeConversar`
            // — que já usa regex sem caixa — continuaria liberando o envio: a
            // divergência entre listar e enviar que este endpoint existe para
            // não ter. As âncoras impedem `ana@x` de casar com `joana@x`.
            criterios.push({
                perfil: 'responsavel',
                email: {
                    $in: [...emailsDeResponsaveis].map(
                        (e) => new RegExp(`^${escapeRegex(e)}$`, 'i')
                    ),
                },
            });
        }
        // ── Admin (suporte da rede) ───────────────────────────────────────
        // O admin não tem coleção de cargo nem vínculo de escola: nenhum dos
        // critérios acima o alcança. Ele entra pelo HISTÓRICO — quem já trocou
        // mensagem com ele passa a vê-lo na lista, que é o que reabre a
        // conversa depois de recarregar a página.
        //
        // Por que não listar todos os admins da rede para todo mundo: o admin
        // atravessa escolas, então nem o tenant delimitaria essa lista, e ela
        // entregaria o time de suporte a toda família da rede. Quem nunca falou
        // com o admin não precisa saber que a conta existe.
        const jaConversei = alcancoOAdmin ? await idsComQuemJaConversei(meuId) : [];
        if (jaConversei.length) criterios.push({ perfil: 'admin', _id: { $in: jaConversei } });

        if (!criterios.length) return res.json({ success: true, data: [] });

        const candidatos = await Usuario.find({
            $or: criterios,
            _id: { $ne: meuId },
            perfil: { $in: perfisAlcancaveis },
            ativo: { $ne: false },
        })
            .select('nome perfil foto')
            .lean();

        // Não lidas numa agregação só, agrupada por remetente — mesmo padrão do
        // TeacherController. Uma consulta por contato viraria dezenas de idas ao
        // banco para montar uma tela.
        const naoLidas = await ChatDireto.aggregate([
            { $match: { destinatarioId: meuId, lida: false } },
            { $group: { _id: '$remetenteId', total: { $sum: 1 } } },
        ]);
        const naoLidasPorRemetente = new Map(
            naoLidas.map((linha) => [String(linha._id), linha.total])
        );

        const presence = require('../realtime/presence');
        const agora = new Date();

        const contatos = candidatos
            .map((usuario) => {
                const id = String(usuario._id);
                const info = presence.infoDe(escolaId, id);
                return {
                    id,
                    nome: usuario.nome,
                    perfil: usuario.perfil,
                    foto: usuario.foto || null,
                    presenca: {
                        status: info.status,
                        // Texto já pronto para a tela (Issue #70). O bruto vai
                        // junto para quem quiser formatar de outro jeito.
                        texto: formatarPresenca(info, agora),
                        ultimoAcesso: info.ultimoAcesso,
                    },
                    naoLidas: naoLidasPorRemetente.get(id) || 0,
                };
            })
            // Quem tem mensagem esperando vem primeiro, depois quem está online,
            // o resto em ordem alfabética. É a ordem de um mensageiro, e evita
            // obrigar a procurar na lista o que já está pendente.
            .sort((a, b) => {
                if (a.naoLidas !== b.naoLidas) return b.naoLidas - a.naoLidas;
                const aOnline = a.presenca.status !== 'offline';
                const bOnline = b.presenca.status !== 'offline';
                if (aOnline !== bOnline) return aOnline ? -1 : 1;
                return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
            });

        res.json({ success: true, data: contatos });
    } catch (error) {
        // A mensagem crua não vai para o cliente: ela carrega nome de campo e de
        // coleção. O log guarda o suficiente para investigar.
        logger.error('[chat] falha ao montar a lista de contatos', {
            err: error,
            action: 'chat.contatos',
        });
        res.status(500).json({ success: false, error: 'Não foi possível carregar seus contatos.' });
    }
};

/**
 * GET /api/chat-direto/nao-lidas — quantas mensagens esperam por mim.
 *
 * POR QUE NÃO REUSAR /contatos (Issue #72)
 * ----------------------------------------
 * A lista de contatos já traz `naoLidas` por pessoa, e somar no cliente daria
 * o mesmo número. Mas o selo do menu aparece em TODA página de TODO perfil, e
 * `/contatos` consulta quatro coleções (professores, diretores, secretaria e
 * alunos) para montar a lista. Pagar isso a cada carregamento de página, por
 * um número, seria trocar uma contagem indexada por uma varredura.
 *
 * Aqui é um `countDocuments` sobre `{destinatarioId, lida}` — que é o índice
 * que a própria conversa já usa.
 *
 * O QUE ELE CONTA
 * ---------------
 * Mensagens endereçadas a mim e ainda não lidas, ponto. Não filtra por
 * permissão atual de conversa: se um professor deixou de dar aula para a turma
 * do meu filho, a mensagem que ele já me mandou continua sendo uma mensagem
 * que eu recebi e não li. Esconder o selo faria a pessoa nunca descobrir que
 * havia algo ali — a conversa em si continua acessível pelo histórico.
 */
exports.contarNaoLidas = async (req, res) => {
    try {
        const meuId = String(req.user?.id || req.user?._id || '');
        if (!meuId) return res.json({ success: true, data: { total: 0 } });

        const meuPerfil = String(req.user?.perfil || '').toLowerCase();

        // O selo não pode contar o que a pessoa não pode abrir.
        //
        // Um `countDocuments` cru somava as conversas que a matriz fechou: o
        // responsável via "3 mensagens" no menu, clicava, e a tela não tinha
        // contato nenhum para mostrar — o número virava um erro sem explicação.
        // Pior no dia da mudança, quando toda família com histórico de professor
        // ganharia um selo que nunca zera.
        //
        // Agrupa por remetente e descarta os perfis inalcançáveis. O recorte é
        // por PERFIL, não pelo vínculo fino de `podeConversar`: são poucos
        // remetentes distintos, mas cada um custaria de uma a três consultas
        // num endpoint que a barra de menu chama a cada minuto. O que sobra é o
        // caso estreito da secretaria de outra escola — um número a mais num
        // selo, não uma conversa a mais.
        const porRemetente = await ChatDireto.aggregate([
            { $match: { destinatarioId: meuId, lida: false } },
            { $group: { _id: '$remetenteId', total: { $sum: 1 } } },
        ]);
        if (!porRemetente.length) return res.json({ success: true, data: { total: 0 } });

        const ids = porRemetente
            .map((linha) => String(linha._id))
            .filter((id) => mongoose.Types.ObjectId.isValid(id));
        const remetentes = await Usuario.find({ _id: { $in: ids } })
            .select('perfil')
            .lean();
        const perfilPorId = new Map(remetentes.map((u) => [String(u._id), u.perfil]));

        const total = porRemetente.reduce((soma, linha) => {
            const perfil = String(perfilPorId.get(String(linha._id)) || '').toLowerCase();
            // Remetente que não existe mais no banco não conta: sem perfil não
            // há como afirmar que a conversa é alcançável, e a falha é FECHADA.
            return perfil && paresPermitidos(meuPerfil, perfil) ? soma + linha.total : soma;
        }, 0);

        res.json({ success: true, data: { total } });
    } catch (error) {
        logger.error('[chat] falha ao contar mensagens não lidas', {
            err: error,
            action: 'chat.naoLidas',
        });
        // Um selo que não carrega não pode derrubar a página que o hospeda: o
        // chamador trata zero como "nada a mostrar" e a navegação segue.
        res.status(500).json({ success: false, error: 'Não foi possível contar as mensagens.' });
    }
};
