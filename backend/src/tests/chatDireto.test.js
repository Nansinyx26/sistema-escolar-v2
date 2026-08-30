/**
 * chatDireto.test.js
 * Chat interno em tempo real: envio, anexos, autorização de download,
 * paginação, leitura em lote e encaminhamento.
 *
 * O foco são as fronteiras que já falharam de verdade:
 *   - anexo do chat precisa abrir para o DESTINATÁRIO (não só para quem enviou);
 *   - o cliente não pode injetar url/nome/tamanho arbitrários no anexo;
 *   - anexo encaminhado precisa abrir para o novo destinatário;
 *   - ninguém lê a conversa alheia nem cruza a fronteira da escola.
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
const Usuario = require('../models/Usuario');

let escolaA, escolaB;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({
        nome: 'CIEP Chat A',
        tipo: 'CIEP',
        bairro: 'Centro',
        codigoSecreto: 'CHAT-A-1',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'EMEF Chat B',
        tipo: 'EMEF',
        bairro: 'Norte',
        codigoSecreto: 'CHAT-B-2',
        ativo: true,
    });
});

/** Cria professor vinculado a uma escola e devolve { agent, user }. */
async function professorLogado(email, escola) {
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

/**
 * Assinaturas reais por mimetype. O upload valida os primeiros bytes
 * (utils/assinaturaArquivo.js), então um buffer de texto qualquer declarado
 * como PDF é recusado — como deve ser. As fixtures precisam ser plausíveis.
 */
const ASSINATURAS = {
    'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], // %PDF-1.7
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
    'audio/webm': [0x1a, 0x45, 0xdf, 0xa3],
    'video/webm': [0x1a, 0x45, 0xdf, 0xa3],
    'application/zip': [0x50, 0x4b, 0x03, 0x04],
    'application/msword': [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
        0x50, 0x4b, 0x03, 0x04,
    ],
};

/** Buffer com a assinatura correta do tipo, preenchido até `tamanho`. */
function arquivoValido(tipo, tamanho = 64) {
    const assinatura = ASSINATURAS[tipo];
    // Tipos de texto não têm assinatura: basta conteúdo textual de verdade.
    if (!assinatura) return Buffer.from('conteudo de texto para teste\n');
    const buf = Buffer.alloc(tamanho, 0x20);
    Buffer.from(assinatura).copy(buf, 0);
    return buf;
}

/**
 * Recua o `createdAt` da mensagem para simular passagem de tempo.
 *
 * Vai pelo driver bruto: o middleware de timestamps do Mongoose sobrescreve
 * `createdAt` num findByIdAndUpdate normal, e a mensagem continuaria "nova".
 */
async function envelhecer(mensagemId, msAtras) {
    await ChatDireto.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(String(mensagemId)) },
        { $set: { createdAt: new Date(Date.now() - msAtras) } }
    );
}

/** Sobe um arquivo pela rota do chat e devolve o objeto `anexo` do backend. */
async function subirAnexo(
    agent,
    destinatarioId,
    { nome = 'relatorio.pdf', tipo = 'application/pdf', conteudo = null } = {}
) {
    const buffer = conteudo ? Buffer.from(conteudo) : arquivoValido(tipo);
    const res = await agent
        .post('/api/chat-direto/upload')
        .field('destinatarioId', destinatarioId)
        .attach('arquivos', buffer, { filename: nome, contentType: tipo });
    expect(res.status).toBe(200);
    return res.body.data[0];
}

// ─────────────────────────────────────────────────────────
describe('POST /api/chat-direto/enviar', () => {
    it('entrega mensagem de texto entre professores da mesma escola', async () => {
        const ana = await professorLogado('ana@escola.test', escolaA);
        const bruno = await professorLogado('bruno@escola.test', escolaA);

        const res = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'Bom dia!' });

        expect(res.status).toBe(200);
        expect(res.body.data.mensagem).toBe('Bom dia!');
        expect(res.body.data.remetenteId).toBe(ana.id);
        expect(res.body.data.lida).toBe(false);
    });

    it('recusa mensagem para usuário de OUTRA escola (403)', async () => {
        const ana = await professorLogado('ana2@escola.test', escolaA);
        const forasteiro = await professorLogado('fora@escola.test', escolaB);

        const res = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: forasteiro.id, mensagem: 'oi' });

        expect(res.status).toBe(403);
    });

    it('exige conteúdo: sem texto, anexo ou áudio devolve 400', async () => {
        const ana = await professorLogado('ana3@escola.test', escolaA);
        const bruno = await professorLogado('bruno3@escola.test', escolaA);

        const res = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: '' });

        expect(res.status).toBe(400);
    });

    it('exige autenticação', async () => {
        const res = await request(app)
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: 'qualquer', mensagem: 'oi' });
        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────
