/**
 * documentoVersoes.regressao.test.js — Issue #399
 *
 * Documento assinado é prova da manifestação do responsável. O que fica
 * provado aqui:
 *   - substituir NÃO apaga a versão anterior, e ela continua acessível;
 *   - cada arquivo tem hash SHA-256 que confere com o conteúdo;
 *   - só quem enviou substitui; a escola muda status e registra parecer;
 *   - envio, leitura, download, substituição e status deixam trilha;
 *   - a ficha só aceita arquivo que o próprio usuário enviou;
 *   - autorização respondida de novo guarda a resposta anterior.
 */
const crypto = require('node:crypto');
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Secretaria = require('../models/Secretaria');
const AuditLog = require('../models/AuditLog');
const Autorizacao = require('../models/Autorizacao');
const DocumentoResponsavel = require('../models/DocumentoResponsavel');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const PDF_V1 = Buffer.from('%PDF-1.4 versao um assinada');
const PDF_V2 = Buffer.from('%PDF-1.4 versao dois assinada');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

let escola;
let aluno;
let mae;
let secretaria;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function enviarDocumento() {
    return request(app)
        .post('/api/documentos-responsaveis/upload')
        .set('Cookie', cookieDe(mae))
        .field('alunoId', String(aluno._id))
        .field('tipoDocumento', 'Autorização')
        .field('nomeDocumento', 'Passeio ao museu')
        .attach('arquivo', PDF_V1, { filename: 'v1.pdf', contentType: 'application/pdf' });
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({ nome: 'EMEF Documentos', tipo: 'EMEF', ativo: true });
    aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Criança Fixture',
        turma: '1A',
        responsavel: 'mae@familia.test',
        ativo: true,
    });
    mae = await criarUsuario({ email: 'mae@familia.test', perfil: 'responsavel' });
    secretaria = await criarUsuario({
        email: 'sec@escola.test',
        perfil: 'secretaria',
        escolaId: String(escola._id),
    });
    await Secretaria.create({
        idUsuario: String(secretaria._id),
        nome: secretaria.nome,
        email: secretaria.email,
        vinculos: [{ escolaId: String(escola._id), cargo: 'secretaria' }],
    });
    invalidarCacheEscolas();
});

