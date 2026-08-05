/**
 * idorAudioDiretores.test.js
 *
 * Regressão das três falhas de alta severidade da auditoria:
 *
 *   1. GET /api/audio/:id servia QUALQUER arquivo do bucket 'uploads' — o mesmo
 *      que guarda RG/CPF/comprovantes de aluno — a qualquer autenticado, sem
 *      passar pela autorização do FileController.
 *   2. PUT /api/diretores/:id aceitava req.body inteiro, sem dono e sem escola:
 *      dava para forjar `vinculos` e escalar para outra escola via
 *      POST /api/escolas/trocar.
 *   3. GET /api/diretores listava os diretores da rede inteira e transformava
 *      qualquer query param em filtro Mongo.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE } = require('./helpers');

const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');

let escolaA, escolaB;

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });

/**
 * `limparBanco()` NÃO alcança o GridFS: ela percorre
 * `mongoose.connection.collections`, que só contém coleções de models
 * registrados — e `uploads.files`/`uploads.chunks` são criadas pelo driver.
 * Sem esta limpeza os arquivos se acumulam por toda a execução da suíte.
 * Hoje isso não gera falso positivo (cada teste referencia o próprio
 * ObjectId), mas quebraria qualquer teste futuro que conte ou liste arquivos.
 */
async function limparGridFS() {
    const db = mongoose.connection.db;
    await Promise.all([
        db.collection('uploads.files').deleteMany({}),
        db.collection('uploads.chunks').deleteMany({})
    ]);
}

beforeEach(async () => {
    await limparBanco();
    await limparGridFS();
    escolaA = await Escola.create({
        nome: 'CIEP Escola A', tipo: 'CIEP', bairro: 'A', codigoSecreto: 'COD-A-1', ativo: true
    });
    escolaB = await Escola.create({
        nome: 'EMEF Escola B', tipo: 'EMEF', bairro: 'B', codigoSecreto: 'COD-B-2', ativo: true
    });
});

// ─────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────

/** Grava um arquivo no bucket 'uploads' e devolve o ObjectId. */
async function gravarArquivo({ contentType, metadata, conteudo = 'conteudo-de-teste' }) {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const stream = bucket.openUploadStream(`arq_${Date.now()}_${Math.random()}`, { contentType, metadata });
    stream.end(Buffer.from(conteudo));
    await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
    return stream.id;
}

/**
 * Corpo da resposta como texto, seja ela JSON ou binária.
 *
 * O superagent só preenche `res.text` para tipos textuais; uma resposta
 * `image/*` chega como Buffer em `res.body`. Sem isto, um
 * `expect(res.text).not.toContain(...)` passaria de graça justamente no caso
 * que interessa — o do arquivo vazando de verdade, que é binário.
 */
function corpoDe(res) {
    if (Buffer.isBuffer(res.body)) return res.body.toString();
    if (typeof res.text === 'string') return res.text;
    return JSON.stringify(res.body || {});
}

/**
 * Agent autenticado como responsável (perfil sem 2FA obrigatório) vinculado a
 * uma escola. Responsável é justamente o perfil de menor privilégio que
 * conseguia baixar o bucket inteiro pela rota de áudio.
 */
async function agentResponsavel(email, escola) {
    await criarUsuario({ email, perfil: 'responsavel', escolaId: String(escola._id) });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    expect(login.body.requires2FA).toBe(false);
    return agent;
}

/**
 * Agent autenticado como professor vinculado a uma escola.
 *
 * Diferente do responsável, o professor TEM vínculo — é o que faz
 * `filtrarPorEscola` resolver `req.escolaId` e, com isso, a fronteira de escola
 * do FileController poder ser aplicada. Ver a nota no teste cross-escola.
 */
async function agentProfessor(email, escola) {
    const user = await criarUsuario({ email, perfil: 'professor', escolaId: String(escola._id) });
    await Professor.create({
        idUsuario: String(user._id), nome: user.nome, email, salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }], ativo: true
    });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    return agent;
}

/**
 * Agent autenticado como diretor. Diretor tem 2FA OBRIGATÓRIO
 * (mustUse2FA no UserController), então o login é em duas etapas — usamos
 * `twoFactorFixedCode` para conhecer o código sem depender de e-mail.
 */
