/**
 * avataresCarimbados.test.js — Issue #216
 *
 * A rota pública `GET /api/files/:id` deixou de ser aberta por omissão: agora só
 * serve sem sessão o arquivo cujo `metadata.type` está na allowlist do
 * `FileController` (hoje, só `'avatar'`).
 *
 * Sozinha, essa inversão apagaria a foto de perfil de quem já tinha uma — os
 * avatares no bucket foram gravados por `saveToGridFS()`, que não escreve
 * metadata nenhum. A migração `1788480000000-carimbar-avatares-publicos`
 * existe para fechar essa distância, e é ela que estes testes exercitam.
 *
 * O que precisa ser verdade:
 *   1. avatar legado (referenciado como `foto` de um adulto) é carimbado e
 *      volta a carregar sem sessão;
 *   2. foto de ALUNO não é carimbada — foto de criança não é avatar público;
 *   3. arquivo órfão não é carimbado — ninguém aponta para ele;
 *   4. arquivo já carimbado com outro tipo não é reescrito;
 *   5. rodar de novo não muda mais nada (idempotência).
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');

const migracao = require('../../migrations/1788480000000-carimbar-avatares-publicos');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

/**
 * `limparBanco()` não alcança o GridFS: ela percorre
 * `mongoose.connection.collections`, que só tem as coleções de models
 * registrados — `uploads.files`/`uploads.chunks` são criadas pelo driver.
 */
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

/** Lê o `metadata` gravado de um arquivo do bucket. */
async function metadataDe(fileId) {
    const doc = await mongoose.connection.db
        .collection('uploads.files')
        .findOne({ _id: new mongoose.Types.ObjectId(String(fileId)) });
    return doc?.metadata || {};
}

describe("migração: carimbar metadata.type='avatar' nos avatares existentes", () => {
    it('carimba o avatar legado de um usuário e ele volta a sair sem sessão', async () => {
        const avatarId = await gravarArquivo({ conteudo: 'BYTES-DO-AVATAR-LEGADO' });
        // Formato exato que `scripts/migrate-base64-photos-to-gridfs.js` grava.
        await criarUsuario({ foto: `gridfs:${avatarId}` });

        // Antes: sem `type`, a rota pública recusa.
        const antes = await request(app).get(`/api/files/${avatarId}`);
        expect(antes.status).toBe(403);

        await migracao.up();

        expect((await metadataDe(avatarId)).type).toBe('avatar');

        const depois = await request(app).get(`/api/files/${avatarId}`);
        expect(depois.status).toBe(200);
        expect(depois.body.toString()).toContain('BYTES-DO-AVATAR-LEGADO');
    });

    it('alcança as demais coleções de pessoa adulta (professores)', async () => {
        const avatarId = await gravarArquivo();
        const usuario = await criarUsuario();
        await Professor.create({
            idUsuario: String(usuario._id),
            nome: 'Professora Foto',
            email: usuario.email,
            salaPrincipal: '1A',
            foto: `gridfs:${avatarId}`,
            ativo: true,
        });

        await migracao.up();

        expect((await metadataDe(avatarId)).type).toBe('avatar');
    });

    it('resolve a foto guardada como URL de rota, e não só como `gridfs:<id>`', async () => {
        const porRota = await gravarArquivo();
        const porId = await gravarArquivo();
        await criarUsuario({ foto: `/api/upload/photo/${porRota}` });
        await criarUsuario({ foto: String(porId) });

        await migracao.up();

        expect((await metadataDe(porRota)).type).toBe('avatar');
        expect((await metadataDe(porId)).type).toBe('avatar');
    });

    it('NÃO carimba foto de aluno — foto de criança não é avatar público', async () => {
        const fotoAlunoId = await gravarArquivo({ conteudo: 'FOTO-DE-CRIANCA' });
        await Aluno.create({ nome: 'Criança Teste', foto: `gridfs:${fotoAlunoId}` });

        await migracao.up();

        expect((await metadataDe(fotoAlunoId)).type).toBeUndefined();

        const res = await request(app).get(`/api/files/${fotoAlunoId}`);
        expect(res.status).toBe(403);
    });

    it('NÃO carimba arquivo órfão — nenhuma tela aponta para ele', async () => {
        const orfaoId = await gravarArquivo({ conteudo: 'ARQUIVO-SEM-DONO' });

        await migracao.up();

        expect((await metadataDe(orfaoId)).type).toBeUndefined();
        const res = await request(app).get(`/api/files/${orfaoId}`);
        expect(res.status).toBe(403);
    });

    it('NÃO reescreve o `type` de um arquivo já carimbado', async () => {
        // Cenário real: o anexo de uma conversa é referenciado como foto de
        // perfil (por engano ou de propósito). Ele continua sendo `chat_anexo`.
        const anexoId = await gravarArquivo({
            contentType: 'image/jpeg',
            metadata: { type: 'chat_anexo', usuarioId: 'a', destinatarioId: 'b' },
            conteudo: 'ANEXO-PRIVADO',
        });
        await criarUsuario({ foto: `gridfs:${anexoId}` });

        await migracao.up();

        expect((await metadataDe(anexoId)).type).toBe('chat_anexo');
        const res = await request(app).get(`/api/files/${anexoId}`);
        expect(res.status).toBe(403);
    });

    it('é idempotente: a segunda execução não carimba mais nada', async () => {
        const avatarId = await gravarArquivo();
        await criarUsuario({ foto: `gridfs:${avatarId}` });

        const primeira = await migracao.up();
        const segunda = await migracao.up();

        expect(primeira.carimbados).toBe(1);
        expect(segunda.carimbados).toBe(0);
        expect((await metadataDe(avatarId)).type).toBe('avatar');
    });

    it('não quebra em base de banco vazio', async () => {
        const resultado = await migracao.up();
        expect(resultado.carimbados).toBe(0);
    });

    it('`down` devolve o arquivo ao estado sem `type`', async () => {
        const avatarId = await gravarArquivo();
        await criarUsuario({ foto: `gridfs:${avatarId}` });

        await migracao.up();
        const resultado = await migracao.down();

        expect(resultado.revertidos).toBe(1);
        expect((await metadataDe(avatarId)).type).toBeUndefined();
    });
});

describe('POST /api/upload/photo carimba o tipo no upload novo', () => {
    it('o avatar recém-enviado já sai pela rota pública, sem depender de migração', async () => {
        const Escola = require('../models/Escola');
        const { SENHA_TESTE } = require('./helpers');

        const escola = await Escola.create({
            nome: 'CIEP Avatar',
            tipo: 'CIEP',
            bairro: 'Centro',
            codigoSecreto: 'COD-AVT-1',
            ativo: true,
        });
        const email = `avatar_${Date.now()}@escola.test`;
        await criarUsuario({ email, perfil: 'responsavel', escolaId: String(escola._id) });

        const agent = request.agent(app);
        const login = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
        expect(login.status).toBe(200);

        // PNG 1x1 de verdade: a rota reencoda com sharp antes de gravar.
        const png = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            'base64'
        );
        const envio = await agent.post('/api/upload/photo').attach('foto', png, 'avatar.png');
        expect(envio.status).toBe(200);

        const fileId = envio.body.data.id;
        expect((await metadataDe(fileId)).type).toBe('avatar');

        // Sem agent: requisição anônima, como o <img> de um avatar.
        const res = await request(app).get(`/api/files/${fileId}`);
        expect(res.status).toBe(200);
    });
});
