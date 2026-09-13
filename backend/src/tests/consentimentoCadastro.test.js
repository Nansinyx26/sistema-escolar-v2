/**
 * consentimentoCadastro.test.js — Issue #295, o lado de QUEM SE CADASTRA.
 *
 * `consentimentoCarimboCadastro.test.js` (#236) prova que a conta não nasce
 * mais com consentimento carimbado, e que a migração tira o carimbo das
 * antigas. Este arquivo prova o outro lado: o cadastro de docente, diretor e
 * secretaria EXIGE a manifestação da pessoa e recusa sem ela; e as cinco
 * rotas gravam o aceite do jeito auditável — no `lgpdHistory`, com data,
 * versão, IP, navegador e método.
 *
 * No responsável o aceite é opcional (Issue #288) — o portal o pede no
 * CompletarCadastro antes de abrir. Esse lado está em
 * `cadastroPortalResponsavel.test.js`.
 *
 * AS ROTAS VIVAS, E NÃO O SERVIÇO
 * -------------------------------
 * O `RegistrationService` só é chamado pelo `UserController-REFATORADO`, que não
 * está em nenhuma rota. Os testes aqui sobem o `app` e fazem POST nas cinco
 * rotas que os formulários de verdade usam.
 *
 * A TRAVA ESTÁTICA
 * ----------------
 * O último bloco lê o código-fonte e reprova qualquer `Usuario.create(...)` ou
 * `new Usuario(...)` que grave consentimento por conta própria. Os testes de
 * rota cobrem os caminhos que existem hoje; a trava cobre o que alguém escrever
 * amanhã — foi assim que o carimbo se espalhou para sete lugares.
 *
 * ⚠️ Fixtures 100% SINTÉTICAS (§7.8).
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    SENHA_TESTE,
    CODIGO_ESCOLA_TESTE,
} = require('./helpers');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const SecurityConfig = require('../models/SecurityConfig');
const UserController = require('../controllers/UserController');
const {
    CONSENTIMENTO_ID,
    CONSENTIMENTO_VERSAO,
    consentimentoVigente,
} = require('../utils/consentimentoLgpd');
const { CODIGO_RECUSA } = require('../services/conformidade/consentimentoCadastro');
const { METODOS } = require('../services/conformidade/validacaoConsentimento');
const migracao = require('../../migrations/1788652800000-invalidar-consentimento-carimbado-no-cadastro');

const RAIZ_REPO = path.join(__dirname, '..', '..', '..');
const NAVEGADOR = 'jest-consentimento-cadastro';
const CODIGO_ALUNO = 'ALUNO-FIXTURE-295';

const ACEITE = { aceito: true, versao: CONSENTIMENTO_VERSAO };

/** O corpo mínimo que cada rota aceita — sem o consentimento. */
const ROTAS = {
    'register-responsavel': (email) => ({
        nome: 'Responsavel Fixture',
        email,
        senha: SENHA_TESTE,
        telefone: '(19) 99999-0001',
        codigoSecreto: CODIGO_ALUNO,
    }),
    'register-docente': (email) => ({
        nome: 'Docente Fixture',
        email,
        senha: SENHA_TESTE,
        disciplina: 'História',
        turma: '2B',
        matricula: 'M42',
        telefone: '(19) 99999-0002',
        codigoEscola: CODIGO_ESCOLA_TESTE,
    }),
    'register-diretor': (email) => ({
        nome: 'Diretora Fixture',
        email,
        senha: SENHA_TESTE,
        telefone: '(19) 99999-0003',
        codigoEscola: CODIGO_ESCOLA_TESTE,
    }),
    'register-secretaria': (email) => ({
        nome: 'Secretaria Fixture',
        email,
        senha: SENHA_TESTE,
        telefone: '(19) 99999-0004',
        codigoEscola: CODIGO_ESCOLA_TESTE,
    }),
    'register-code': (email) => ({
        nome: 'Professor Fixture',
        email,
        senha: SENHA_TESTE,
        codigoEscola: CODIGO_ESCOLA_TESTE,
        cpf: '12345678901',
        telefone: '19999990005',
    }),
};

/** As rotas em que o cadastro não acontece sem o aceite. */
const OBRIGATORIAS = [
    'register-docente',
    'register-diretor',
    'register-secretaria',
    'register-code',
];

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    await SecurityConfig.create({
        chave: 'CONFIG_GERAL',
        codigoSecretoEscola: CODIGO_ESCOLA_TESTE,
        rotacaoAutomatica: false,
    });
    await Aluno.create({ nome: 'Aluno Fixture', turma: '1A', codigoSecreto: CODIGO_ALUNO });
});

function cadastrar(rota, corpo) {
    return request(app).post(`/api/auth/${rota}`).set('User-Agent', NAVEGADOR).send(corpo);
}

