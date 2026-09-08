/**
 * fotoDeAlunoAutorizada.test.js — Issue #228
 *
 * `saveToGridFS()` gravava a foto do aluno SEM `metadata`. Como é o `metadata`
 * que `FileController.autorizarArquivo` consulta, a foto caía na regra dos
 * legados — "é `image/*`, então libera" — e qualquer autenticado da rede baixava
 * a foto de qualquer criança, bastando ter o id do arquivo.
 *
 * O que precisa ser verdade:
 *   1. foto nova nasce com `alunoId`/`escolaId`/`type: 'aluno_foto'`;
 *   2. o download passa por `assertAcessoAoAluno` — professor só da própria
 *      turma, responsável só do próprio filho, ninguém de outra escola;
 *   3. a rota pública nunca serve foto de aluno;
 *   4. a migração carimba o que já estava gravado, e é isso que fecha o buraco
 *      para o dado existente;
 *   5. o `update` não grava byte nenhum no bucket antes de autorizar.
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
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');

const migracao = require('../../migrations/1788566400000-carimbar-fotos-de-aluno');

/** PNG 1x1 de verdade — a rota reencoda com sharp antes de gravar. */
const PNG_BASE64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let escolaA;
let escolaB;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

/** `limparBanco()` não alcança o GridFS: as coleções do bucket são do driver. */
async function limparGridFS() {
    const db = mongoose.connection.db;
    await Promise.all([
        db.collection('uploads.files').deleteMany({}),
        db.collection('uploads.chunks').deleteMany({}),
    ]);
}

beforeEach(async () => {
    await limparBanco();
    await limparGridFS();
    escolaA = await Escola.create({
        nome: 'CIEP Escola A',
        tipo: 'CIEP',
        bairro: 'A',
        codigoSecreto: 'COD-A-228',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'EMEF Escola B',
        tipo: 'EMEF',
        bairro: 'B',
        codigoSecreto: 'COD-B-228',
        ativo: true,
    });
});

/** Grava um arquivo no bucket 'uploads' e devolve o ObjectId. */
async function gravarArquivo({ contentType = 'image/webp', metadata, conteudo = 'bytes' } = {}) {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads',
    });
    const stream = bucket.openUploadStream(`arq_${Date.now()}_${Math.random()}`, {
        contentType,
        metadata,
    });
    stream.end(Buffer.from(conteudo));
    await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
    return stream.id;
}

async function metadataDe(fileId) {
    const doc = await mongoose.connection.db
        .collection('uploads.files')
        .findOne({ _id: new mongoose.Types.ObjectId(String(fileId)) });
    return doc?.metadata || {};
}

/** Agent de professor com a turma informada como sala principal. */
async function agentProfessor(email, escola, sala) {
    const user = await criarUsuario({ email, perfil: 'professor', escolaId: String(escola._id) });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal: sala,
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    const agent = request.agent(app);
    const login = await agent
        .post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    return agent;
}

/** Agent de responsável (perfil sem 2FA obrigatório). */
async function agentResponsavel(email, escola) {
    await criarUsuario({ email, perfil: 'responsavel', escolaId: String(escola._id) });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(login.status).toBe(200);
    return agent;
}