describe('Anexo do chat — o cliente não dita os metadados', () => {
    it('reconstrói url/nome/tipo a partir do arquivo real, ignorando o que o cliente mandou', async () => {
        const ana = await professorLogado('ana4@escola.test', escolaA);
        const bruno = await professorLogado('bruno4@escola.test', escolaA);
        const anexo = await subirAnexo(ana.agent, bruno.id, { nome: 'ata.pdf' });

        const res = await ana.agent.post('/api/chat-direto/enviar').send({
            destinatarioId: bruno.id,
            mensagem: '',
            anexo: {
                gridfsId: anexo.gridfsId,
                url: 'https://site-malicioso.example/pwn', // deve ser descartada
                nome: 'nota-fiscal-legitima.pdf', // deve ser descartado
                tamanho: 999999999, // deve ser descartado
            },
        });

        expect(res.status).toBe(200);
        expect(res.body.data.anexo.url).toBe(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(res.body.data.anexo.nome).toBe('ata.pdf');
        expect(res.body.data.anexo.tipo).toBe('application/pdf');
        expect(res.body.data.anexo.tamanho).toBeLessThan(1000);
    });

    it('recusa anexo com gridfsId inexistente ou malformado (400)', async () => {
        const ana = await professorLogado('ana5@escola.test', escolaA);
        const bruno = await professorLogado('bruno5@escola.test', escolaA);

        const malformado = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, anexo: { gridfsId: 'nao-e-objectid' } });
        expect(malformado.status).toBe(400);

        const inexistente = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, anexo: { gridfsId: '507f1f77bcf86cd799439011' } });
        expect(inexistente.status).toBe(400);
    });

    it('recusa anexar arquivo que pertence a outra pessoa (400)', async () => {
        const ana = await professorLogado('ana6@escola.test', escolaA);
        const bruno = await professorLogado('bruno6@escola.test', escolaA);
        const carla = await professorLogado('carla6@escola.test', escolaA);

        // Ana sobe um arquivo; Carla tenta referenciá-lo numa mensagem dela.
        const anexoDaAna = await subirAnexo(ana.agent, bruno.id);

        const res = await carla.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, anexo: { gridfsId: anexoDaAna.gridfsId } });

        expect(res.status).toBe(400);
    });

    it('recusa upload de formato fora da lista branca (400)', async () => {
        const ana = await professorLogado('ana7@escola.test', escolaA);
        const bruno = await professorLogado('bruno7@escola.test', escolaA);

        const res = await ana.agent
            .post('/api/chat-direto/upload')
            .field('destinatarioId', bruno.id)
            .attach('arquivos', Buffer.from('MZ'), {
                filename: 'virus.exe',
                contentType: 'application/x-msdownload',
            });

        expect(res.status).toBe(400);
    });

    it('aceita os formatos que o documento comum rejeitava (áudio, Word, ZIP)', async () => {
        const ana = await professorLogado('ana8@escola.test', escolaA);
        const bruno = await professorLogado('bruno8@escola.test', escolaA);

        const audio = await subirAnexo(ana.agent, bruno.id, {
            nome: 'voz.webm',
            tipo: 'audio/webm',
        });
        expect(audio.tipo).toBe('audio/webm');

        const word = await subirAnexo(ana.agent, bruno.id, {
            nome: 'plano.docx',
            tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        expect(word.nome).toBe('plano.docx');

        const zip = await subirAnexo(ana.agent, bruno.id, {
            nome: 'fotos.zip',
            tipo: 'application/zip',
        });
        expect(zip.nome).toBe('fotos.zip');
    });
});

