/**
 * documentosResponsaveis.test.js
 * Testes para upload, listagem, substituição e permissões de documentos assinados.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const Aluno = require('../models/Aluno');
const DocumentoResponsavel = require('../models/DocumentoResponsavel');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => {
    await conectarBanco();
});

afterEach(async () => {
    await limparBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

function gerarCookieAuth(user) {
    const token = jwt.sign(
        {
            id: user._id.toString(),
            perfil: user.perfil,
            email: user.email,
            nome: user.nome,
            escolaId: user.escolaId,
            purpose: 'session',
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

describe('Documentos Assinados dos Responsáveis (/api/documentos-responsaveis)', () => {
    const escolaId = 'escola-teste-doc-123';

    // Buffer de um PDF válido com magic bytes %PDF-
    const pdfValido = Buffer.from(
        '%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 2\n0000000000 65535 f\n0000000018 00000 n\ntrailer<</Size 2/Root 1 0 R>>\nstartxref\n70\n%%EOF'
    );

    it('deve rejeitar acesso sem autenticação (401)', async () => {
        const res = await request(app).get('/api/documentos-responsaveis');

        expect(res.status).toBe(401);
    });

    it('deve negar acesso para professores com HTTP 403', async () => {
        const prof = await criarUsuario({
            perfil: 'professor',
            email: 'prof.doc@escola.test',
            escolaId,
        });
        const cookie = gerarCookieAuth(prof);

        const res = await request(app).get('/api/documentos-responsaveis').set('Cookie', cookie);

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
    });

    it('responsável deve enviar documento assinado vinculado ao aluno com sucesso', async () => {
        const resp = await criarUsuario({
            perfil: 'responsavel',
            email: 'mae.doc@escola.test',
            escolaId,
        });
        const cookie = gerarCookieAuth(resp);

        const aluno = await Aluno.create({
            nome: 'Lucas Gabriel',
            sobrenome: 'Souza Silva',
            turma: '5ºA',
            turmaId: '5A',
            matricula: '2024001',
            ativo: true,
            escolaId,
            responsaveis: [{ email: 'mae.doc@escola.test', nome: 'Mariana Souza' }],
        });

        // Atualiza vínculo do responsável com o aluno
        resp.alunoIds = [aluno._id.toString()];
        await resp.save();

        const res = await request(app)
            .post('/api/documentos-responsaveis')
            .set('Cookie', cookie)
            .field('alunoId', aluno._id.toString())
            .field('tipoDocumento', 'Autorização de Imagem')
            .field('nomeDocumento', 'Autorização de Imagem Assinada')
            .attach('arquivo', pdfValido, {
                filename: 'termo_imagem.pdf',
                contentType: 'application/pdf',
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
        expect(res.body.data.tipoDocumento).toBe('Autorização de Imagem');
        expect(res.body.data.status).toBe('Enviado');
        expect(res.body.data.arquivo.nomeOriginal).toBe('termo_imagem.pdf');
        expect(res.body.data.alunoId.toString()).toBe(aluno._id.toString());
        expect(res.body.data.responsavelId.toString()).toBe(resp._id.toString());
    });

    it('deve rejeitar arquivo executável disfarçado de PDF (validação de magic bytes)', async () => {
        const resp = await criarUsuario({
            perfil: 'responsavel',
            email: 'hacker.doc@escola.test',
            escolaId,
        });
        const cookie = gerarCookieAuth(resp);

        const aluno = await Aluno.create({
            nome: 'Aluno Teste',
            turma: '1A',
            ativo: true,
            escolaId,
            responsaveis: [{ email: 'hacker.doc@escola.test', nome: 'Hacker Teste' }],
        });

        resp.alunoIds = [aluno._id.toString()];
        await resp.save();

        // Conteúdo malicioso (MZ executável do Windows)
        const fakePdf = Buffer.from('MZP\x00\x02\x00\x00\x00\x04\x00\x0f\x00\xff\xff');

        const res = await request(app)
            .post('/api/documentos-responsaveis')
            .set('Cookie', cookie)
            .field('alunoId', aluno._id.toString())
            .field('tipoDocumento', 'Outro')
            .field('nomeDocumento', 'Documento Suspeito')
            .attach('arquivo', fakePdf, { filename: 'virus.pdf', contentType: 'application/pdf' });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/rejeitado|executável|não permitido|assinatura binária/i);
    });

    it('secretaria e diretor podem listar documentos da escola com filtros', async () => {
        const secretaria = await criarUsuario({
            perfil: 'secretaria',
            email: 'sec.doc@escola.test',
            escolaId,
        });
        const cookieSec = gerarCookieAuth(secretaria);

        const aluno = await Aluno.create({
            nome: 'Isabela Ferreira',
            turma: '3ºA',
            turmaId: '3A',
            ativo: true,
            escolaId,
        });

        const resp = await criarUsuario({
            perfil: 'responsavel',
            email: 'pai.doc@escola.test',
            escolaId,
        });

        await DocumentoResponsavel.create({
            escolaId,
            alunoId: aluno._id,
            responsavelId: resp._id,
            turmaId: '3A',
            tipoDocumento: 'Autorização de Passeio',
            nomeDocumento: 'Passeio Museu Assinado',
            arquivo: {
                nomeOriginal: 'passeio.pdf',
                url: '/api/documentos-responsaveis/mock/download',
                storageId: 'mock-storage-id',
                mimeType: 'application/pdf',
                tamanho: 1024,
            },
            status: 'Enviado',
        });

        const res = await request(app)
            .get('/api/documentos-responsaveis?tipoDocumento=Autorização de Passeio')
            .set('Cookie', cookieSec);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].nomeDocumento).toBe('Passeio Museu Assinado');
    });

    it('secretaria e diretor podem atualizar o status do documento', async () => {
        const diretor = await criarUsuario({
            perfil: 'diretor',
            email: 'dir.doc@escola.test',
            escolaId,
        });
        const cookieDir = gerarCookieAuth(diretor);

        const aluno = await Aluno.create({
            nome: 'Sophia Costa',
            turma: '1ºA',
            ativo: true,
            escolaId,
        });

        const doc = await DocumentoResponsavel.create({
            escolaId,
            alunoId: aluno._id,
            responsavelId: diretor._id,
            turmaId: '1A',
            tipoDocumento: 'Termo de Responsabilidade',
            nomeDocumento: 'Termo Sala Maker',
            arquivo: {
                nomeOriginal: 'termo.pdf',
                url: '/mock',
                storageId: 'mock-123',
                mimeType: 'application/pdf',
                tamanho: 2048,
            },
            status: 'Enviado',
        });

        const res = await request(app)
            .put(`/api/documentos-responsaveis/${doc._id}/status`)
            .set('Cookie', cookieDir)
            .send({
                status: 'Conferido',
                observacoes: 'Documento assinado verificado com sucesso.',
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('Conferido');

        const docAtualizado = await DocumentoResponsavel.findById(doc._id);
        expect(docAtualizado.status).toBe('Conferido');
        expect(docAtualizado.observacoes).toBe('Documento assinado verificado com sucesso.');
    });

    it('responsável pode substituir documento mantendo vínculo com o aluno', async () => {
        const resp = await criarUsuario({
            perfil: 'responsavel',
            email: 'resp.sub@escola.test',
            escolaId,
        });
        const cookie = gerarCookieAuth(resp);

        const aluno = await Aluno.create({
            nome: 'Enzo Martins',
            turma: '5ºA',
            ativo: true,
            escolaId,
        });

        resp.alunoIds = [aluno._id.toString()];
        await resp.save();

        const docOriginal = await DocumentoResponsavel.create({
            escolaId,
            alunoId: aluno._id,
            responsavelId: resp._id,
            turmaId: '5A',
            tipoDocumento: 'Eventos',
            nomeDocumento: 'Autorização Festa Junina',
            arquivo: {
                nomeOriginal: 'versao1.pdf',
                url: '/mock',
                storageId: 'mock-v1',
                mimeType: 'application/pdf',
                tamanho: 1000,
            },
            status: 'Enviado',
        });

        const res = await request(app)
            .put(`/api/documentos-responsaveis/${docOriginal._id}/substituir`)
            .set('Cookie', cookie)
            .attach('arquivo', pdfValido, {
                filename: 'versao2_assinada.pdf',
                contentType: 'application/pdf',
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.arquivo.nomeOriginal).toBe('versao2_assinada.pdf');
        expect(res.body.data.alunoId.toString()).toBe(aluno._id.toString());
    });
});
