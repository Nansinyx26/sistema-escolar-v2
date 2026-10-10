/**
 * fotoAlunoNaoApagaArquivoAlheio.test.js — Issue #734
 *
 * O `foto` do aluno aceitava a referência `gridfs:<id>` de qualquer arquivo do
 * bucket, e a troca seguinte da foto apagava "a foto antiga" sem conferir de
 * quem era o arquivo. O professor da Escola A apagava, com dois PUT, o
 * documento de um aluno da Escola B que ele nem consegue baixar. Agora a
 * referência só vale se for a foto deste aluno, e só a foto deste aluno sai do
 * bucket na troca.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { SENHA_TESTE } = require('./helpers');

const PNG_BASE64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let escolaA;
let escolaB;
let alunoA;
let docB;
let prof;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

async function gravarArquivo(metadata) {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads',
    });
    const stream = bucket.openUploadStream(`arq_${Date.now()}`, {
        contentType: 'application/pdf',
        metadata,
    });
    stream.end(Buffer.from('%PDF-1.4 documento'));
    await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
    return String(stream.id);
}

async function existe(fileId) {
    return Boolean(
        await mongoose.connection.db
            .collection('uploads.files')
            .findOne({ _id: new mongoose.Types.ObjectId(String(fileId)) })
    );
}

const fotoGravada = async () => (await Aluno.findById(alunoA._id).lean()).foto;

beforeEach(async () => {
    await limparBanco();
    const db = mongoose.connection.db;
    await db.collection('uploads.files').deleteMany({});
    await db.collection('uploads.chunks').deleteMany({});
    escolaA = String((await Escola.create({ nome: 'EMEF A', tipo: 'EMEF', ativo: true }))._id);
    escolaB = String((await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', ativo: true }))._id);

    const alunoB = await Aluno.create({ nome: 'Aluno B', turma: '3B', escolaId: escolaB });
    docB = await gravarArquivo({
        type: 'documento_responsavel',
        alunoId: String(alunoB._id),
        escolaId: escolaB,
    });
    alunoA = await Aluno.create({ nome: 'Aluno A', turma: '1A', turmaId: '1A', escolaId: escolaA });

    const conta = await criarUsuario({
        email: 'prof.734@escola.test',
        perfil: 'professor',
        escolaId: escolaA,
    });
    await Professor.create({
        idUsuario: String(conta._id),
        nome: conta.nome,
        email: conta.email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: escolaA, cargo: 'professor' }],
        ativo: true,
    });
    prof = request.agent(app);
    const login = await prof
        .post('/api/auth/login')
        .send({ email: conta.email, senha: SENHA_TESTE, escolaId: escolaA });
    expect(login.status).toBe(200);
});

describe('referência a arquivo no campo foto', () => {
    it.each([
        ['gridfs:', (id) => `gridfs:${id}`],
        ['/api/files/', (id) => `/api/files/${id}`],
        ['/api/upload/photo/', (id) => `/api/upload/photo/${id}`],
        ['id cru', (id) => id],
    ])('PUT com o id de outro arquivo (%s) é recusado', async (_forma, montar) => {
        const res = await prof.put(`/api/alunos/${alunoA._id}`).send({ foto: montar(docB) });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('FOTO_DE_OUTRO_ARQUIVO');
        expect(await fotoGravada()).toBeUndefined();
    });

    it('POST de aluno novo com referência a arquivo é recusado', async () => {
        const res = await prof
            .post('/api/alunos')
            .send({ nome: 'Aluno Novo', turma: '1A', foto: `gridfs:${docB}` });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('FOTO_DE_OUTRO_ARQUIVO');
        expect(await Aluno.countDocuments({ nome: 'Aluno Novo' })).toBe(0);
    });
});

describe('troca de foto', () => {
    it('não apaga arquivo alheio que já estava gravado como foto', async () => {
        // Valor gravado antes da correção, quando a referência entrava sem conferência.
        await Aluno.updateOne({ _id: alunoA._id }, { $set: { foto: `gridfs:${docB}` } });

        const res = await prof.put(`/api/alunos/${alunoA._id}`).send({ foto: PNG_BASE64 });

        expect(res.status).toBe(200);
        expect(await existe(docB)).toBe(true);
        expect(await fotoGravada()).toMatch(/^gridfs:[a-f0-9]{24}$/);
    });

    it('a troca legítima apaga a foto antiga do próprio aluno', async () => {
        await prof.put(`/api/alunos/${alunoA._id}`).send({ foto: PNG_BASE64 }).expect(200);
        const primeira = (await fotoGravada()).slice('gridfs:'.length);
        expect(await existe(primeira)).toBe(true);

        await prof.put(`/api/alunos/${alunoA._id}`).send({ foto: PNG_BASE64 }).expect(200);

        expect(await existe(primeira)).toBe(false);
        expect(await existe(docB)).toBe(true);
    });

    it('devolver a foto atual na forma da listagem continua aceito', async () => {
        await prof.put(`/api/alunos/${alunoA._id}`).send({ foto: PNG_BASE64 }).expect(200);
        const atual = await fotoGravada();
        const id = atual.slice('gridfs:'.length);

        const res = await prof
            .put(`/api/alunos/${alunoA._id}`)
            .send({ foto: `/api/upload/photo/${id}`, nome: 'Aluno A Editado' });

        expect(res.status).toBe(200);
        expect(await existe(id)).toBe(true);
    });
});
