/**
 * direitosAutorais.test.js — Issue #509, ponta a ponta.
 *
 * Upload recusado (catálogo e aviso embutido), bloqueio de um arquivo já
 * armazenado pelo id (download vira 451), cópias futuras barradas, liberação
 * pela direção e remoção do bloqueio.
 */
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    aceitarTermoAudioImagem,
    SENHA_TESTE,
} = require('./helpers');
const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');
const ObraProtegida = require('../models/ObraProtegida');
const {
    imagemObra,
    imagemDiferente,
    reduzida,
    comCopyrightExif,
    mp3,
} = require('./fixturas/midiaDireitosAutorais');

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
    escolaA = await Escola.create({
        nome: 'EMEF Escola A',
        tipo: 'EMEF',
        bairro: 'A',
        codigoSecreto: 'COD-DA-A',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'EMEF Escola B',
        tipo: 'EMEF',
        bairro: 'B',
        codigoSecreto: 'COD-DA-B',
        ativo: true,
    });
});

async function agentProfessor(email, escola) {
    const user = await criarUsuario({ email, perfil: 'professor', escolaId: String(escola._id) });
    await Professor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    await aceitarTermoAudioImagem(user._id);
    const agent = request.agent(app);
    const login = await agent
        .post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    return agent;
}

async function agentDiretor(email, escola) {
    const CODIGO_FIXO = '424242';
    const user = await criarUsuario({
        email,
        perfil: 'diretor',
        escolaId: String(escola._id),
        twoFactorFixedCode: await require('../utils/codigosBackup').hashSegredo(CODIGO_FIXO),
    });
    await Diretor.create({
        idUsuario: String(user._id),
        nome: user.nome,
        email,
        telefone: '(19) 90000-0000',
        vinculos: [{ escolaId: String(escola._id), cargo: 'diretor' }],
        ativo: true,
    });
    const agent = request.agent(app);
    const login = await agent
        .post('/api/auth/login')
        .send({ email, senha: SENHA_TESTE, escolaId: String(escola._id) });
    expect(login.status).toBe(200);
    const verify = await agent.post('/api/auth/2fa/verify').send({ codigo: CODIGO_FIXO });
    expect(verify.status).toBe(200);
    return agent;
}

const enviarFoto = (agent, buffer, nome = 'foto.jpg') =>
    agent
        .post('/api/upload/photo')
        .attach('foto', buffer, { filename: nome, contentType: 'image/jpeg' });

const enviarAudio = (agent, buffer, nome = 'faixa.mp3') =>
    agent
        .post('/api/audio/upload')
        .attach('audio', buffer, { filename: nome, contentType: 'audio/mpeg' });

describe('upload — aviso de direitos autorais embutido', () => {
    it('recusa com 451 a foto com Copyright no EXIF e aceita a sem aviso', async () => {
        const prof = await agentProfessor('prof.exif@escola.test', escolaA);
        const protegida = await comCopyrightExif(await imagemObra(), 'Banco de Imagens S.A.');

        const recusa = await enviarFoto(prof, protegida);
        expect(recusa.status).toBe(451);
        expect(recusa.body.codigo).toBe('DIREITOS_AUTORAIS');
        expect(recusa.body.error).toMatch(/Banco de Imagens S\.A\./);

        const ok = await enviarFoto(prof, await imagemObra());
        expect(ok.status).toBe(200);
    });

    it('recusa MP3 com TCOP até a direção liberar aquele arquivo', async () => {
        const prof = await agentProfessor('prof.tcop@escola.test', escolaA);
        const diretor = await agentDiretor('dir.tcop@escola.test', escolaA);
        const faixa = mp3({ quadros: { TIT2: 'Hino', TCOP: '2024 Gravadora Z' } });

        expect((await enviarAudio(prof, faixa)).status).toBe(451);

        const liberacao = await diretor
            .post('/api/direitos-autorais/obras')
            .field('acao', 'liberar')
            .field('titulo', 'Hino gravado pela escola')
            .attach('arquivo', faixa, { filename: 'hino.mp3', contentType: 'audio/mpeg' });
        expect(liberacao.status).toBe(201);
        expect(liberacao.body.data.acao).toBe('liberar');

        expect((await enviarAudio(prof, faixa)).status).toBe(201);
    });
});