describe.each(OBRIGATORIAS)('POST /api/auth/%s — sem o aceite', (rota) => {
    const email = `${rota}@escola.test`;
    const corpo = (extra) => ({ ...ROTAS[rota](email), ...extra });

    it('recusa (400) sem o consentimento — e não cria a conta', async () => {
        const res = await cadastrar(rota, corpo());

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODIGO_RECUSA);
        expect(await Usuario.countDocuments({ email })).toBe(0);
    });

    it('recusa `aceito` que não seja o booleano true', async () => {
        // Um formulário que aceita qualquer valor verdadeiro é um formulário que
        // pode mandar o campo sem a pessoa ter marcado nada.
        for (const aceito of ['true', 1, 'on', false]) {
            const res = await cadastrar(
                rota,
                corpo({ consentimentoLgpd: { aceito, versao: CONSENTIMENTO_VERSAO } })
            );
            expect(res.status).toBe(400);
            expect(res.body.code).toBe(CODIGO_RECUSA);
        }
        expect(await Usuario.countDocuments({ email })).toBe(0);
    });

    it('recusa o aceite de uma versão que não é a vigente', async () => {
        const res = await cadastrar(
            rota,
            corpo({ consentimentoLgpd: { aceito: true, versao: '1.0' } })
        );

        expect(res.status).toBe(400);
        expect(res.body.code).toBe(CODIGO_RECUSA);
        expect(res.body.error).toContain(CONSENTIMENTO_VERSAO);
        expect(await Usuario.countDocuments({ email })).toBe(0);
    });
});

describe.each(Object.keys(ROTAS))('POST /api/auth/%s — com o aceite', (rota) => {
    const email = `${rota}@escola.test`;
    const corpo = (extra) => ({ ...ROTAS[rota](email), ...extra });

    it('cria a conta e grava o registro auditável', async () => {
        const res = await cadastrar(rota, corpo({ consentimentoLgpd: ACEITE }));
        expect(res.status).toBe(201);

        const usuario = await Usuario.findOne({ email }).lean();
        const registros = usuario.lgpdHistory.filter((r) => r.termoId === CONSENTIMENTO_ID);

        expect(registros).toHaveLength(1);
        const [registro] = registros;
        expect(registro.versao).toBe(CONSENTIMENTO_VERSAO);
        expect(registro.aceitoEm).toBeInstanceOf(Date);
        expect(registro.ip).toBeTruthy();
        expect(registro.ip).not.toBe('desconhecido');
        expect(registro.browser).toBe(NAVEGADOR);
        expect(registro.metodoValidacao).toBe(METODOS.CADASTRO);

        // O campo legado e o histórico descrevem o MESMO ato.
        expect(usuario.consentimentoAceiteEm.getTime()).toBe(registro.aceitoEm.getTime());
        expect(usuario.consentimentoVersao).toBe(CONSENTIMENTO_VERSAO);
        expect(consentimentoVigente(usuario).aceito).toBe(true);
    });

    it('a migração da #236 não tira o aceite de quem se cadastrou assim', async () => {
        // O aceite nasce colado ao `createdAt` — exatamente a condição de tempo
        // do filtro da migração. O que o protege é ter entrada no histórico.
        await cadastrar(rota, corpo({ consentimentoLgpd: ACEITE }));
        await migracao.up();

        const usuario = await Usuario.findOne({ email }).lean();
        expect(usuario.consentimentoAceiteEm).toBeInstanceOf(Date);
        expect(consentimentoVigente(usuario).aceito).toBe(true);
    });
});

describe('POST /api/usuarios (conta criada por gestor)', () => {
    function respostaFalsa() {
        const res = {
            statusCode: 200,
            corpo: null,
            status(c) {
                res.statusCode = c;
                return res;
            },
            json(c) {
                res.corpo = c;
                return res;
            },
        };
        return res;
    }

    it('descarta consentimento enviado por quem cria a conta de outra pessoa', async () => {
        const email = 'criado-por-gestor@escola.test';
        const req = {
            user: { id: 'admin-fixture', perfil: 'admin', email: 'admin@escola.test' },
            ip: '203.0.113.9',
            headers: { 'user-agent': NAVEGADOR },
            body: {
                nome: 'Professor Criado Pelo Gestor',
                email,
                senha: SENHA_TESTE,
                telefone: '(19) 99999-0006',
                perfil: 'professor',
                consentimentoAceiteEm: new Date(),
                consentimentoVersao: CONSENTIMENTO_VERSAO,
                lgpdHistory: [
                    {
                        termoId: CONSENTIMENTO_ID,
                        versao: CONSENTIMENTO_VERSAO,
                        aceitoEm: new Date(),
                    },
                ],
            },
        };
        const res = respostaFalsa();

        await UserController.create(req, res);

        expect(res.statusCode).toBe(201);
        const usuario = await Usuario.findOne({ email }).lean();
        expect(usuario.consentimentoAceiteEm).toBeUndefined();
        expect(usuario.lgpdHistory || []).toHaveLength(0);
        expect(consentimentoVigente(usuario).aceito).toBe(false);
    });
});

