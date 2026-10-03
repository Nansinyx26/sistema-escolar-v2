/**
 * mudarEscolaSoProfessor.test.js
 *
 * Issue #575: POST /api/escolas/mudar aceitava o código secreto da escola —
 * o código de CADASTRO DE PROFESSOR — de diretor e secretaria, e gravava o
 * vínculo com o cargo de quem chamava. Um diretor da escola A que obtivesse o
 * código da escola B virava diretor em B. Agora só o professor troca de escola
 * por código; direção e secretaria entram por convite.
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');

const CODIGO_B = 'CODIGO-B-575';
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
    invalidarCacheEscolas();
    escolaA = await Escola.create({
        nome: 'Escola A',
        tipo: 'EMEF',
        codigoSecreto: 'CODIGO-A-575',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'Escola B',
        tipo: 'EMEF',
        codigoSecreto: CODIGO_B,
        ativo: true,
    });
});

/** Conta de equipe vinculada à escola A, com o documento de cargo correspondente. */
async function criarEquipe(perfil, Model) {
    const escolaId = String(escolaA._id);
    const usuario = await criarUsuario({ perfil, escolaId, escola: escolaA.nome });
    await Model.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        escolaId,
        vinculos: [{ escolaId, cargo: perfil }],
    });
    return { usuario, cookie: [`escola_jwt=${assinarTokenSessao(usuario)}`] };
}

describe('POST /api/escolas/mudar — só professor (Issue #575)', () => {
    it.each([
        ['diretor', Diretor],
        ['secretaria', Secretaria],
    ])('%s com o código de outra escola é recusado e nada muda', async (perfil, Model) => {
        const { usuario, cookie } = await criarEquipe(perfil, Model);

        const res = await request(app)
            .post('/api/escolas/mudar')
            .set('Cookie', cookie)
            .send({ codigoEscola: CODIGO_B });

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('TROCA_ESCOLA_POR_CONVITE');

        const cargo = await Model.findOne({ idUsuario: String(usuario._id) }).lean();
        expect(cargo.vinculos.map((v) => String(v.escolaId))).toEqual([String(escolaA._id)]);
        const conta = await Usuario.findById(usuario._id).lean();
        expect(String(conta.escolaId)).toBe(String(escolaA._id));
    });

    it('professor com o código da nova escola continua trocando', async () => {
        const { usuario, cookie } = await criarEquipe('professor', Professor);

        const res = await request(app)
            .post('/api/escolas/mudar')
            .set('Cookie', cookie)
            .send({ codigoEscola: CODIGO_B });

        expect(res.status).toBe(200);
        expect(res.body.escolaAtivaId).toBe(String(escolaB._id));

        const prof = await Professor.findOne({ idUsuario: String(usuario._id) }).lean();
        const escolas = prof.vinculos.map((v) => String(v.escolaId));
        expect(escolas).toContain(String(escolaB._id));
        expect(prof.vinculos.every((v) => v.cargo === 'professor')).toBe(true);
    });
});