describe('catálogo — obra cadastrada pela direção', () => {
    it('barra a mesma imagem reduzida/recomprimida e deixa passar outra', async () => {
        const diretor = await agentDiretor('dir.cat@escola.test', escolaA);
        const prof = await agentProfessor('prof.cat@escola.test', escolaA);
        const obra = await imagemObra();

        const cadastro = await diretor
            .post('/api/direitos-autorais/obras')
            .field('titulo', 'Ilustração do livro didático')
            .field('titular', 'Editora X')
            .attach('arquivo', obra, { filename: 'obra.jpg', contentType: 'image/jpeg' });
        expect(cadastro.status).toBe(201);

        const copia = await enviarFoto(prof, await reduzida(obra), 'copia.webp');
        expect(copia.status).toBe(451);
        expect(copia.body.error).toMatch(/Ilustração do livro didático/);

        expect((await enviarFoto(prof, await imagemDiferente())).status).toBe(200);
    });

    it('barra o áudio cadastrado mesmo re-etiquetado', async () => {
        const diretor = await agentDiretor('dir.aud@escola.test', escolaA);
        const prof = await agentProfessor('prof.aud@escola.test', escolaA);

        await diretor
            .post('/api/direitos-autorais/obras')
            .attach('arquivo', mp3({ quadros: { TIT2: 'Hit' } }), {
                filename: 'hit.mp3',
                contentType: 'audio/mpeg',
            })
            .expect(201);

        const reetiquetado = mp3({ quadros: { TIT2: 'Gravação da aula' } });
        expect((await enviarAudio(prof, reetiquetado)).status).toBe(451);
    });

    it('o catálogo de uma escola não alcança a outra', async () => {
        const diretorA = await agentDiretor('dir.a@escola.test', escolaA);
        const profB = await agentProfessor('prof.b@escola.test', escolaB);
        const obra = await imagemObra();

        await diretorA
            .post('/api/direitos-autorais/obras')
            .attach('arquivo', obra, { filename: 'obra.jpg', contentType: 'image/jpeg' })
            .expect(201);

        expect((await enviarFoto(profB, obra)).status).toBe(200);
    });

    it('professor não gerencia o catálogo', async () => {
        const prof = await agentProfessor('prof.sem@escola.test', escolaA);
        const res = await prof.get('/api/direitos-autorais/obras');
        expect(res.status).toBe(403);
    });
});

describe('bloqueio de arquivo já armazenado', () => {
    it('o arquivo passa a responder 451, cópias são barradas e a remoção devolve o acesso', async () => {
        const prof = await agentProfessor('prof.arq@escola.test', escolaA);
        const diretor = await agentDiretor('dir.arq@escola.test', escolaA);
        const original = await imagemObra();

        const envio = await enviarFoto(prof, original);
        expect(envio.status).toBe(200);
        const id = String(envio.body.data.id);
        expect((await prof.get(`/api/upload/photo/${id}`)).status).toBe(200);

        const bloqueio = await diretor
            .post(`/api/direitos-autorais/arquivos/${id}/bloquear`)
            .send({ titulo: 'Personagem de desenho', titular: 'Estúdio Y' });
        expect(bloqueio.status).toBe(201);
        expect(bloqueio.body.data.arquivosBloqueados).toBeGreaterThanOrEqual(1);

        const download = await prof.get(`/api/upload/photo/${id}`);
        expect(download.status).toBe(451);
        expect(download.body.codigo).toBe('DIREITOS_AUTORAIS');
        expect((await request(app).get(`/api/files/${id}`)).status).toBe(451);

        // O bloqueio usa a impressão do JPEG original, não a do WebP guardado.
        expect((await enviarFoto(prof, original)).status).toBe(451);

        const remocao = await diretor.delete(
            `/api/direitos-autorais/obras/${bloqueio.body.data.id}`
        );
        expect(remocao.status).toBe(200);
        expect((await prof.get(`/api/upload/photo/${id}`)).status).toBe(200);
        expect(await ObraProtegida.countDocuments({ ativo: true })).toBe(0);
    });

    it('bloqueia a mensagem de voz no /api/audio/:id', async () => {
        const prof = await agentProfessor('prof.voz@escola.test', escolaA);
        const diretor = await agentDiretor('dir.voz@escola.test', escolaA);

        const envio = await enviarAudio(prof, mp3({ semente: 9 }));
        expect(envio.status).toBe(201);
        const id = String(envio.body.data.id);

        await diretor.post(`/api/direitos-autorais/arquivos/${id}/bloquear`).send({}).expect(201);
        expect((await prof.get(`/api/audio/${id}`)).status).toBe(451);
    });

    it('diretor de outra escola recebe 404 no arquivo alheio', async () => {
        const prof = await agentProfessor('prof.alheio@escola.test', escolaA);
        const diretorB = await agentDiretor('dir.alheio@escola.test', escolaB);

        const envio = await enviarFoto(prof, await imagemObra());
        const res = await diretorB
            .post(`/api/direitos-autorais/arquivos/${envio.body.data.id}/bloquear`)
            .send({});
        expect(res.status).toBe(404);
        expect(await ObraProtegida.countDocuments()).toBe(0);
    });
});
