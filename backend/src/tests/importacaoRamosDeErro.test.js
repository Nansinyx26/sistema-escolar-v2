/**
 * importacaoRamosDeErro.test.js — os caminhos de ERRO do módulo de importação.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #55)
 * --------------------------------------
 * O módulo entrou com 87% de cobertura de patch. O que ficou de fora foram os
 * ramos de erro — e eles são justamente os que ninguém exercita à mão e que
 * degradam em silêncio.
 *
 * O caso mais concreto é `tratarErroUpload`: 15 linhas puras que decidem se a
 * secretaria lê "Arquivo acima do limite de 5 MB" ou um genérico "erro
 * interno". Uma regressão ali não quebra teste nenhum, não gera exceção, e só
 * aparece como um usuário confuso meses depois.
 *
 * ⚠️ Fixtures 100% SINTÉTICAS (§7.8).
 */
const multer = require('multer');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { tratarErroUpload } = require('../middleware/uploadImportacao');
const app = require('../app');
const Escola = require('../models/Escola');
const Secretaria = require('../models/Secretaria');
const Turma = require('../models/Turma');
const Aluno = require('../models/Aluno');

const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

// ═════════════════════════════════════════════════════════════════════════════
// tratarErroUpload — função pura, sem banco
// ═════════════════════════════════════════════════════════════════════════════

/** Dublê mínimo de `res`: registra status e corpo, encadeando como o Express. */
function resFalso() {
    const registro = { status: null, corpo: null };
    return {
        registro,
        status(codigo) {
            registro.status = codigo;
            return this;
        },
        json(corpo) {
            registro.corpo = corpo;
            return this;
        },
    };
}

describe('tratarErroUpload — mensagens de upload', () => {
    it('sem erro, apenas segue para o próximo middleware', () => {
        const res = resFalso();
        let seguiu = false;

        tratarErroUpload(null, {}, res, () => {
            seguiu = true;
        });

        expect(seguiu).toBe(true);
        expect(res.registro.status).toBeNull();
    });

    // A razão de ser deste arquivo: o usuário precisa saber que o problema é o
    // TAMANHO, não um defeito do sistema.
    it('traduz LIMIT_FILE_SIZE para uma mensagem sobre o limite de 5 MB', () => {
        const res = resFalso();
        tratarErroUpload(new multer.MulterError('LIMIT_FILE_SIZE'), {}, res, () => {});

        expect(res.registro.status).toBe(400);
        expect(res.registro.corpo.success).toBe(false);
        expect(res.registro.corpo.error).toMatch(/5 MB/);
    });

    it('traduz LIMIT_FILE_COUNT e LIMIT_UNEXPECTED_FILE', () => {
        const contagem = resFalso();
        tratarErroUpload(new multer.MulterError('LIMIT_FILE_COUNT'), {}, contagem, () => {});
        expect(contagem.registro.status).toBe(400);
        expect(contagem.registro.corpo.error).toMatch(/um arquivo por vez/i);

        const campo = resFalso();
        tratarErroUpload(new multer.MulterError('LIMIT_UNEXPECTED_FILE'), {}, campo, () => {});
        expect(campo.registro.status).toBe(400);
        expect(campo.registro.corpo.error).toMatch(/arquivo/i);
    });

    // Código de multer que não está no mapa não pode virar `undefined` na tela.
    it('usa mensagem genérica para código de multer desconhecido', () => {
        const res = resFalso();
        tratarErroUpload(new multer.MulterError('LIMIT_PART_COUNT'), {}, res, () => {});

        expect(res.registro.status).toBe(400);
        expect(res.registro.corpo.error).toBe('Falha ao receber o arquivo.');
    });

    // Erro do `fileFilter` (formato recusado) não é MulterError — cai no ramo
    // de baixo, e a mensagem dele É a que o usuário precisa ler.
    it('repassa a mensagem de erro comum, como a do fileFilter', () => {
        const res = resFalso();
        tratarErroUpload(
            new Error('Formato não aceito. Envie PDF, XLSX ou CSV.'),
            {},
            res,
            () => {}
        );

        expect(res.registro.status).toBe(400);
        expect(res.registro.corpo.error).toMatch(/Formato não aceito/);
    });

    it('não devolve corpo vazio quando o erro não tem mensagem', () => {
        const res = resFalso();
        tratarErroUpload(new Error(''), {}, res, () => {});

        expect(res.registro.status).toBe(400);
        expect(res.registro.corpo.error).toBe('Falha ao receber o arquivo.');
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// Controller — os catch que devolvem 500
// ═════════════════════════════════════════════════════════════════════════════

let escola;
let turma;
let cookie;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
    jest.restoreAllMocks();

    escola = await Escola.create({
        nome: 'EE Sintetica Erro',
        tipo: 'EMEF',
        bairro: 'X',
        codigoSecreto: 'COD-ERR-1',
        ativo: true,
    });
    turma = await Turma.create({
        id: '9Z',
        nome: '9Z',
        ano: 2026,
        escolaId: String(escola._id),
        ativo: true,
    });

    const usuario = await criarUsuario({
        perfil: 'secretaria',
        nome: 'Secretaria Erro',
        email: `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@escola.test`,
    });
    await Secretaria.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        escolaId: String(escola._id),
        vinculos: [{ escolaId: String(escola._id), cargo: 'secretaria' }],
    });
    cookie = `escola_jwt=${jwt.sign(
        { id: usuario._id, perfil: usuario.perfil, email: usuario.email, nome: usuario.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    )}`;
});