describe('GET /api/upload/photo/:id — foto de aluno com metadata', () => {
    let aluno;
    let fotoId;

    beforeEach(async () => {
        aluno = await Aluno.create({
            nome: 'Criança Teste',
            turma: '1A',
            turmaId: '1A',
            escolaId: String(escolaA._id),
            responsavel: 'mae@escola.test',
        });
        fotoId = await gravarArquivo({
            metadata: {
                type: 'aluno_foto',
                alunoId: String(aluno._id),
                escolaId: String(escolaA._id),
            },
            conteudo: 'FOTO-DA-CRIANCA',
        });
    });

    it('professor da turma do aluno baixa a foto', async () => {
        const agent = await agentProfessor('prof1a@escola.test', escolaA, '1A');

        const res = await agent.get(`/api/upload/photo/${fotoId}`);

        expect(res.status).toBe(200);
        expect(res.body.toString()).toContain('FOTO-DA-CRIANCA');
    });

    it('professor de OUTRA turma da mesma escola recebe 403', async () => {
        // Este é o caso que a Issue descreve: antes, `image/*` sem metadata
        // liberava para qualquer autenticado — inclusive este professor.
        const agent = await agentProfessor('prof2b@escola.test', escolaA, '2B');

        const res = await agent.get(`/api/upload/photo/${fotoId}`);

        expect(res.status).toBe(403);
        expect(res.text).not.toContain('FOTO-DA-CRIANCA');
    });

    it('responsável de outro aluno recebe 403', async () => {
        const agent = await agentResponsavel('outro.pai@escola.test', escolaA);

        const res = await agent.get(`/api/upload/photo/${fotoId}`);

        expect(res.status).toBe(403);
        expect(res.text).not.toContain('FOTO-DA-CRIANCA');
    });

    it('responsável vinculado ao aluno baixa a foto', async () => {
        const agent = await agentResponsavel('mae@escola.test', escolaA);

        const res = await agent.get(`/api/upload/photo/${fotoId}`);

        expect(res.status).toBe(200);
        expect(res.body.toString()).toContain('FOTO-DA-CRIANCA');
    });

    it('professor de OUTRA escola recebe 403', async () => {
        const agent = await agentProfessor('prof.escolab@escola.test', escolaB, '1A');

        const res = await agent.get(`/api/upload/photo/${fotoId}`);

        expect(res.status).toBe(403);
        expect(res.text).not.toContain('FOTO-DA-CRIANCA');
    });

    it('a rota PÚBLICA nunca serve foto de aluno', async () => {
        const res = await request(app).get(`/api/files/${fotoId}`);

        expect(res.status).toBe(403);
        expect(res.text).not.toContain('FOTO-DA-CRIANCA');
    });
});

describe('migração: carimbar as fotos de aluno já gravadas', () => {
    it('carimba a foto legada e o professor de outra turma passa a receber 403', async () => {
        const fotoId = await gravarArquivo({ conteudo: 'FOTO-LEGADA' });
        const aluno = await Aluno.create({
            nome: 'Criança Legada',
            turma: '1A',
            turmaId: '1A',
            escolaId: String(escolaA._id),
            foto: `gridfs:${fotoId}`,
        });

        // ANTES: sem metadata, a regra de legado libera para qualquer autenticado.
        const intruso = await agentProfessor('intruso@escola.test', escolaA, '9Z');
        const antes = await intruso.get(`/api/upload/photo/${fotoId}`);
        expect(antes.status).toBe(200);

        const resultado = await migracao.up();
        expect(resultado.carimbados).toBe(1);

        const meta = await metadataDe(fotoId);
        expect(meta.type).toBe('aluno_foto');
        expect(meta.alunoId).toBe(String(aluno._id));
        expect(meta.escolaId).toBe(String(escolaA._id));

        // DEPOIS: mesma requisição, mesmo usuário, agora barrada.
        const depois = await intruso.get(`/api/upload/photo/${fotoId}`);
        expect(depois.status).toBe(403);
        expect(depois.text).not.toContain('FOTO-LEGADA');
    });

    it("sobrepõe o carimbo 'avatar' quando o arquivo também é foto de aluno", async () => {
        // A migração da #216 marca como avatar público todo arquivo referenciado
        // como `foto` de um adulto. Se o mesmo arquivo é foto de criança, a
        // privacidade da criança vence.
        const fotoId = await gravarArquivo({ metadata: { type: 'avatar' } });
        await Aluno.create({
            nome: 'Criança Dupla',
            turma: '1A',
            escolaId: String(escolaA._id),
            foto: `gridfs:${fotoId}`,
        });

        await migracao.up();

        expect((await metadataDe(fotoId)).type).toBe('aluno_foto');
        const res = await request(app).get(`/api/files/${fotoId}`);
        expect(res.status).toBe(403);
    });

    it('NÃO reescreve anexo de conversa nem áudio de comentário', async () => {
        const anexoId = await gravarArquivo({
            contentType: 'image/jpeg',
            metadata: { type: 'chat_anexo', usuarioId: 'a', destinatarioId: 'b' },
        });
        await Aluno.create({
            nome: 'Criança Com Anexo',
            turma: '1A',
            escolaId: String(escolaA._id),
            foto: `gridfs:${anexoId}`,
        });

        await migracao.up();

        expect((await metadataDe(anexoId)).type).toBe('chat_anexo');
    });

    it('é idempotente e não quebra em banco vazio', async () => {
        const vazio = await migracao.up();
        expect(vazio.carimbados).toBe(0);

        const fotoId = await gravarArquivo();
        await Aluno.create({
            nome: 'Criança Idempotente',
            turma: '1A',
            escolaId: String(escolaA._id),
            foto: `gridfs:${fotoId}`,
        });

        expect((await migracao.up()).carimbados).toBe(1);
        expect((await migracao.up()).carimbados).toBe(0);
    });

    it('`down` remove os três campos que ela escreveu', async () => {
        const fotoId = await gravarArquivo();
        await Aluno.create({
            nome: 'Criança Rollback',
            turma: '1A',
            escolaId: String(escolaA._id),
            foto: `gridfs:${fotoId}`,
        });

        await migracao.up();
        const resultado = await migracao.down();

        expect(resultado.revertidos).toBe(1);
        const meta = await metadataDe(fotoId);
        expect(meta.type).toBeUndefined();
        expect(meta.alunoId).toBeUndefined();
        expect(meta.escolaId).toBeUndefined();
    });
});

