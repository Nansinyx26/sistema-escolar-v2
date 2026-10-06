/**
 * entradasForaDoFiltro.test.js — Issue #647
 *
 * O filtro global de app.js (tags e operadores Mongo) só enxerga o corpo JSON.
 * Estas entradas gravavam texto sem passar por ele:
 *   - formulário de upload (multer lê o corpo DEPOIS do filtro) e nome do
 *     arquivo;
 *   - linhas lidas do arquivo de importação de alunos.
 * (Comunicado da IA e reação do chat têm os casos em iaAcoes.test.js e
 * chatDireto.test.js, junto dos ajudantes daquelas suítes.)
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const Aluno = require('../models/Aluno');
const DocumentoResponsavel = require('../models/DocumentoResponsavel');
const importacao = require('../services/importacaoAlunos');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const TAG = '<img src=x onerror=alert(1)>';

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

function cookieDe(user) {
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

describe('formulário de upload (multer) passa pelo mesmo filtro do corpo JSON', () => {
    const escolaId = 'escola-entradas-647';
    const pdf = Buffer.from(
        '%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 2\n0000000000 65535 f\n0000000018 00000 n\ntrailer<</Size 2/Root 1 0 R>>\nstartxref\n70\n%%EOF'
    );

    async function responsavelComAluno() {
        const resp = await criarUsuario({
            perfil: 'responsavel',
            email: 'mae.647@escola.test',
            escolaId,
        });
        const aluno = await Aluno.create({
            nome: 'Aluno Teste',
            turma: '5ºA',
            turmaId: '5A',
            ativo: true,
            escolaId,
            responsaveis: [{ email: 'mae.647@escola.test', nome: 'Responsável Teste' }],
        });
        resp.alunoIds = [aluno._id.toString()];
        await resp.save();
        return { cookie: cookieDe(resp), aluno };
    }

    it('texto do formulário e nome do arquivo saem sem tag', async () => {
        const { cookie, aluno } = await responsavelComAluno();

        const res = await request(app)
            .post('/api/documentos-responsaveis')
            .set('Cookie', cookie)
            .field('alunoId', aluno._id.toString())
            .field('tipoDocumento', `Termo${TAG}`)
            .field('nomeDocumento', `${TAG}Autorização`)
            .field('observacoes', `Obs <b>forte</b>${TAG}`)
            .attach('arquivo', pdf, {
                filename: 'x"><img src=x onerror=alert(1)>.pdf',
                contentType: 'application/pdf',
            });

        expect(res.status).toBe(201);
        const doc = await DocumentoResponsavel.findById(res.body.data._id).lean();
        for (const valor of [
            doc.tipoDocumento,
            doc.nomeDocumento,
            doc.observacoes,
            doc.arquivo.nomeOriginal,
        ]) {
            expect(valor).not.toMatch(/[<>]/);
        }
        expect(doc.nomeDocumento).toBe('Autorização');
        expect(doc.tipoDocumento).toBe('Termo');
    });

    it('campo com operador Mongo (`alunoId[$ne]`) não vira consulta', async () => {
        const { cookie } = await responsavelComAluno();

        const res = await request(app)
            .post('/api/documentos-responsaveis')
            .set('Cookie', cookie)
            .field('alunoId[$ne]', 'x')
            .field('tipoDocumento', 'Termo')
            .field('nomeDocumento', 'Termo')
            .attach('arquivo', pdf, { filename: 'termo.pdf', contentType: 'application/pdf' });

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(await DocumentoResponsavel.countDocuments()).toBe(0);
    });
});

describe('importação de alunos por arquivo', () => {
    it('o nome lido da planilha sai sem tag', async () => {
        const csv = `Nome;RA;Data de Nascimento\n${TAG}Ana Souza;123;01/02/2015\nBruno "Lima";456;03/04/2015\n`;

        const lido = await importacao.lerArquivo({ buffer: Buffer.from(csv) });

        expect(lido.registros).toHaveLength(2);
        expect(lido.registros[0].nome).toBe('Ana Souza');
        for (const registro of lido.registros) {
            for (const valor of Object.values(registro)) {
                if (typeof valor === 'string') expect(valor).not.toMatch(/[<>]/);
            }
        }
    });
});
