/**
 * chatDireto.moderacao.test.js
 * Barreiras de moderação do chat interno.
 *
 * O sistema de moderação de áudio/imagem ainda não existe (ver
 * docs/moderacao/ESPEC-MODERACAO-CHAT.md). O que existe — e é o que se testa
 * aqui — são as barreiras que ele vai acionar. Elas foram escritas ANTES de
 * propósito: se o histórico continua entregando o que o envio bloqueou, ou se
 * o encaminhamento distribui o que ficou retido, a moderação inteira é enfeite.
 *
 * As mensagens abaixo são marcadas à mão, simulando o que o moderador gravará.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const ChatDireto = require('../models/ChatDireto');

let escola;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({
        nome: 'CIEP Moderacao',
        tipo: 'CIEP',
        bairro: 'Centro',
        codigoSecreto: 'MOD-1',
        ativo: true,
    });
});

async function professorLogado(email) {
    const user = await criarUsuario({ email, perfil: 'professor', escolaId: String(escola._id) });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    const agent = request.agent(app);
    const login = await agent
        .post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    return { agent, user, id: String(user._id) };
}

/** Marca o veredito da moderação numa mensagem já gravada. */
function marcar(mensagemId, status, extras = {}) {
    return ChatDireto.updateOne(
        { _id: mensagemId },
        { $set: { 'moderacao.status': status, 'moderacao.analisadaEm': new Date(), ...extras } }
    );
}

/** PNG mínimo com assinatura válida (o upload confere os magic bytes). */
function pngValido() {
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(64, 0x20),
    ]);
}

async function subirImagem(agent, destinatarioId) {
    const res = await agent
        .post('/api/chat-direto/upload')
        .field('destinatarioId', destinatarioId)
        .attach('arquivos', pngValido(), { filename: 'foto.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    return res.body.data[0];
}

/** Marca o veredito no metadata do arquivo no GridFS. */
function marcarArquivo(gridfsId, status) {
    return mongoose.connection.db
        .collection('uploads.files')
        .updateOne(
            { _id: new mongoose.Types.ObjectId(String(gridfsId)) },
            { $set: { 'metadata.moderacao': { status, analisadaEm: new Date() } } }
        );
}

// ─────────────────────────────────────────────────────────
describe('GET /api/chat-direto/historico — mensagens não aprovadas', () => {
    it('esconde do destinatário a mensagem bloqueada, mas mostra ao remetente', async () => {
        const ana = await professorLogado('ana.mod@escola.test');
        const bruno = await professorLogado('bruno.mod@escola.test');

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Mensagem que será retida' });
        expect(envio.status).toBe(200);
        await marcar(envio.body.data._id, 'bloqueada', { 'moderacao.severidade': 'grave' });

        const doDestinatario = await bruno.agent.get(`/api/chat-direto/historico/${ana.id}`);
        expect(doDestinatario.status).toBe(200);
        expect(doDestinatario.body.data.map((m) => String(m._id))).not.toContain(
            String(envio.body.data._id)
        );

        // O remetente PRECISA continuar vendo: é assim que ele descobre que a
        // mensagem ficou retida e é dali que sai o botão de contestar.
        const doRemetente = await ana.agent.get(`/api/chat-direto/historico/${bruno.id}`);
        expect(doRemetente.status).toBe(200);
        const minha = doRemetente.body.data.find(
            (m) => String(m._id) === String(envio.body.data._id)
        );
        expect(minha).toBeDefined();
        expect(minha.moderacao.status).toBe('bloqueada');
    });

    it('esconde também o que está apenas em análise, não só o bloqueado', async () => {
        const ana = await professorLogado('ana2.mod@escola.test');
        const bruno = await professorLogado('bruno2.mod@escola.test');

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Aguardando decisão' });
        await marcar(envio.body.data._id, 'em_revisao');

        const res = await bruno.agent.get(`/api/chat-direto/historico/${ana.id}`);
        expect(res.body.data.map((m) => String(m._id))).not.toContain(String(envio.body.data._id));
    });

    it('entrega normalmente a mensagem aprovada', async () => {
        const ana = await professorLogado('ana3.mod@escola.test');
        const bruno = await professorLogado('bruno3.mod@escola.test');

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Reunião confirmada' });

        const res = await bruno.agent.get(`/api/chat-direto/historico/${ana.id}`);
        expect(res.body.data.map((m) => String(m._id))).toContain(String(envio.body.data._id));
    });

    it('não some com o histórico legado, que não tem o campo moderacao', async () => {
        const ana = await professorLogado('ana4.mod@escola.test');
        const bruno = await professorLogado('bruno4.mod@escola.test');

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Conversa anterior à moderação' });

        // O default do schema só vale para documento novo; as conversas que já
        // estão no banco não têm o campo. Sem o ramo `$exists: false` na query,
        // TODO o histórico anterior sumiria para o destinatário.
        await ChatDireto.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(String(envio.body.data._id)) },
            { $unset: { moderacao: '' } }
        );

        const res = await bruno.agent.get(`/api/chat-direto/historico/${ana.id}`);
        expect(res.body.data.map((m) => String(m._id))).toContain(String(envio.body.data._id));
    });
});