async function agentDiretor(email, escola, extraDiretor = {}) {
    const CODIGO_FIXO = '424242';
    const user = await criarUsuario({
        email, perfil: 'diretor', escolaId: String(escola._id), twoFactorFixedCode: CODIGO_FIXO
    });
    const diretor = await Diretor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        telefone: '(19) 90000-0000',
        vinculos: [{ escolaId: String(escola._id), cargo: 'diretor' }],
        ativo: true,
        ...extraDiretor
    });

    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    expect(login.body.requires2FA).toBe(true);

    const verify = await agent.post('/api/auth/2fa/verify').send({ codigo: CODIGO_FIXO });
    expect(verify.status).toBe(200);

    return { agent, user, diretor };
}

// ─────────────────────────────────────────────────────────
// 1. GET /api/audio/:id — IDOR no bucket de arquivos
// ─────────────────────────────────────────────────────────
describe('GET /api/audio/:id — não é porta dos fundos do bucket "uploads"', () => {
    it('NÃO entrega documento de aluno (PDF) pela rota de áudio', async () => {
        const alunoDocId = await gravarArquivo({
            contentType: 'application/pdf',
            metadata: { alunoId: 'aluno-qualquer', escolaId: String(escolaA._id) },
            conteudo: 'RG-DA-CRIANCA'
        });

        const agent = await agentResponsavel('curioso@escola.test', escolaA);
        const res = await agent.get(`/api/audio/${alunoDocId}`);

        // 404 e não 403: um 403 confirmaria a existência daquele id no bucket.
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('RG-DA-CRIANCA');
    });

    it('NÃO entrega foto/imagem de outro usuário pela rota de áudio', async () => {
        const fotoId = await gravarArquivo({
            contentType: 'image/webp',
            metadata: { usuarioId: 'outro-usuario-id', escolaId: String(escolaA._id) },
            conteudo: 'BYTES-DA-FOTO'
        });

        const agent = await agentResponsavel('curioso2@escola.test', escolaA);
        const res = await agent.get(`/api/audio/${fotoId}`);

        expect(res.status).toBe(404);
        expect(res.text).not.toContain('BYTES-DA-FOTO');
    });

    // Usa PROFESSOR, não responsável, de propósito: a fronteira de escola do
    // FileController só pode ser aplicada quando `req.escolaId` está resolvido,
    // e `filtrarPorEscola` só o resolve para quem tem vínculo (professor,
    // diretor, secretaria) ou quando existe uma única escola ativa. Um
    // responsável numa rede com 2+ escolas ativas fica SEM escolaId — lacuna
    // pré-existente da resolução de tenant, anotada no relatório.
    it('NÃO entrega mensagem de voz de OUTRA escola', async () => {
        const audioOutraEscola = await gravarArquivo({
            contentType: 'audio/webm',
            metadata: { usuarioId: 'alguem', escolaId: String(escolaB._id), type: 'voice_message' },
            conteudo: 'AUDIO-ESCOLA-B'
        });

        const agent = await agentProfessor('intruso@escola.test', escolaA);
        const res = await agent.get(`/api/audio/${audioOutraEscola}`);

        expect(res.status).toBe(403);
        expect(res.text).not.toContain('AUDIO-ESCOLA-B');
    });

    it('ENTREGA mensagem de voz da própria escola (o recurso segue funcionando)', async () => {
        const audioId = await gravarArquivo({
            contentType: 'audio/webm',
            metadata: { usuarioId: 'outro-membro', escolaId: String(escolaA._id), type: 'voice_message' },
            conteudo: 'AUDIO-LEGITIMO'
        });

        const agent = await agentResponsavel('ouvinte@escola.test', escolaA);
        const res = await agent.get(`/api/audio/${audioId}`);

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('audio/webm');
    });

    it('não deixa resposta autenticada em cache compartilhado', async () => {
        const audioId = await gravarArquivo({
            contentType: 'audio/webm',
            metadata: { usuarioId: 'x', escolaId: String(escolaA._id), type: 'voice_message' }
        });

        const agent = await agentResponsavel('cache@escola.test', escolaA);
        const res = await agent.get(`/api/audio/${audioId}`);

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('private');
        expect(res.headers['cache-control']).not.toContain('public');
    });
});