describe('frontend: a caixa e a versão', () => {
    const PAGINAS = [
        ['html/pages/cadastro-responsavel.html', 'aceiteLgpdCadastro', false],
        ['html/pages/cadastro-docente.html', 'aceiteLgpdCadastro', true],
        ['html/pages/cadastro-diretor-publico.html', 'aceiteLgpdCadastro', true],
        ['html/pages/cadastro-secretaria-publico.html', 'aceiteLgpdCadastro', true],
        ['html/login.html', 'registerConsent', true],
        ['html/login-professor.html', 'registerConsent', true],
        ['html/login-diretor.html', 'registerConsent', true],
        ['html/login-secretaria.html', 'registerConsent', true],
    ];

    it('a versão do js/consentimento-cadastro.js é a mesma do backend', () => {
        // Se a política mudar e só um lado for atualizado, TODO cadastro passa a
        // ser recusado por "versão diferente da vigente".
        const fonte = fs.readFileSync(path.join(RAIZ_REPO, 'js/consentimento-cadastro.js'), 'utf8');
        const [, versaoFront] = fonte.match(/const VERSAO = '([^']+)'/) || [];
        expect(versaoFront).toBe(CONSENTIMENTO_VERSAO);
    });

    it.each(PAGINAS)('%s tem a caixa desmarcada e carrega o módulo', (pagina, id, obrigatoria) => {
        const html = fs.readFileSync(path.join(RAIZ_REPO, pagina), 'utf8');
        const caixa = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));

        expect(caixa).not.toBeNull();
        expect(caixa[0]).toContain('type="checkbox"');
        expect(caixa[0]).not.toMatch(/\bchecked\b/);
        // Obrigatória onde o servidor recusa sem ela; no responsável, opcional —
        // `required` ali bloquearia o envio pela validação nativa do navegador.
        expect(/\brequired\b/.test(caixa[0])).toBe(obrigatoria);
        expect(html).toMatch(/<script[^>]+src="[./]*js\/consentimento-cadastro\.js"/);
    });
});

describe('trava: nenhum caminho de criação de conta grava consentimento sozinho', () => {
    const SRC = path.join(__dirname, '..');

    function arquivosJs(dir) {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) return e.name === 'tests' ? [] : arquivosJs(p);
            return e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [p] : [];
        });
    }

    /** O texto entre o `(` de `inicio` e o `)` que o fecha. */
    function argumento(fonte, inicio) {
        let nivel = 0;
        for (let i = inicio; i < fonte.length; i++) {
            if (fonte[i] === '(') nivel++;
            else if (fonte[i] === ')' && --nivel === 0) return fonte.slice(inicio, i + 1);
        }
        return fonte.slice(inicio);
    }

    it('só grava consentimento no create quem passa por assinaturasDoCadastro', () => {
        const infratores = [];
        let criacoes = 0;

        for (const arquivo of arquivosJs(SRC)) {
            const fonte = fs.readFileSync(arquivo, 'utf8');
            for (const m of fonte.matchAll(/(?:Usuario\.create|new Usuario)\s*\(/g)) {
                criacoes++;
                const arg = argumento(fonte, m.index + m[0].length - 1)
                    // comentários não gravam nada
                    .replace(/\/\/[^\n]*/g, '')
                    .replace(/\/\*[\s\S]*?\*\//g, '');
                if (/\b(consentimentoAceiteEm|consentimentoVersao|lgpdHistory)\s*:/.test(arg)) {
                    const linha = fonte.slice(0, m.index).split('\n').length;
                    infratores.push(`${path.relative(SRC, arquivo)}:${linha}`);
                }
            }
        }

        // Sanidade: a varredura precisa estar enxergando os creates de verdade.
        expect(criacoes).toBeGreaterThanOrEqual(10);
        expect(infratores).toEqual([]);
    });

    it('as rotas obrigatórias validam antes do create, e as cinco gravam pelo módulo', () => {
        const fonte = fs.readFileSync(path.join(SRC, 'controllers/UserController.js'), 'utf8');
        const handlers = [
            'registerResponsavel',
            'registerDocente',
            'registerDiretor',
            'registerSecretaria',
            'registerWithCode',
        ];
        for (const nome of handlers) {
            const inicio = fonte.indexOf(`exports.${nome} = async`);
            const fim = fonte.indexOf('\nexports.', inicio + 1);
            const corpo = fonte.slice(inicio, fim);

            const validacao = corpo.indexOf('validarConsentimentoDoCadastro(req.body)');
            const create = corpo.indexOf('Usuario.create(');
            const obrigatoria = nome !== 'registerResponsavel';
            expect({ nome, validaAntes: validacao !== -1 && validacao < create }).toEqual({
                nome,
                validaAntes: obrigatoria,
            });
            expect(corpo).toContain('assinaturasDoCadastro(req)');
        }
    });
});