// ─────────────────────────────────────────────────────────
describe('GET /api/chat-direto/anexo/:id — quarentena', () => {
    it('devolve 409 ANEXO_EM_ANALISE enquanto o arquivo não foi decidido', async () => {
        const ana = await professorLogado('ana5.mod@escola.test');
        const bruno = await professorLogado('bruno5.mod@escola.test');

        const anexo = await subirImagem(ana.agent, bruno.id);
        await marcarArquivo(anexo.gridfsId, 'pendente');

        const res = await bruno.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(res.status).toBe(409);
        expect(res.body.codigo).toBe('ANEXO_EM_ANALISE');
    });

    it('devolve 403 ANEXO_BLOQUEADO quando o arquivo foi recusado', async () => {
        const ana = await professorLogado('ana6.mod@escola.test');
        const bruno = await professorLogado('bruno6.mod@escola.test');

        const anexo = await subirImagem(ana.agent, bruno.id);
        await marcarArquivo(anexo.gridfsId, 'bloqueado');

        const res = await bruno.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('ANEXO_BLOQUEADO');
    });

    it('responde igual ao remetente e ao destinatário — o veredito não vaza por diferença de resposta', async () => {
        const ana = await professorLogado('ana7.mod@escola.test');
        const bruno = await professorLogado('bruno7.mod@escola.test');

        const anexo = await subirImagem(ana.agent, bruno.id);
        await marcarArquivo(anexo.gridfsId, 'bloqueado');

        const doRemetente = await ana.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        const doDestinatario = await bruno.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);

        expect(doRemetente.status).toBe(doDestinatario.status);
        expect(doRemetente.body.codigo).toBe(doDestinatario.body.codigo);
    });

    it('continua servindo o anexo aprovado e o legado sem o campo', async () => {
        const ana = await professorLogado('ana8.mod@escola.test');
        const bruno = await professorLogado('bruno8.mod@escola.test');

        const legado = await subirImagem(ana.agent, bruno.id);
        const semCampo = await bruno.agent.get(`/api/chat-direto/anexo/${legado.gridfsId}`);
        expect(semCampo.status).toBe(200);

        const aprovado = await subirImagem(ana.agent, bruno.id);
        await marcarArquivo(aprovado.gridfsId, 'aprovada');
        const comCampo = await bruno.agent.get(`/api/chat-direto/anexo/${aprovado.gridfsId}`);
        expect(comCampo.status).toBe(200);
    });
});

// ─────────────────────────────────────────────────────────
describe('POST /api/chat-direto/encaminhar — conteúdo retido', () => {
    it('não encaminha mensagem bloqueada e avisa quantas ficaram de fora', async () => {
        const ana = await professorLogado('ana9.mod@escola.test');
        const bruno = await professorLogado('bruno9.mod@escola.test');
        const carla = await professorLogado('carla9.mod@escola.test');

        const ok = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Pode encaminhar' });
        const retida = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Não pode encaminhar' });
        await marcar(retida.body.data._id, 'bloqueada');

        const res = await ana.agent.post('/api/chat-direto/encaminhar').send({
            mensagemIds: [String(ok.body.data._id), String(retida.body.data._id)],
            destinatarioIds: [carla.id],
        });

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.ignoradas).toBe(1);
        expect(res.body.data[0].mensagem).toBe('Pode encaminhar');
    });

    it('recusa o encaminhamento quando TODAS as selecionadas estão retidas', async () => {
        const ana = await professorLogado('ana10.mod@escola.test');
        const bruno = await professorLogado('bruno10.mod@escola.test');
        const carla = await professorLogado('carla10.mod@escola.test');

        const retida = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Em análise' });
        await marcar(retida.body.data._id, 'em_revisao');

        const res = await ana.agent.post('/api/chat-direto/encaminhar').send({
            mensagemIds: [String(retida.body.data._id)],
            destinatarioIds: [carla.id],
        });

        expect(res.status).toBe(404);
    });
});

// ─────────────────────────────────────────────────────────
describe('POST /api/chat-direto/enviar — resposta de bloqueio no modo enxuto', () => {
    it('bloqueia o palavrão sem devolver o termo do dicionário nem o nível', async () => {
        const ana = await professorLogado('ana11.mod@escola.test');
        const bruno = await professorLogado('bruno11.mod@escola.test');

        const res = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'seu merda' });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('CONTEUDO_IMPROPRIO');

        // `trechos` fica: é o texto que o próprio usuário digitou e o front
        // precisa dele para grifar o que remover.
        expect(Array.isArray(res.body.detalhes.trechos)).toBe(true);

        // `termos` e `nivel` saem: diriam qual entrada do dicionário disparou e
        // onde está o limiar, encurtando a busca por uma grafia que escape.
        expect(res.body.detalhes.termos).toBeUndefined();
        expect(res.body.detalhes.nivel).toBeUndefined();
    });

    it('a mensagem bloqueada não chega ao banco', async () => {
        const ana = await professorLogado('ana12.mod@escola.test');
        const bruno = await professorLogado('bruno12.mod@escola.test');

        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'seu merda' });

        expect(await ChatDireto.countDocuments({ remetenteId: ana.id })).toBe(0);
    });
});