describe('escrita da foto pelo StudentController', () => {
    it('POST /api/alunos grava a foto já com alunoId e escolaId', async () => {
        const agent = await agentProfessor('prof.cria@escola.test', escolaA, '1A');

        const res = await agent
            .post('/api/alunos')
            .send({ nome: 'Aluno Novo', turma: '1A', foto: PNG_BASE64 });

        expect(res.status).toBe(201);
        const fotoSalva = String(res.body.data.foto || '');
        expect(fotoSalva.startsWith('gridfs:')).toBe(true);

        const meta = await metadataDe(fotoSalva.slice('gridfs:'.length));
        expect(meta.type).toBe('aluno_foto');
        expect(meta.alunoId).toBe(String(res.body.data._id));
        expect(meta.escolaId).toBe(String(escolaA._id));
    });

    it('PUT negado NÃO grava byte no bucket nem apaga a foto anterior', async () => {
        // O bloco de foto rodava ANTES de `assertAcessoAoAluno`: quem levava 403
        // já tinha gravado a imagem nova e apagado a antiga.
        const fotoAntigaId = await gravarArquivo({
            metadata: { type: 'aluno_foto', alunoId: 'x', escolaId: String(escolaA._id) },
            conteudo: 'FOTO-ORIGINAL',
        });
        const aluno = await Aluno.create({
            nome: 'Criança Protegida',
            turma: '1A',
            escolaId: String(escolaA._id),
            foto: `gridfs:${fotoAntigaId}`,
        });

        const intruso = await agentProfessor('intruso.put@escola.test', escolaA, '9Z');
        const res = await intruso.put(`/api/alunos/${aluno._id}`).send({ foto: PNG_BASE64 });

        expect(res.status).toBe(403);

        // A foto original continua no bucket e continua sendo a do aluno.
        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois.foto).toBe(`gridfs:${fotoAntigaId}`);
        expect(await metadataDe(fotoAntigaId)).toMatchObject({ type: 'aluno_foto' });

        // E nenhum arquivo novo entrou.
        const total = await mongoose.connection.db.collection('uploads.files').countDocuments();
        expect(total).toBe(1);
    });
});
