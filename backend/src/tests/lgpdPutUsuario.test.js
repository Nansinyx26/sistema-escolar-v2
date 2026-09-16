/**
 * lgpdPutUsuario.test.js
 *
 * Garante o cumprimento da Issue #310 (LGPD Art. 8º):
 * PUT /api/usuarios/:id (UserController.update) não pode gravar
 * consentimentoAceiteEm, consentimentoVersao nem lgpdConsents.
 *
 * O consentimento é ato exclusivo do titular, acompanhado de assinatura
 * no lgpdHistory (IP, navegador, data e versão), cujo caminho legítimo
 * é o updateProfile (/api/auth/profile, Issue #280/#289).
 */

const request = require('supertest');
const app = require('../app');
const Usuario = require('../models/Usuario');
const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

beforeAll(async () => {
    await conectarBanco();
});

beforeEach(async () => {
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => {
    await desconectarBanco();
});

describe('PUT /api/usuarios/:id — proteção de consentimento LGPD (Issue #310)', () => {
    it('diretor alterando professor NÃO consegue gravar consentimento nem autorizações', async () => {
        const escola = await Escola.create({
            nome: 'Escola Municipal Teste',
            tipo: 'EMEF',
            ativo: true,
        });

        const diretor = await criarUsuario({
            perfil: 'diretor',
            nome: 'Diretor Silva',
            email: 'diretor@escola.test',
            escolaId: String(escola._id),
        });

        await Diretor.create({
            idUsuario: String(diretor._id),
            nome: diretor.nome,
            email: diretor.email,
            escolaId: String(escola._id),
            vinculos: [{ escolaId: String(escola._id), cargo: 'diretor' }],
        });

        const professor = await criarUsuario({
            perfil: 'professor',
            nome: 'Professor Santos',
            email: 'prof_santos@escola.test',
            escolaId: String(escola._id),
        });

        const cookiesDiretor = [
            `escola_jwt=${assinarTokenSessao(diretor, { escolaId: String(escola._id) })}`,
        ];

        const dataInjecao = new Date('2026-09-01T10:00:00.000Z');
        const res = await request(app)
            .put(`/api/usuarios/${professor._id}`)
            .set('Cookie', cookiesDiretor)
            .send({
                nome: 'Professor Santos Editado',
                consentimentoAceiteEm: dataInjecao,
                consentimentoVersao: '2026-09',
                lgpdConsents: {
                    imagemRedes: true,
                    comunicadosEmail: true,
                },
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const profAtualizado = await Usuario.findById(professor._id).lean();
        // Campo legítimo permitido foi atualizado com sucesso
        expect(profAtualizado.nome).toBe('Professor Santos Editado');

        // Campos de consentimento FORAM IGNORADOS e não foram assinados/gravados
        expect(profAtualizado.consentimentoAceiteEm).toBeUndefined();
        expect(profAtualizado.consentimentoVersao).toBeUndefined();
        expect(profAtualizado.lgpdConsents.imagemRedes).toBe(false);
        expect(profAtualizado.lgpdConsents.comunicadosEmail).toBe(false);
        expect(profAtualizado.lgpdHistory || []).toHaveLength(0);
    });

    it('próprio titular NÃO grava consentimento legado nem autorizações via PUT /api/usuarios/:id', async () => {
        const professor = await criarUsuario({
            perfil: 'professor',
            nome: 'Professora Maria',
            email: 'maria@escola.test',
            telefone: '(11) 91111-1111',
        });

        const cookiesProf = [`escola_jwt=${assinarTokenSessao(professor)}`];

        const dataInjecao = new Date('2026-09-10T15:30:00.000Z');
        const res = await request(app)
            .put(`/api/usuarios/${professor._id}`)
            .set('Cookie', cookiesProf)
            .send({
                telefone: '(11) 92222-2222',
                consentimentoAceiteEm: dataInjecao,
                consentimentoVersao: '2026-09',
                lgpdConsents: {
                    perfilDadosCadastrais: true,
                },
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const profAtualizado = await Usuario.findById(professor._id).lean();
        // Telefone foi alterado
        expect(profAtualizado.telefone).toBe('(11) 92222-2222');

        // Nenhuma assinatura de consentimento foi gravada contornando o updateProfile
        expect(profAtualizado.consentimentoAceiteEm).toBeUndefined();
        expect(profAtualizado.consentimentoVersao).toBeUndefined();
        expect(profAtualizado.lgpdConsents.perfilDadosCadastrais).toBe(false);
        expect(profAtualizado.lgpdHistory || []).toHaveLength(0);
    });

    it('admin também não consegue forjar consentimento de terceiros via PUT /api/usuarios/:id', async () => {
        const admin = await criarUsuario({
            perfil: 'admin',
            nome: 'Admin Geral',
            email: 'admin@escola.test',
        });

        const professor = await criarUsuario({
            perfil: 'professor',
            nome: 'Professor Alvo',
            email: 'alvo@escola.test',
        });

        const cookiesAdmin = [`escola_jwt=${assinarTokenSessao(admin)}`];

        const res = await request(app)
            .put(`/api/usuarios/${professor._id}`)
            .set('Cookie', cookiesAdmin)
            .send({
                nome: 'Professor Alvo Atualizado',
                consentimentoAceiteEm: new Date(),
                consentimentoVersao: '2026-09',
                lgpdConsents: {
                    imagemSite: true,
                },
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        const profAtualizado = await Usuario.findById(professor._id).lean();
        expect(profAtualizado.nome).toBe('Professor Alvo Atualizado');
        expect(profAtualizado.consentimentoAceiteEm).toBeUndefined();
        expect(profAtualizado.consentimentoVersao).toBeUndefined();
        expect(profAtualizado.lgpdConsents.imagemSite).toBe(false);
        expect(profAtualizado.lgpdHistory || []).toHaveLength(0);
    });
});
