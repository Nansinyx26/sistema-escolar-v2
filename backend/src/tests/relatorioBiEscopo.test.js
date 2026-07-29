/**
 * relatorioBiEscopo.test.js — isolamento multi-escola do relatório BI.
 *
 * A agregação de `GET /api/ia/relatorio-bi` não tinha filtro de escola: o PDF
 * que um diretor baixava somava as notas de TODA a rede. Estes testes fixam o
 * comportamento correto para que a regressão não volte em silêncio.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../app');
const Escola = require('../models/Escola');
const Nota = require('../models/Nota');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

async function cookieDiretor() {
    const user = await criarUsuario({ perfil: 'diretor' });
    const token = jwt.sign(
        { id: user._id, perfil: user.perfil, email: user.email, nome: user.nome },
        process.env.JWT_SECRET, { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

let minha;
let outra;

beforeAll(async () => { await conectarBanco(); });

beforeEach(async () => {
    // Garante que ESTA suíte é dona do estado: uma escola ativa deixada
    // para trás por outra suíte faria `filtrarPorEscola` ver duas ativas e
    // deixar de resolver req.escolaId (ele exige escolha nesse caso).
    await Escola.deleteMany({});
    minha = await Escola.create({ nome: 'EMEF Minha', tipo: 'EMEF', ativo: true });
    outra = await Escola.create({ nome: 'EMEF Outra', tipo: 'EMEF', ativo: false });
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => { await desconectarBanco(); });

describe('GET /api/ia/relatorio-bi — escopo por escola', () => {
    it('gera o PDF quando há notas na escola da sessão', async () => {
        await Nota.create([
            { alunoId: 'a1', escolaId: String(minha._id), materiaId: 'Matematica', turmaId: '1A', bimestre: 1, nota: 8 },
            { alunoId: 'a2', escolaId: String(minha._id), materiaId: 'Matematica', turmaId: '1A', bimestre: 1, nota: 6 }
        ]);

        const res = await request(app).get('/api/ia/relatorio-bi').set('Cookie', await cookieDiretor());

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/pdf/);
    });

    it('NÃO gera relatório a partir de notas de outra escola', async () => {
        // Só a escola vizinha tem notas. Antes da correção, o diretor desta
        // escola recebia um PDF com as médias da vizinha.
        await Nota.create([
            { alunoId: 'z1', escolaId: String(outra._id), materiaId: 'Matematica', turmaId: '9Z', bimestre: 1, nota: 10 },
            { alunoId: 'z2', escolaId: String(outra._id), materiaId: 'Portugues', turmaId: '9Z', bimestre: 1, nota: 9 }
        ]);

        const res = await request(app).get('/api/ia/relatorio-bi').set('Cookie', await cookieDiretor());

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/não há dados/i);
    });

    it('uma nota conceitual (registro legado) não derruba o relatório', async () => {
        await Nota.create({
            alunoId: 'a1', escolaId: String(minha._id),
            materiaId: 'Matematica', turmaId: '1A', bimestre: 1, nota: 7
        });
        // Gravação direta: o schema declara Number, mas a base tem histórico
        // de lançamento textual. Com `$toDouble` isso virava 500.
        await Nota.collection.insertOne({
            _id: 'legado-conceito', alunoId: 'a2', escolaId: String(minha._id),
            materiaId: 'Artes', turmaId: '1A', bimestre: 1, nota: 'Satisfatório'
        });

        const res = await request(app).get('/api/ia/relatorio-bi').set('Cookie', await cookieDiretor());

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/pdf/);
    });
});