afterEach(() => {
    jest.restoreAllMocks();
});

const rota = (sufixo = '') => `/api/secretaria/turmas/${turma._id}/alunos${sufixo}`;

/**
 * Força a próxima consulta do model a explodir.
 *
 * É a única forma de alcançar os `catch` do controller: eles existem para
 * falha de infraestrutura (banco fora do ar, timeout), que não acontece de
 * propósito num teste de integração.
 */
function quebrar(Model, metodo) {
    jest.spyOn(Model, metodo).mockImplementation(() => {
        throw new Error('falha sintética de banco');
    });
}

// O `fileFilter` e o `tratarErroUpload` só se encontram numa requisição real:
// o filtro chama `cb(erro)` e quem transforma isso em resposta é o handler.
// Testar os dois isolados deixaria essa junção sem cobertura.
describe('fileFilter — recusa de formato no pipeline real', () => {
    it('recusa arquivo cujo tipo E extensão não são aceitos', async () => {
        const res = await request(app)
            .post(rota('/importar/preview'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .attach('arquivo', Buffer.from('MZ conteudo binario'), {
                filename: 'payload.exe',
                contentType: 'application/x-msdownload',
            });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/Formato não aceito/i);
    });

    // `.csv` que o navegador rotula como octet-stream é caso comum e legítimo:
    // a extensão salva o upload. Aqui o filtro precisa DEIXAR passar — quem
    // decide o tipo de verdade são os magic bytes, mais adiante.
    it('aceita csv rotulado como octet-stream e recusa só no conteúdo', async () => {
        const res = await request(app)
            .post(rota('/importar/preview'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .attach('arquivo', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), {
                filename: 'lista.csv',
                contentType: 'application/octet-stream',
            });

        // Passou pelo fileFilter (extensão ok) e morreu na checagem de bytes.
        expect(res.status).toBe(422);
        expect(res.body.error).toMatch(/Formato não reconhecido|não permitido/i);
    });
});

describe('controller — respostas 500 não vazam detalhe interno', () => {
    it('listar alunos da turma responde 500 legível', async () => {
        quebrar(Turma, 'findOne');

        const res = await request(app).get(rota()).set('Cookie', cookie);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        // A mensagem é para o usuário; o detalhe técnico fica no log.
        expect(res.body.error).toMatch(/Não foi possível carregar/i);
        expect(JSON.stringify(res.body)).not.toMatch(/falha sintética|at Object|\.js:/);
    });

    it('autocomplete responde 500 legível', async () => {
        quebrar(Aluno, 'find');

        const res = await request(app)
            .get('/api/secretaria/alunos/buscar?q=ana')
            .set('Cookie', cookie);

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Não foi possível buscar/i);
        expect(JSON.stringify(res.body)).not.toMatch(/falha sintética/);
    });

    it('histórico de importações responde 500 legível', async () => {
        quebrar(Turma, 'findOne');

        const res = await request(app).get(rota('/importar/historico')).set('Cookie', cookie);

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/histórico/i);
        expect(JSON.stringify(res.body)).not.toMatch(/falha sintética/);
    });

    it('adicionar aluno responde 500 legível', async () => {
        quebrar(Turma, 'findOne');

        const res = await request(app)
            .post(rota())
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({
                nome: 'ALUNO SINTETICO DE ERRO',
                ra: '900000004444',
                raDigito: 'X',
                raUf: 'SP',
                dataNascimento: '10/03/2015',
            });

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Não foi possível adicionar/i);
        expect(JSON.stringify(res.body)).not.toMatch(/falha sintética/);
    });

    it('remover vínculo responde 500 legível', async () => {
        quebrar(Turma, 'findOne');

        const res = await request(app)
            .delete(rota('/algum-aluno'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test');

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Não foi possível remover/i);
    });

    it('cancelar importação responde 500 legível', async () => {
        quebrar(Turma, 'findOne');

        const res = await request(app)
            .post(rota('/importar/algum-id/cancelar'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Não foi possível cancelar/i);
    });

    it('confirmar importação responde 500 legível', async () => {
        quebrar(Turma, 'findOne');

        const res = await request(app)
            .post(rota('/importar/algum-id/confirmar'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Não foi possível concluir/i);
    });

    it('desfazer importação responde 500 legível', async () => {
        quebrar(Turma, 'findOne');

        const res = await request(app)
            .post(rota('/importar/algum-id/desfazer'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Não foi possível desfazer/i);
    });

    it('preview responde 500 legível e nunca cria sessão de importação', async () => {
        const ImportacaoAlunos = require('../models/ImportacaoAlunos');
        quebrar(Turma, 'findOne');

        const csv = Buffer.from(
            'nome;ra;dig ra;uf ra;data de nascimento\nALUNO SINTETICO UM;900000004445;X;SP;01/02/2015\n',
            'utf8'
        );
        const res = await request(app)
            .post(rota('/importar/preview'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .attach('arquivo', csv, 'lista.csv');

        expect(res.status).toBe(500);
        expect(res.body.error).toMatch(/Não foi possível processar/i);
        // Falha no meio não pode deixar cópia de dado de criança para trás.
        expect(await ImportacaoAlunos.countDocuments({})).toBe(0);
    });
});