// ─────────────────────────────────────────────────────────
describe('GET /api/chat-direto/anexo/:id — quem pode baixar', () => {
    it('libera para o remetente E para o destinatário', async () => {
        const ana = await professorLogado('ana9@escola.test', escolaA);
        const bruno = await professorLogado('bruno9@escola.test', escolaA);
        const anexo = await subirAnexo(ana.agent, bruno.id);

        const doRemetente = await ana.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(doRemetente.status).toBe(200);

        // Era exatamente aqui que o destinatário tomava 403.
        const doDestinatario = await bruno.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(doDestinatario.status).toBe(200);
    });

    it('bloqueia terceiro que não participa da conversa (403)', async () => {
        const ana = await professorLogado('ana10@escola.test', escolaA);
        const bruno = await professorLogado('bruno10@escola.test', escolaA);
        const bisbilhoteiro = await professorLogado('xereta10@escola.test', escolaA);
        const anexo = await subirAnexo(ana.agent, bruno.id);

        const res = await bisbilhoteiro.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(res.status).toBe(403);
    });

    it('exige autenticação para baixar', async () => {
        const ana = await professorLogado('ana11@escola.test', escolaA);
        const bruno = await professorLogado('bruno11@escola.test', escolaA);
        const anexo = await subirAnexo(ana.agent, bruno.id);

        const res = await request(app).get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────
describe('GET /api/chat-direto/historico', () => {
    it('devolve só a conversa entre os dois, em ordem cronológica', async () => {
        const ana = await professorLogado('ana12@escola.test', escolaA);
        const bruno = await professorLogado('bruno12@escola.test', escolaA);
        const carla = await professorLogado('carla12@escola.test', escolaA);

        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'primeira' });
        await bruno.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: ana.id, mensagem: 'segunda' });
        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: carla.id, mensagem: 'outra conversa' });

        const res = await ana.agent.get(`/api/chat-direto/historico/${bruno.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.map((m) => m.mensagem)).toEqual(['primeira', 'segunda']);
    });

    it('pagina com hasMore e o cursor `before`', async () => {
        const ana = await professorLogado('ana13@escola.test', escolaA);
        const bruno = await professorLogado('bruno13@escola.test', escolaA);

        for (let i = 1; i <= 35; i++) {
            await ChatDireto.create({
                remetenteId: ana.id,
                destinatarioId: bruno.id,
                mensagem: `msg ${i}`,
                escolaId: String(escolaA._id),
                createdAt: new Date(Date.now() + i * 1000),
            });
        }

        const pagina1 = await ana.agent.get(`/api/chat-direto/historico/${bruno.id}`);
        expect(pagina1.body.data).toHaveLength(30);
        expect(pagina1.body.hasMore).toBe(true);

        const pagina2 = await ana.agent.get(
            `/api/chat-direto/historico/${bruno.id}?before=${encodeURIComponent(pagina1.body.cursor)}`
        );
        expect(pagina2.body.data).toHaveLength(5);
        expect(pagina2.body.hasMore).toBe(false);

        // Sem sobreposição entre as páginas
        const ids1 = pagina1.body.data.map((m) => m._id);
        expect(pagina2.body.data.every((m) => !ids1.includes(m._id))).toBe(true);
    });

    it('busca por termo mantém o recorte da conversa', async () => {
        const ana = await professorLogado('ana14@escola.test', escolaA);
        const bruno = await professorLogado('bruno14@escola.test', escolaA);
        const carla = await professorLogado('carla14@escola.test', escolaA);

        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'reunião de sexta' });
        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'almoço' });
        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: carla.id, mensagem: 'reunião com a Carla' });

        const res = await ana.agent.get(`/api/chat-direto/historico/${bruno.id}?search=reuni`);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].mensagem).toBe('reunião de sexta');
    });

    it('filtro de anexos devolve só mensagens com arquivo', async () => {
        const ana = await professorLogado('ana15@escola.test', escolaA);
        const bruno = await professorLogado('bruno15@escola.test', escolaA);

        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'só texto' });
        const anexo = await subirAnexo(ana.agent, bruno.id);
        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, anexo: { gridfsId: anexo.gridfsId } });

        const res = await ana.agent.get(`/api/chat-direto/historico/${bruno.id}?filter=anexos`);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].anexo.nome).toBe('relatorio.pdf');
    });

    it('não devolve a conversa de outras pessoas', async () => {
        const ana = await professorLogado('ana16@escola.test', escolaA);
        const bruno = await professorLogado('bruno16@escola.test', escolaA);
        const carla = await professorLogado('carla16@escola.test', escolaA);

        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'segredo' });

        // Carla pede o histórico "entre ela e Bruno" — a de Ana não pode vazar.
        const res = await carla.agent.get(`/api/chat-direto/historico/${bruno.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────
describe('PATCH /api/chat-direto/lidas/:outroUsuarioId', () => {
    it('marca a conversa inteira numa requisição só', async () => {
        const ana = await professorLogado('ana17@escola.test', escolaA);
        const bruno = await professorLogado('bruno17@escola.test', escolaA);

        for (let i = 0; i < 3; i++) {
            await ana.agent
                .post('/api/chat-direto/enviar')
                .send({ destinatarioId: bruno.id, mensagem: `m${i}` });
        }

        const res = await bruno.agent.patch(`/api/chat-direto/lidas/${ana.id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.atualizadas).toBe(3);

        const restantes = await ChatDireto.countDocuments({
            destinatarioId: bruno.id,
            lida: false,
        });
        expect(restantes).toBe(0);
    });

    it('não marca como lida mensagem enviada por mim', async () => {
        const ana = await professorLogado('ana18@escola.test', escolaA);
        const bruno = await professorLogado('bruno18@escola.test', escolaA);

        await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'oi' });

        // A própria Ana chamando não pode marcar a mensagem dela como lida.
        const res = await ana.agent.patch(`/api/chat-direto/lidas/${bruno.id}`);
        expect(res.body.data.atualizadas).toBe(0);

        const msg = await ChatDireto.findOne({ remetenteId: ana.id });
        expect(msg.lida).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────
describe('POST /api/chat-direto/encaminhar', () => {
    it('encaminha e o NOVO destinatário consegue baixar o anexo', async () => {
        const ana = await professorLogado('ana19@escola.test', escolaA);
        const bruno = await professorLogado('bruno19@escola.test', escolaA);
        const carla = await professorLogado('carla19@escola.test', escolaA);

        const anexo = await subirAnexo(ana.agent, bruno.id, { nome: 'circular.pdf' });
        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, anexo: { gridfsId: anexo.gridfsId } });

        // Carla ainda não participa dessa conversa.
        const antes = await carla.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(antes.status).toBe(403);

        const fwd = await ana.agent
            .post('/api/chat-direto/encaminhar')
            .send({ mensagemIds: [envio.body.data._id], destinatarioIds: [carla.id] });
        expect(fwd.status).toBe(200);
        expect(fwd.body.total).toBe(1);
        expect(fwd.body.data[0].encaminhada).toBe(true);

        // Depois do encaminhamento o anexo precisa abrir para ela.
        const depois = await carla.agent.get(`/api/chat-direto/anexo/${anexo.gridfsId}`);
        expect(depois.status).toBe(200);
    });

    it('não encaminha mensagem de conversa que não é minha (404)', async () => {
        const ana = await professorLogado('ana20@escola.test', escolaA);
        const bruno = await professorLogado('bruno20@escola.test', escolaA);
        const carla = await professorLogado('carla20@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'particular' });

        const res = await carla.agent
            .post('/api/chat-direto/encaminhar')
            .send({ mensagemIds: [envio.body.data._id], destinatarioIds: [bruno.id] });

        expect(res.status).toBe(404);
    });

    it('ignora destinatário de outra escola', async () => {
        const ana = await professorLogado('ana21@escola.test', escolaA);
        const bruno = await professorLogado('bruno21@escola.test', escolaA);
        const forasteiro = await professorLogado('fora21@escola.test', escolaB);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'interna' });

        const res = await ana.agent
            .post('/api/chat-direto/encaminhar')
            .send({ mensagemIds: [envio.body.data._id], destinatarioIds: [forasteiro.id] });

        expect(res.status).toBe(403);
        const vazou = await ChatDireto.countDocuments({ destinatarioId: forasteiro.id });
        expect(vazou).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────
describe('Editar e apagar', () => {
    it('só o autor edita a própria mensagem', async () => {
        const ana = await professorLogado('ana22@escola.test', escolaA);
        const bruno = await professorLogado('bruno22@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'origianl' });
        const id = envio.body.data._id;

        const alheia = await bruno.agent
            .put(`/api/chat-direto/mensagem/${id}`)
            .send({ novaMensagem: 'texto trocado' });
        expect(alheia.status).toBe(404);

        const propria = await ana.agent
            .put(`/api/chat-direto/mensagem/${id}`)
            .send({ novaMensagem: 'original' });
        expect(propria.status).toBe(200);
        expect(propria.body.data.mensagem).toBe('original');
        expect(propria.body.data.editada).toBe(true);
    });

    it('apagar para todos é privilégio do autor; para mim some só do meu lado', async () => {
        const ana = await professorLogado('ana23@escola.test', escolaA);
        const bruno = await professorLogado('bruno23@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'apagável' });
        const id = envio.body.data._id;

        const negado = await bruno.agent.delete(`/api/chat-direto/mensagem/${id}?tipo=para_todos`);
        expect(negado.status).toBe(403);

        // Bruno apaga só para ele: some do histórico dele, permanece no de Ana.
        const paraMim = await bruno.agent.delete(`/api/chat-direto/mensagem/${id}?tipo=para_mim`);
        expect(paraMim.status).toBe(200);

        const histBruno = await bruno.agent.get(`/api/chat-direto/historico/${ana.id}`);
        expect(histBruno.body.data).toHaveLength(0);

        const histAna = await ana.agent.get(`/api/chat-direto/historico/${bruno.id}`);
        expect(histAna.body.data).toHaveLength(1);
    });

    it('a matriz é lista branca: perfil desconhecido não conversa com ninguém', async () => {
        // Simula um perfil fora da MATRIZ_CONVERSA (ex.: enum ampliado no
        // futuro sem alguém decidir as permissões dele). A regra antiga, por
        // exclusão, liberaria; a lista branca nega.
        const ana = await professorLogado('ana28@escola.test', escolaA);
        const estranho = await Usuario.create({
            nome: 'Perfil Novo',
            email: 'novo28@escola.test',
            senha: 'x',
            perfil: 'professor',
            ativo: true,
            escolaId: String(escolaA._id),
            cpf: 'c28',
            telefone: 't',
        });
        // Força um perfil que não existe na matriz, direto no banco.
        await Usuario.collection.updateOne(
            { _id: estranho._id },
            { $set: { perfil: 'estagiario' } }
        );

        const res = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: String(estranho._id), mensagem: 'oi' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/não é permitido/i);
    });

    it('editar expira depois de 15 minutos', async () => {
        const ana = await professorLogado('ana25@escola.test', escolaA);
        const bruno = await professorLogado('bruno25@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'mensagem antiga' });
        const id = envio.body.data._id;

        // Envelhece a mensagem direto no banco: 16 minutos atrás.
        await envelhecer(id, 16 * 60 * 1000);

        const tardia = await ana.agent
            .put(`/api/chat-direto/mensagem/${id}`)
            .send({ novaMensagem: 'reescrevendo o passado' });
        expect(tardia.status).toBe(403);

        // O conteúdo original permanece intacto.
        const registro = await ChatDireto.findById(id).lean();
        expect(registro.mensagem).toBe('mensagem antiga');
        expect(registro.editada).toBe(false);
    });

    it('editar e apagar para todos entram na trilha de auditoria', async () => {
        const AuditLog = require('../models/AuditLog');
        const ana = await professorLogado('ana27@escola.test', escolaA);
        const bruno = await professorLogado('bruno27@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'texto original' });
        const id = envio.body.data._id;

        await ana.agent
            .put(`/api/chat-direto/mensagem/${id}`)
            .send({ novaMensagem: 'texto corrigido' });
        await ana.agent.delete(`/api/chat-direto/mensagem/${id}?tipo=para_todos`);

        const edicao = await AuditLog.findOne({
            acao: 'CHAT_EDIT_MESSAGE',
            recursoId: String(id),
        }).lean();
        expect(edicao).toBeTruthy();
        expect(edicao.detalhes.valorAnterior).toBe('texto original');
        expect(edicao.detalhes.valorNovo).toBe('texto corrigido');

        // O log guarda o que foi removido, não o placeholder.
        const exclusao = await AuditLog.findOne({
            acao: 'CHAT_DELETE_FOR_ALL',
            recursoId: String(id),
        }).lean();
        expect(exclusao).toBeTruthy();
        expect(exclusao.detalhes.valorAnterior).toBe('texto corrigido');
    });

    it('apagar para todos expira em 1 hora, mas apagar para mim continua valendo', async () => {
        const ana = await professorLogado('ana26@escola.test', escolaA);
        const bruno = await professorLogado('bruno26@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'faz tempo' });
        const id = envio.body.data._id;

        await envelhecer(id, 61 * 60 * 1000);

        const tardia = await ana.agent.delete(`/api/chat-direto/mensagem/${id}?tipo=para_todos`);
        expect(tardia.status).toBe(403);

        const registro = await ChatDireto.findById(id).lean();
        expect(registro.apagadaParaTodos).toBe(false);
        expect(registro.mensagem).toBe('faz tempo');

        // A saída que sobra para o autor não tem prazo.
        const paraMim = await ana.agent.delete(`/api/chat-direto/mensagem/${id}?tipo=para_mim`);
        expect(paraMim.status).toBe(200);
    });
});

// ─────────────────────────────────────────────────────────
describe('Reações', () => {
    it('adiciona, troca e remove a reação do usuário', async () => {
        const ana = await professorLogado('ana24@escola.test', escolaA);
        const bruno = await professorLogado('bruno24@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'reaja aqui' });
        const mensagemId = envio.body.data._id;

        const add = await bruno.agent
            .post('/api/chat-direto/reagir')
            .send({ mensagemId, emoji: '👍' });
        expect(add.body.data).toHaveLength(1);

        // Emoji diferente do mesmo usuário substitui, não acumula.
        const troca = await bruno.agent
            .post('/api/chat-direto/reagir')
            .send({ mensagemId, emoji: '❤️' });
        expect(troca.body.data).toHaveLength(1);
        expect(troca.body.data[0].emoji).toBe('❤️');

        const remove = await bruno.agent
            .post('/api/chat-direto/reagir')
            .send({ mensagemId, emoji: 'REMOVE' });
        expect(remove.body.data).toHaveLength(0);
    });

    it('quem não participa da conversa não reage (403)', async () => {
        const ana = await professorLogado('ana27@escola.test', escolaA);
        const bruno = await professorLogado('bruno27@escola.test', escolaA);
        const xereta = await professorLogado('xereta27@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'conversa privada' });

        const res = await xereta.agent
            .post('/api/chat-direto/reagir')
            .send({ mensagemId: envio.body.data._id, emoji: '😂' });

        expect(res.status).toBe(403);

        const msg = await ChatDireto.findById(envio.body.data._id);
        expect(msg.reacoes).toHaveLength(0);
    });
});

describe('Fronteira de quem participa da conversa', () => {
    it('estranho não consegue apagar mensagem alheia nem para si (403)', async () => {
        const ana = await professorLogado('ana28@escola.test', escolaA);
        const bruno = await professorLogado('bruno28@escola.test', escolaA);
        const xereta = await professorLogado('xereta28@escola.test', escolaA);

        const envio = await ana.agent
            .post('/api/chat-direto/enviar')
            .send({ destinatarioId: bruno.id, mensagem: 'não é da sua conta' });

        const res = await xereta.agent.delete(
            `/api/chat-direto/mensagem/${envio.body.data._id}?tipo=para_mim`
        );

        expect(res.status).toBe(403);

        const msg = await ChatDireto.findById(envio.body.data._id);
        expect(msg.apagadaPara).toHaveLength(0);
    });
});

// ─────────────────────────────────────────────────────────
describe('GET /api/chat-direto/presenca/:outroUsuarioId', () => {
    it('devolve o status do contato da mesma escola', async () => {
        const ana = await professorLogado('ana25@escola.test', escolaA);
        const bruno = await professorLogado('bruno25@escola.test', escolaA);

        const res = await ana.agent.get(`/api/chat-direto/presenca/${bruno.id}`);
        expect(res.status).toBe(200);
        // Sem socket conectado no teste, o esperado é offline.
        expect(res.body.data.status).toBe('offline');
        expect(res.body.data.online).toBe(false);
    });

    it('nega consulta de presença de usuário de outra escola (403)', async () => {
        const ana = await professorLogado('ana26@escola.test', escolaA);
        const forasteiro = await professorLogado('fora26@escola.test', escolaB);

        const res = await ana.agent.get(`/api/chat-direto/presenca/${forasteiro.id}`);
        expect(res.status).toBe(403);
    });
});