describe('versões e integridade', () => {
    it('envio grava o hash do conteúdo e deixa trilha', async () => {
        const res = await enviarDocumento();
        expect(res.status).toBe(201);
        expect(res.body.data.arquivo.hash).toBe(sha256(PDF_V1));
        expect(await AuditLog.countDocuments({ acao: 'DOCUMENTO_RESPONSAVEL_ENVIADO' })).toBe(1);
    });

    it('substituir preserva a versão anterior, que continua acessível e íntegra', async () => {
        const envio = await enviarDocumento();
        const id = envio.body.data._id;
        const storageV1 = envio.body.data.arquivo.storageId;

        const troca = await request(app)
            .put(`/api/documentos-responsaveis/${id}/substituir`)
            .set('Cookie', cookieDe(mae))
            .attach('arquivo', PDF_V2, { filename: 'v2.pdf', contentType: 'application/pdf' });
        expect(troca.status).toBe(200);
        expect(troca.body.data.arquivo.hash).toBe(sha256(PDF_V2));

        const doc = await DocumentoResponsavel.findById(id).lean();
        expect(doc.versoes).toHaveLength(1);
        expect(doc.versoes[0].hash).toBe(sha256(PDF_V1));

        // A gestão lista o histórico e baixa a versão anterior, byte a byte.
        const versoes = await request(app)
            .get(`/api/documentos-responsaveis/${id}/versoes`)
            .set('Cookie', cookieDe(secretaria));
        expect(versoes.status).toBe(200);
        expect(versoes.body.data.map((v) => v.atual)).toEqual([true, false]);

        const antiga = await request(app)
            .get(`/api/documentos-responsaveis/${storageV1}/download`)
            .set('Cookie', cookieDe(secretaria));
        expect(antiga.status).toBe(200);
        expect(sha256(antiga.body)).toBe(sha256(PDF_V1));

        expect(await AuditLog.countDocuments({ acao: 'DOCUMENTO_RESPONSAVEL_SUBSTITUIDO' })).toBe(
            1
        );
    });

    it('a escola não troca o arquivo da família', async () => {
        const envio = await enviarDocumento();
        const res = await request(app)
            .put(`/api/documentos-responsaveis/${envio.body.data._id}/substituir`)
            .set('Cookie', cookieDe(secretaria))
            .attach('arquivo', PDF_V2, { filename: 'v2.pdf', contentType: 'application/pdf' });
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('SUBSTITUICAO_SO_DE_QUEM_ENVIOU');

        const doc = await DocumentoResponsavel.findById(envio.body.data._id).lean();
        expect(doc.arquivo.hash).toBe(sha256(PDF_V1));
    });

    it('a escola muda status e registra parecer separado do arquivo', async () => {
        const envio = await enviarDocumento();
        const res = await request(app)
            .patch(`/api/documentos-responsaveis/${envio.body.data._id}/status`)
            .set('Cookie', cookieDe(secretaria))
            .send({ status: 'Conferido', observacoes: 'assinatura confere' });
        expect(res.status).toBe(200);

        const doc = await DocumentoResponsavel.findById(envio.body.data._id).lean();
        expect(doc.status).toBe('Conferido');
        expect(doc.parecerGestao.texto).toBe('assinatura confere');
        expect(doc.parecerGestao.autorId).toBe(String(secretaria._id));
        expect(doc.arquivo.hash).toBe(sha256(PDF_V1));
        expect(await AuditLog.countDocuments({ acao: 'DOCUMENTO_RESPONSAVEL_STATUS' })).toBe(1);
    });

    it('abrir e baixar deixam registro de quem acessou', async () => {
        const envio = await enviarDocumento();
        const id = envio.body.data._id;
        await request(app)
            .get(`/api/documentos-responsaveis/${id}/visualizar`)
            .set('Cookie', cookieDe(secretaria));
        await request(app)
            .get(`/api/documentos-responsaveis/${id}/download`)
            .set('Cookie', cookieDe(secretaria));

        expect(await AuditLog.countDocuments({ acao: 'DOCUMENTO_RESPONSAVEL_VISUALIZADO' })).toBe(
            1
        );
        expect(await AuditLog.countDocuments({ acao: 'DOCUMENTO_RESPONSAVEL_BAIXADO' })).toBe(1);
    });
});

describe('ficha do aluno só aceita arquivo do próprio usuário', () => {
    it('identificador de arquivo alheio é recusado', async () => {
        const res = await request(app)
            .post(`/api/responsavel/aluno/${aluno._id}/documentos`)
            .set('Cookie', cookieDe(mae))
            .send({
                arquivos: [
                    {
                        nome: 'x.pdf',
                        tipo: 'application/pdf',
                        gridfsId: '000000000000000000000001',
                    },
                ],
            });
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('ARQUIVO_NAO_E_SEU');
    });
});

describe('autorizações guardam histórico', () => {
    it('responder de novo preserva a resposta anterior', async () => {
        const responder = (aceita) =>
            request(app)
                .put(`/api/responsavel/aluno/${aluno._id}/dados`)
                .set('Cookie', cookieDe(mae))
                .send({ autorizacoesEscolares: { atividadesExtraclasse: aceita } });

        expect((await responder(true)).status).toBe(200);
        expect((await responder(false)).status).toBe(200);

        const autorizacao = await Autorizacao.findOne({
            alunoId: String(aluno._id),
            tipoAutorizacao: 'atividadesExtraclasse',
        }).lean();
        expect(autorizacao.aceita).toBe(false);
        expect(autorizacao.historico.map((h) => h.aceita)).toEqual([true, false]);
    });
});