// ─────────────────────────────────────────────────────────
// 1b. GET /api/files/:id — a rota PÚBLICA de imagem
// ─────────────────────────────────────────────────────────
// `/api/files/:id` não tem authJWT (é o `src` das tags <img> de avatar) e
// barrava apenas o que não fosse `image/*` ou tivesse `metadata.alunoId`.
// A foto que um responsável manda dentro do chat é `image/jpeg` e não tem
// alunoId: saía inteira para qualquer um com o id, e ainda com
// `Cache-Control: public`. Aqui a fronteira é o `metadata.type`.
describe('GET /api/files/:id — rota pública não vaza arquivo de contexto privado', () => {
    it('NÃO entrega anexo de imagem do chat direto sem autenticação', async () => {
        const anexoId = await gravarArquivo({
            contentType: 'image/jpeg',
            metadata: {
                type: 'chat_anexo',
                usuarioId: 'remetente-id',
                destinatarioId: 'destinatario-id',
                escolaId: String(escolaA._id)
            },
            conteudo: 'FOTO-PRIVADA-DA-CONVERSA'
        });

        // Sem agent: requisição anônima, exatamente como um <img> de fora.
        const res = await request(app).get(`/api/files/${anexoId}`);

        expect(res.status).toBe(403);
        expect(corpoDe(res)).not.toContain('FOTO-PRIVADA-DA-CONVERSA');
    });

    it('NÃO entrega áudio/imagem de comentário (voice_message) sem autenticação', async () => {
        const vozId = await gravarArquivo({
            contentType: 'image/png',
            metadata: { type: 'voice_message', usuarioId: 'autor-id', escolaId: String(escolaA._id) },
            conteudo: 'ANEXO-DE-COMENTARIO'
        });

        const res = await request(app).get(`/api/files/${vozId}`);

        expect(res.status).toBe(403);
        expect(corpoDe(res)).not.toContain('ANEXO-DE-COMENTARIO');
    });

    it('CONTINUA entregando o avatar público (upload de foto grava metadata sem `type`)', async () => {
        const avatarId = await gravarArquivo({
            contentType: 'image/webp',
            metadata: { usuarioId: 'dono-do-avatar', escolaId: String(escolaA._id) },
            conteudo: 'BYTES-DO-AVATAR'
        });

        const res = await request(app).get(`/api/files/${avatarId}`);

        expect(res.status).toBe(200);
        // Resposta de imagem volta como Buffer em `res.body` (o superagent só
        // preenche `res.text` para tipos textuais) — as respostas 403 dos casos
        // acima são JSON e por isso aparecem em `res.text`.
        expect(corpoDe(res)).toContain('BYTES-DO-AVATAR');
    });

    it('a rota legada /api/public/photo/:id aplica a mesma regra', async () => {
        const anexoId = await gravarArquivo({
            contentType: 'image/jpeg',
            metadata: { type: 'chat_anexo', usuarioId: 'a', destinatarioId: 'b' },
            conteudo: 'FOTO-PRIVADA-LEGADA'
        });

        const res = await request(app).get(`/api/public/photo/${anexoId}`);

        expect(res.status).toBe(403);
        expect(corpoDe(res)).not.toContain('FOTO-PRIVADA-LEGADA');
    });
});

