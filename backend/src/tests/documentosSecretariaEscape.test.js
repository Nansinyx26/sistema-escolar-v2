/**
 * documentosSecretariaEscape.test.js — Issue #639
 *
 * A emissão de documentos da secretaria monta o HTML no servidor, e a página
 * (`html/secretaria/documentos.html`) põe esse HTML no innerHTML da prévia e
 * na janela de impressão — não tem como escapar, porque o conteúdo é HTML de
 * propósito. Quem escapa é o servidor.
 *
 * O aluno é gravado direto na coleção, sem passar pelo filtro de entrada: é o
 * caso do dado anterior ao filtro, ou que entrou por outro caminho.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Matricula = require('../models/Matricula');
const Turma = require('../models/Turma');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const TAG = '<img src=x onerror="alert(1)">';
const TAG_ESCAPADA = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;';

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];
// Os três modelos guardam `_id` como texto (ver o schema de cada um).
const novoId = () => new mongoose.Types.ObjectId().toString();

describe('documentos da secretaria escapam o dado do aluno (Issue #639)', () => {
    let escola;
    let secretaria;
    let alunoId;

    beforeAll(async () => {
        await conectarBanco();
    });
    afterAll(async () => {
        await desconectarBanco();
    });
    beforeEach(async () => {
        await limparBanco();
        escola = await Escola.create({ nome: 'EMEF Docs', tipo: 'EMEF', ativo: true });
        secretaria = await criarUsuario({
            email: 'secretaria@escola.test',
            perfil: 'secretaria',
            escolaId: String(escola._id),
        });
        invalidarCacheEscolas();

        alunoId = novoId();
        await Aluno.collection.insertOne({
            _id: alunoId,
            nome: `${TAG}Pedro &amp; Maria`,
            sobrenome: '"Souza"',
            turma: `<b>5A</b>`,
            matricula: `<i>RA1</i>`,
            escolaId: String(escola._id),
            ativo: true,
        });

        const turmaId = novoId();
        await Turma.collection.insertOne({
            _id: turmaId,
            nome: `<u>Turma</u>`,
            escolaId: String(escola._id),
        });
        await Matricula.collection.insertOne({
            _id: novoId(),
            alunoId,
            turmaId,
            escolaId: String(escola._id),
            anoLetivo: 2026,
            status: 'cursando',
            matriculaNumero: `<s>20260001</s>`,
        });
    });

    const emitir = (tipo) =>
        request(app)
            .post(`/api/secretaria/documentos/${tipo}/${alunoId}`)
            .set('Cookie', cookieDe(secretaria));

    it.each(['declaracao-matricula', 'declaracao-frequencia', 'historico-escolar'])(
        '%s: nenhuma tag do cadastro sai como marcação',
        async (tipo) => {
            const r = await emitir(tipo);
            expect(r.status).toBe(201);
            const html = r.body.data.conteudoHTML;

            expect(html).not.toContain('<img');
            expect(html).not.toMatch(/<(b|i|u|s)>/);
            // O nome aparece escapado, e o `&` que o servidor já gravou, uma vez só.
            expect(html).toContain(`${TAG_ESCAPADA}Pedro &amp; Maria &quot;Souza&quot;`);
            expect(html).not.toContain('&amp;amp;');
        }
    );

    it('a turma, a matrícula e o RA também saem escapados', async () => {
        const matricula = (await emitir('declaracao-matricula')).body.data.conteudoHTML;
        expect(matricula).toContain('&lt;b&gt;5A&lt;/b&gt;');
        expect(matricula).toContain('&lt;s&gt;20260001&lt;/s&gt;');

        const historico = (await emitir('historico-escolar')).body.data.conteudoHTML;
        expect(historico).toContain('&lt;i&gt;RA1&lt;/i&gt;');
        expect(historico).toContain('&lt;u&gt;Turma&lt;/u&gt;');
        expect(historico).toContain('&lt;s&gt;20260001&lt;/s&gt;');
    });
});
