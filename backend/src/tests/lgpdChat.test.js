/**
 * O chat interno é dado pessoal do titular: precisa sair na exportação da
 * LGPD e ter o conteúdo removido na anonimização. Antes o pacote de "meus
 * dados" trazia tudo MENOS as conversas, e anonimizar o cadastro deixava
 * intacto justamente o texto mais sensível (nomes de alunos, situações
 * familiares).
 */
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const ChatDireto = require('../models/ChatDireto');
const Usuario = require('../models/Usuario');

const MeusDadosController = require('../controllers/MeusDadosController');
const UserController = require('../controllers/UserController');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

function criarUsuario(nome, extra = {}) {
    return Usuario.create({
        nome,
        email: `${nome.toLowerCase().replace(/\s/g, '')}@t.com`,
        senha: 'x', perfil: 'professor', ativo: true,
        cpf: String(Math.random()), telefone: 't',
        ...extra
    });
}

/** Resposta de Express mínima para chamar o controller direto. */
function respostaFake() {
    const r = {
        statusCode: 200, corpo: null, headers: {},
        status(c) { this.statusCode = c; return this; },
        json(b) { this.corpo = b; return this; },
        setHeader(k, v) { this.headers[k] = v; }
    };
    return r;
}

function requisicaoFake(user) {
    return {
        user: { id: String(user._id), _id: String(user._id), nome: user.nome, email: user.email, perfil: user.perfil },
        body: {}, params: {}, headers: {}, ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' }
    };
}

describe('Exportação LGPD inclui o chat interno', () => {
    it('traz mensagens enviadas e recebidas, com o nome do interlocutor', async () => {
        const ana = await criarUsuario('Ana');
        const bruno = await criarUsuario('Bruno');

        await ChatDireto.create({ remetenteId: String(ana._id), destinatarioId: String(bruno._id), mensagem: 'bom dia' });
        await ChatDireto.create({ remetenteId: String(bruno._id), destinatarioId: String(ana._id), mensagem: 'bom dia, Ana' });

        const res = respostaFake();
        await MeusDadosController.exportarMeusDados(requisicaoFake(ana), res);

        const chat = res.corpo.chatInterno;
        expect(chat.total).toBe(2);

        const enviada = chat.mensagens.find((m) => m.direcao === 'enviada');
        const recebida = chat.mensagens.find((m) => m.direcao === 'recebida');
        expect(enviada.conteudo).toBe('bom dia');
        expect(enviada.interlocutor).toBe('Bruno');
        expect(recebida.conteudo).toBe('bom dia, Ana');
        expect(recebida.interlocutor).toBe('Bruno');
    });

    it('não exporta o que o titular apagou só para si', async () => {
        const ana = await criarUsuario('Ana');
        const bruno = await criarUsuario('Bruno');

        await ChatDireto.create({ remetenteId: String(bruno._id), destinatarioId: String(ana._id), mensagem: 'visível' });
        await ChatDireto.create({
            remetenteId: String(bruno._id), destinatarioId: String(ana._id),
            mensagem: 'apagada por mim', apagadaPara: [String(ana._id)]
        });

        const res = respostaFake();
        await MeusDadosController.exportarMeusDados(requisicaoFake(ana), res);

        expect(res.corpo.chatInterno.total).toBe(1);
        expect(res.corpo.chatInterno.mensagens[0].conteudo).toBe('visível');
    });

    it('não reexpõe o conteúdo de mensagem apagada para todos', async () => {
        const ana = await criarUsuario('Ana');
        const bruno = await criarUsuario('Bruno');

        await ChatDireto.create({
            remetenteId: String(ana._id), destinatarioId: String(bruno._id),
            mensagem: 'Esta mensagem foi apagada.', apagadaParaTodos: true
        });

        const res = respostaFake();
        await MeusDadosController.exportarMeusDados(requisicaoFake(ana), res);

        expect(res.corpo.chatInterno.mensagens[0].conteudo).toBe('[mensagem apagada]');
    });

    it('descreve anexo e áudio sem vazar a URL interna', async () => {
        const ana = await criarUsuario('Ana');
        const bruno = await criarUsuario('Bruno');

        await ChatDireto.create({
            remetenteId: String(ana._id), destinatarioId: String(bruno._id),
            mensagem: '', anexo: { nome: 'ata.pdf', url: '/api/chat-direto/anexo/123' }
        });

        const res = respostaFake();
        await MeusDadosController.exportarMeusDados(requisicaoFake(ana), res);

        const m = res.corpo.chatInterno.mensagens[0];
        expect(m.anexo).toBe('ata.pdf');
        expect(JSON.stringify(m)).not.toContain('/api/chat-direto/anexo/');
    });
});

describe('Anonimização remove o conteúdo das mensagens do titular', () => {
    it('apaga o texto do titular e preserva o do outro participante', async () => {
        const ana = await criarUsuario('Ana');
        const bruno = await criarUsuario('Bruno');

        const dela = await ChatDireto.create({
            remetenteId: String(ana._id), destinatarioId: String(bruno._id),
            mensagem: 'o aluno João faltou de novo'
        });
        const dele = await ChatDireto.create({
            remetenteId: String(bruno._id), destinatarioId: String(ana._id),
            mensagem: 'obrigado pelo aviso'
        });

        const req = requisicaoFake(ana);
        req.params = { id: String(ana._id) };
        const res = respostaFake();
        await UserController.anonymize(req, res);

        expect(res.corpo.success).toBe(true);
        expect(res.corpo.mensagensAnonimizadas).toBe(1);

        const anonimizada = await ChatDireto.findById(dela._id).lean();
        expect(anonimizada.mensagem).toBe('Mensagem removida a pedido do titular (LGPD).');
        expect(anonimizada.apagadaParaTodos).toBe(true);
        // O documento permanece: apagá-lo mutilaria a conversa do Bruno.
        expect(anonimizada._id).toBeTruthy();

        // A mensagem do outro participante não é tocada.
        const intacta = await ChatDireto.findById(dele._id).lean();
        expect(intacta.mensagem).toBe('obrigado pelo aviso');
    });

    it('remove também os anexos e áudios enviados pelo titular', async () => {
        const ana = await criarUsuario('Ana');
        const bruno = await criarUsuario('Bruno');

        const comAnexo = await ChatDireto.create({
            remetenteId: String(ana._id), destinatarioId: String(bruno._id),
            mensagem: '', anexo: { nome: 'laudo.pdf', gridfsId: 'abc' },
            audio: { url: '/api/chat-direto/anexo/xyz', duracao: 12 }
        });

        const req = requisicaoFake(ana);
        req.params = { id: String(ana._id) };
        await UserController.anonymize(req, respostaFake());

        const depois = await ChatDireto.findById(comAnexo._id).lean();
        expect(depois.anexo).toBeUndefined();
        expect(depois.audio).toBeUndefined();
    });
});
