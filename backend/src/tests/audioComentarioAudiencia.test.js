/**
 * audioComentarioAudiencia.test.js — Issue #606
 *
 * O áudio de comentário (`voice_message`) era liberado a qualquer conta da
 * mesma escola — e, quando o arquivo não tinha escola no metadata (todos os
 * enviados antes de a rota gravá-la), a qualquer conta logada da rede. Agora
 * vale a regra de quem enxerga a conversa do comentário.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const Escola = require('../models/Escola');
const Comunicado = require('../models/Comunicado');
const Comentario = require('../models/Comentario');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escolaA;
let escolaB;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    const db = mongoose.connection.db;
    await Promise.all([
        db.collection('uploads.files').deleteMany({}),
        db.collection('uploads.chunks').deleteMany({}),
    ]);
    escolaA = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    escolaB = String((await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
});

/** Grava um áudio no bucket; `metadata` omitido simula os arquivos antigos. */
async function gravarAudio(metadata) {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: 'uploads',
    });
    const stream = bucket.openUploadStream(`audio_${Date.now()}_${Math.random()}.webm`, {
        contentType: 'audio/webm',
        metadata: { type: 'voice_message', ...metadata },
    });
    stream.end(Buffer.from('AUDIO-PRIVADO'));
    await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
    return String(stream.id);
}

/** Comunicado da escola A para `destinatarios`, com o áudio num comentário. */
async function publicar(audioId, destinatarios, { ativo = true, autorId } = {}) {
    const comunicado = await Comunicado.create({
        escolaId: escolaA,
        titulo: 'Aviso',
        conteudo: 'Aviso',
        destinatarios,
        ativo: true,
    });
    await Comentario.create({
        comunicadoId: comunicado._id,
        usuarioId: autorId || new mongoose.Types.ObjectId(),
        usuarioNome: 'Autor',
        audioUrl: `/api/audio/${audioId}`,
        ativo,
    });
}

const MODELO = { diretor: Diretor, professor: Professor };

/** Cookie de sessão de uma conta vinculada à escola dada. */
async function conta(perfil, escolaId) {
    const usuario = await criarUsuario({ perfil, escolaId });
    if (MODELO[perfil]) {
        await MODELO[perfil].create({
            idUsuario: String(usuario._id),
            nome: usuario.nome,
            email: usuario.email,
            vinculos: [{ escolaId, cargo: perfil }],
            ativo: true,
        });
    }
    return { usuario, cookie: [`escola_jwt=${assinarTokenSessao(usuario)}`] };
}

const ouvir = (cookie, id) => request(app).get(`/api/audio/${id}`).set('Cookie', cookie);

describe('áudio publicado segue a audiência do comunicado (Issue #606)', () => {
    // Arquivo com metadata (envio atual) e sem (envio antigo): mesma regra.
    const ARQUIVOS = [
        ['com metadata', () => ({ usuarioId: 'autor-x', escolaId: escolaA })],
        ['antigo, sem metadata', () => ({})],
    ];

    describe.each(ARQUIVOS)('arquivo %s', (_caso, metadata) => {
        it('professor ouve o áudio de comunicado para professores', async () => {
            const id = await gravarAudio(metadata());
            await publicar(id, ['professores']);
            const { cookie } = await conta('professor', escolaA);

            expect((await ouvir(cookie, id)).status).toBe(200);
        });

        it('responsável da mesma escola, fora da audiência, não ouve', async () => {
            const id = await gravarAudio(metadata());
            await publicar(id, ['professores']);
            const { cookie } = await conta('responsavel', escolaA);

            const res = await ouvir(cookie, id);
            expect(res.status).toBe(403);
            expect(res.text).not.toContain('AUDIO-PRIVADO');
        });

        it('direção ouve', async () => {
            const id = await gravarAudio(metadata());
            await publicar(id, ['professores']);
            const { cookie } = await conta('diretor', escolaA);

            expect((await ouvir(cookie, id)).status).toBe(200);
        });

        it('professor de outra escola não ouve', async () => {
            const id = await gravarAudio(metadata());
            await publicar(id, ['todos']);
            const { cookie } = await conta('professor', escolaB);

            expect((await ouvir(cookie, id)).status).toBe(403);
        });
    });
});

describe('áudio fora de comentário ativo fica com quem gravou', () => {
    it('quem gravou ouve antes de publicar', async () => {
        const { usuario, cookie } = await conta('responsavel', escolaA);
        const id = await gravarAudio({ usuarioId: String(usuario._id), escolaId: escolaA });

        expect((await ouvir(cookie, id)).status).toBe(200);
    });

    it('outra pessoa da escola não ouve áudio sem comentário', async () => {
        const id = await gravarAudio({ usuarioId: 'autor-x', escolaId: escolaA });
        const { cookie } = await conta('professor', escolaA);

        expect((await ouvir(cookie, id)).status).toBe(403);
    });

    it('comentário removido fecha o áudio para os outros', async () => {
        const id = await gravarAudio({ usuarioId: 'autor-x', escolaId: escolaA });
        await publicar(id, ['todos'], { ativo: false });
        const { cookie } = await conta('professor', escolaA);

        expect((await ouvir(cookie, id)).status).toBe(403);
    });

    it('autor do comentário ouve o próprio áudio antigo, sem metadata', async () => {
        const { usuario, cookie } = await conta('responsavel', escolaA);
        const id = await gravarAudio({});
        // Comunicado só para professores: o autor responsável não estaria na
        // audiência, mas o áudio é dele.
        await publicar(id, ['professores'], { autorId: usuario._id });

        expect((await ouvir(cookie, id)).status).toBe(200);
    });
});