// ─────────────────────────────────────────────────────────
// 2. PUT /api/diretores/:id — escalada cross-tenant
// ─────────────────────────────────────────────────────────
describe('PUT /api/diretores/:id — mass assignment e escalada de escola', () => {
    it('NÃO deixa um diretor editar o cadastro de outro diretor', async () => {
        const { diretor: alvo } = await agentDiretor('alvo@escola.test', escolaA);
        const { agent } = await agentDiretor('atacante@escola.test', escolaA);

        const res = await agent.put(`/api/diretores/${alvo._id}`).send({ nome: 'Sequestrado' });

        expect(res.status).toBe(403);
        const depois = await Diretor.findById(alvo._id).lean();
        expect(depois.nome).not.toBe('Sequestrado');
    });

    it('IGNORA `vinculos` forjado no próprio cadastro (não escala para outra escola)', async () => {
        const { agent, diretor } = await agentDiretor('escalador@escola.test', escolaA);

        const res = await agent.put(`/api/diretores/${diretor._id}`).send({
            nome: 'Nome Novo',
            vinculos: [
                { escolaId: String(escolaA._id), cargo: 'diretor' },
                { escolaId: String(escolaB._id), cargo: 'diretor' }
            ]
        });

        expect(res.status).toBe(200);
        expect(res.body.data.nome).toBe('Nome Novo'); // campo próprio passa

        const depois = await Diretor.findById(diretor._id).lean();
        expect(depois.vinculos).toHaveLength(1);
        expect(String(depois.vinculos[0].escolaId)).toBe(String(escolaA._id));
    });

    it('a cadeia completa continua barrada: forjar vínculo NÃO libera a troca de escola', async () => {
        const { agent, diretor } = await agentDiretor('cadeia@escola.test', escolaA);

        await agent.put(`/api/diretores/${diretor._id}`).send({
            vinculos: [{ escolaId: String(escolaB._id), cargo: 'diretor' }]
        });

        const troca = await agent.post(`/api/escolas/trocar/${escolaB._id}`);
        expect(troca.status).toBe(403);
    });

    it('IGNORA campos de privilégio (`ativo`, `permissoes`, `role`, `email`)', async () => {
        const { agent, diretor } = await agentDiretor('privilegio@escola.test', escolaA);

        await agent.put(`/api/diretores/${diretor._id}`).send({
            ativo: false,
            role: 'superadmin',
            permissoes: ['tudo'],
            email: 'outro@escola.test'
        });

        const depois = await Diretor.findById(diretor._id).lean();
        expect(depois.ativo).toBe(true);
        expect(depois.role).toBe('director');
        expect(depois.email).toBe('privilegio@escola.test');
        expect(depois.permissoes || []).not.toContain('tudo');
    });

    it('PERMITE ao diretor editar os próprios campos descritivos', async () => {
        const { agent, diretor } = await agentDiretor('proprio@escola.test', escolaA);

        const res = await agent.put(`/api/diretores/${diretor._id}`)
            .send({ nome: 'Diretora Ana', telefone: '(19) 98888-7777', biografia: 'Bio nova', idade: 44 });

        expect(res.status).toBe(200);
        const depois = await Diretor.findById(diretor._id).lean();
        expect(depois.nome).toBe('Diretora Ana');
        expect(depois.telefone).toBe('(19) 98888-7777');
        expect(depois.biografia).toBe('Bio nova');
        expect(depois.idade).toBe(44);
    });
});

// ─────────────────────────────────────────────────────────
// 3. GET /api/diretores — vazamento de PII da rede inteira
// ─────────────────────────────────────────────────────────
describe('GET /api/diretores — escopo por escola e whitelist de filtros', () => {
    // NOTA: e-mails sempre em minúsculas nas fixtures — o login normaliza com
    // toLowerCase() e o cadastro não, então 'FulanoB@...' nunca casaria.
    it('lista apenas os diretores da escola ativa', async () => {
        await agentDiretor('outra.escola@escola.test', escolaB);
        const { agent } = await agentDiretor('minha.escola@escola.test', escolaA);

        const res = await agent.get('/api/diretores');

        expect(res.status).toBe(200);
        const emails = res.body.data.map(d => d.email);
        expect(emails).toContain('minha.escola@escola.test');
        expect(emails).not.toContain('outra.escola@escola.test');
    });

    it('ignora parâmetro de query fora da whitelist', async () => {
        const { agent } = await agentDiretor('filtro@escola.test', escolaA, { biografia: 'segredo' });

        // `biografia` não é filtro aceito: o parâmetro é descartado e a
        // listagem responde normalmente, em vez de virar consulta arbitrária.
        const res = await agent.get('/api/diretores?biografia=valor-que-nao-existe');

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].email).toBe('filtro@escola.test');
    });

    it('mantém o filtro por idUsuario usado pelo dashboard', async () => {
        const { agent, user } = await agentDiretor('dash@escola.test', escolaA);

        const res = await agent.get(`/api/diretores?idUsuario=${user._id}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].idUsuario).toBe(String(user._id));
    });
});
