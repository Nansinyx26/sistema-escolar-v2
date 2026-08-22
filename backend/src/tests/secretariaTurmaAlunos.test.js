/**
 * secretariaTurmaAlunos.test.js
 * Alunos dentro de uma turma: cadastro individual (Fluxo A) e importação em
 * lote (Fluxo B) — do endpoint até o banco.
 *
 * O foco aqui é o que o teste unitário do parser NÃO alcança: isolamento
 * multi-escola (IDOR), idempotência da regravação e o desfazer seletivo.
 *
 * ⚠️ Fixtures 100% SINTÉTICAS (§7.8). Nenhum RA, nome ou data real.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');

const Escola = require('../models/Escola');
const Secretaria = require('../models/Secretaria');
const Turma = require('../models/Turma');
const Aluno = require('../models/Aluno');
const Matricula = require('../models/Matricula');
const ImportacaoAlunos = require('../models/ImportacaoAlunos');

const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { construirXlsx } = require('./fixtures/construirXlsx');

const ANO_LETIVO = 2026;

let escolaA;
let escolaB;
let turmaA;
let turmaB;
let cookieA;
let cookieB;

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
        nome: 'EE Sintetica A',
        tipo: 'EMEF',
        bairro: 'A',
        codigoSecreto: 'COD-A-1',
        ativo: true,
    });
    escolaB = await Escola.create({
        nome: 'EE Sintetica B',
        tipo: 'EMEF',
        bairro: 'B',
        codigoSecreto: 'COD-B-2',
        ativo: true,
    });

    turmaA = await Turma.create({
        id: '5A',
        nome: '5A',
        ano: ANO_LETIVO,
        escolaId: String(escolaA._id),
        ativo: true,
    });
    turmaB = await Turma.create({
        id: '5B',
        nome: '5B',
        ano: ANO_LETIVO,
        escolaId: String(escolaB._id),
        ativo: true,
    });

    cookieA = await cookieSecretaria(escolaA);
    cookieB = await cookieSecretaria(escolaB);
});

/** Cria uma secretaria vinculada a UMA escola e devolve o cookie JWT dela. */
async function cookieSecretaria(escola) {
    const usuario = await criarUsuario({
        perfil: 'secretaria',
        nome: 'Secretaria Sintetica',
        email: `sec_${String(escola._id).slice(-6)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@escola.test`,
    });
    await Secretaria.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        escolaId: String(escola._id),
        vinculos: [{ escolaId: String(escola._id), cargo: 'secretaria' }],
    });

    const token = jwt.sign(
        { id: usuario._id, perfil: usuario.perfil, email: usuario.email, nome: usuario.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

const rota = (turmaId, sufixo = '') => `/api/secretaria/turmas/${turmaId}/alunos${sufixo}`;

/** Aluno sintético válido para o Fluxo A. */
const alunoValido = (extras = {}) => ({
    nome: 'ANA CLARA FICTICIA DE SOUZA',
    ra: '900000000001',
    raDigito: 'X',
    raUf: 'SP',
    dataNascimento: '10/03/2015',
    anoLetivo: ANO_LETIVO,
    ...extras,
});

/** CSV sintético com `quantidade` alunos. */
function csvSintetico(quantidade, deslocamento = 0) {
    const linhas = ['nome;ra;dig ra;uf ra;data de nascimento;nr;serie'];
    for (let n = 1; n <= quantidade; n++) {
        const indice = n + deslocamento;
        linhas.push(
            `ALUNO SINTETICO NUMERO ${indice};9000000001${String(indice).padStart(2, '0')};${indice % 3 === 0 ? 'X' : indice % 10};SP;0${(indice % 9) + 1}/03/2014;${n};5`
        );
    }
    return Buffer.from(`${linhas.join('\n')}\n`, 'utf8');
}

// ═════════════════════════════════════════════════════════════════════════════

describe('autorização e isolamento multi-escola', () => {
    it('exige autenticação em todas as rotas do módulo', async () => {
        const semAuth = [
            request(app).get(rota(turmaA._id)),
            request(app).post(rota(turmaA._id)).send(alunoValido()),
            request(app).get('/api/secretaria/alunos/buscar?q=ana'),
            request(app).post(rota(turmaA._id, '/importar/preview')),
        ];

        for (const requisicao of semAuth) {
            const resposta = await requisicao.set('X-CSRF-Token', 'test');
            expect(resposta.status).toBe(401);
        }
    });

    it('bloqueia a secretaria da escola A em uma turma da escola B (IDOR pela URL)', async () => {
        // Mesma requisição, só o ID da turma muda. Sem a checagem de tenant,
        // esta chamada listaria os alunos da outra escola da rede.
        const listar = await request(app).get(rota(turmaB._id)).set('Cookie', cookieA);
        expect(listar.status).toBe(404);

        const criar = await request(app)
            .post(rota(turmaB._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido());
        expect(criar.status).toBe(404);
        expect(await Aluno.countDocuments({})).toBe(0);

        const importar = await request(app)
            .post(rota(turmaB._id, '/importar/preview'))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .attach('arquivo', csvSintetico(2), 'lista.csv');
        expect(importar.status).toBe(404);
        expect(await ImportacaoAlunos.countDocuments({})).toBe(0);
    });

    it('não devolve aluno de outra escola no autocomplete', async () => {
        await Aluno.create({
            nome: 'ALUNO DA OUTRA ESCOLA',
            matricula: '900000000777',
            escolaId: String(escolaB._id),
            ativo: true,
        });

        const resposta = await request(app)
            .get('/api/secretaria/alunos/buscar?q=aluno')
            .set('Cookie', cookieA);

        expect(resposta.status).toBe(200);
        expect(resposta.body.data.alunos).toHaveLength(0);
    });
});

describe('Fluxo A — adicionar aluno individualmente', () => {
    it('cria o aluno, vincula à turma e devolve o código de acesso', async () => {
        const resposta = await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(
                alunoValido({
                    numeroChamada: 7,
                    serie: '5',
                    possuiDeficiencia: true,
                    transtornos: 'TDAH, Dislexia',
                })
            );

        expect(resposta.status).toBe(201);
        expect(resposta.body.success).toBe(true);
        expect(resposta.body.data.aluno.codigoSecreto).toBeTruthy();
        expect(resposta.body.data.aluno.numeroChamada).toBe(7);

        const aluno = await Aluno.findOne({ matricula: '900000000001' }).lean();
        expect(aluno.escolaId).toBe(String(escolaA._id));
        expect(aluno.raDigito).toBe('X');
        expect(aluno.raUf).toBe('SP');
        expect(aluno.nomeNormalizado).toBe('ana clara ficticia de souza');
        expect(aluno.origemCadastro).toBe('manual');
        expect(aluno.pcd).toBe(true);
        expect(aluno.transtornos).toEqual(['TDAH', 'Dislexia']);

        const matricula = await Matricula.findOne({ alunoId: String(aluno._id) }).lean();
        expect(matricula.turmaId).toBe(String(turmaA._id));
        expect(matricula.anoLetivo).toBe(ANO_LETIVO);

        // Aparece na listagem sem nenhum passo extra.
        const lista = await request(app).get(rota(turmaA._id)).set('Cookie', cookieA);
        expect(lista.body.data.total).toBe(1);
        expect(lista.body.data.alunos[0].ra).toBe('900000000001');
        expect(lista.body.data.alunos[0].nomeExibicao).toBe('Ana Clara Ficticia de Souza');
    });

    it('oferece o VÍNCULO quando o RA já existe na escola, em vez de erro genérico', async () => {
        await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido());

        const outraTurma = await Turma.create({
            id: '5C',
            nome: '5C',
            ano: ANO_LETIVO,
            escolaId: String(escolaA._id),
            ativo: true,
        });

        const repetido = await request(app)
            .post(rota(outraTurma._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido());

        expect(repetido.status).toBe(409);
        expect(repetido.body.codigo).toBe('RA_DUPLICADO');
        expect(repetido.body.error).toMatch(/Deseja vinculá-lo a esta turma/i);
        // O alunoId volta para o front conseguir oferecer o vínculo direto.
        expect(repetido.body.data.alunoId).toBeTruthy();
        expect(await Aluno.countDocuments({ matricula: '900000000001' })).toBe(1);

        // E o vínculo pelo alunoId funciona.
        const vinculo = await request(app)
            .post(rota(outraTurma._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({ alunoId: repetido.body.data.alunoId, anoLetivo: ANO_LETIVO });
        expect(vinculo.status).toBe(201);
        expect(vinculo.body.data.vinculado).toBe(true);
    });

    it('recusa o mesmo aluno duas vezes na MESMA turma', async () => {
        const criado = await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido());

        const repetido = await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({ alunoId: criado.body.data.aluno.id, anoLetivo: ANO_LETIVO });

        expect(repetido.status).toBe(409);
        expect(repetido.body.error).toMatch(/já está matriculado nesta turma/i);
    });

    it('valida os campos obrigatórios no servidor', async () => {
        const casos = [
            [alunoValido({ nome: 'Ana' }), /nome e sobrenome/i],
            [alunoValido({ ra: '123' }), /12 dígitos/i],
            [alunoValido({ dataNascimento: '31/02/2015' }), /inválida/i],
            [alunoValido({ dataNascimento: '10/03/2099' }), /futuro/i],
        ];

        for (const [corpo, mensagem] of casos) {
            const resposta = await request(app)
                .post(rota(turmaA._id))
                .set('Cookie', cookieA)
                .set('X-CSRF-Token', 'test')
                .send(corpo);
            expect(resposta.status).toBe(400);
            expect(resposta.body.detalhes.join(' ')).toMatch(mensagem);
        }
        expect(await Aluno.countDocuments({})).toBe(0);
    });

    it('aceita idade fora da faixa usual com aviso (EJA), sem bloquear', async () => {
        const resposta = await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido({ dataNascimento: '10/03/1980' }));

        expect(resposta.status).toBe(201);
        expect(resposta.body.data.avisos.join(' ')).toMatch(/fora da faixa usual/i);
    });

    it('remove o vínculo com a turma sem apagar o aluno da escola', async () => {
        const criado = await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido());
        const alunoId = criado.body.data.aluno.id;

        const remocao = await request(app)
            .delete(rota(turmaA._id, `/${alunoId}?anoLetivo=${ANO_LETIVO}`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test');

        expect(remocao.status).toBe(200);
        expect(await Matricula.countDocuments({ alunoId })).toBe(0);
        // O aluno continua existindo na escola.
        expect(await Aluno.countDocuments({ _id: alunoId })).toBe(1);
    });

    it('encontra o aluno no autocomplete por nome e por RA', async () => {
        await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido());

        const porNome = await request(app)
            .get('/api/secretaria/alunos/buscar?q=clara')
            .set('Cookie', cookieA);
        expect(porNome.body.data.alunos).toHaveLength(1);

        // Acento não pode atrapalhar: a busca usa o nome normalizado.
        const semAcento = await request(app)
            .get('/api/secretaria/alunos/buscar?q=ficticia')
            .set('Cookie', cookieA);
        expect(semAcento.body.data.alunos).toHaveLength(1);

        const porRa = await request(app)
            .get('/api/secretaria/alunos/buscar?q=900000000')
            .set('Cookie', cookieA);
        expect(porRa.body.data.alunos).toHaveLength(1);

        // Abaixo de 3 caracteres não consulta o banco.
        const curto = await request(app)
            .get('/api/secretaria/alunos/buscar?q=an')
            .set('Cookie', cookieA);
        expect(curto.body.data.alunos).toHaveLength(0);
    });
});

describe('Fluxo B — importação em lote', () => {
    async function preview(cookie, turmaId, buffer, nomeArquivo = 'lista.csv') {
        return request(app)
            .post(rota(turmaId, '/importar/preview'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .field('anoLetivo', String(ANO_LETIVO))
            .attach('arquivo', buffer, nomeArquivo);
    }

    it('gera a pré-visualização SEM gravar nenhum aluno', async () => {
        const resposta = await preview(cookieA, turmaA._id, csvSintetico(5));

        expect(resposta.status).toBe(201);
        expect(resposta.body.data.linhas).toHaveLength(5);
        expect(resposta.body.data.resumo).toMatchObject({
            total: 5,
            novos: 5,
            comErro: 0,
            importaveis: 5,
        });

        // Nada foi para o banco ainda — este é o ponto do passo de preview.
        expect(await Aluno.countDocuments({})).toBe(0);
        expect(await Matricula.countDocuments({})).toBe(0);

        const sessao = await ImportacaoAlunos.findById(resposta.body.data.importacaoId).lean();
        expect(sessao.status).toBe('preview');
        expect(sessao.escolaId).toBe(String(escolaA._id));
        expect(sessao.hashArquivo).toMatch(/^[a-f0-9]{64}$/);
        // TTL definido para ~2h à frente.
        expect(sessao.expiraEm.getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
    });

    it('grava em massa ao confirmar, com código de acesso para cada aluno criado', async () => {
        const previa = await preview(cookieA, turmaA._id, csvSintetico(5));

        const confirmacao = await request(app)
            .post(rota(turmaA._id, `/importar/${previa.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(confirmacao.status).toBe(200);
        expect(confirmacao.body.data.criados).toBe(5);
        expect(confirmacao.body.data.vinculados).toBe(5);
        expect(confirmacao.body.data.falhas).toHaveLength(0);

        const alunos = await Aluno.find({}).lean();
        expect(alunos).toHaveLength(5);
        alunos.forEach((aluno) => {
            expect(aluno.escolaId).toBe(String(escolaA._id));
            expect(aluno.origemCadastro).toBe('importacao_planilha');
            expect(aluno.importacaoId).toBe(previa.body.data.importacaoId);
            // O pre-save não roda em bulkWrite; sem o passo de atribuição em
            // lote o responsável não conseguiria se vincular ao filho.
            expect(aluno.codigoSecreto).toBeTruthy();
            expect(aluno.nomeNormalizado).toBeTruthy();
        });

        expect(
            await Matricula.countDocuments({ turmaId: String(turmaA._id), anoLetivo: ANO_LETIVO })
        ).toBe(5);

        const lista = await request(app).get(rota(turmaA._id)).set('Cookie', cookieA);
        expect(lista.body.data.total).toBe(5);
    });

    it('importar o MESMO arquivo duas vezes não cria duplicata', async () => {
        const arquivo = csvSintetico(5);

        const primeira = await preview(cookieA, turmaA._id, arquivo);
        await request(app)
            .post(rota(turmaA._id, `/importar/${primeira.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        // Segunda passada: todas as linhas já estão na turma.
        const segunda = await preview(cookieA, turmaA._id, arquivo);
        expect(segunda.body.data.resumo).toMatchObject({
            total: 5,
            novos: 0,
            jaNaTurma: 5,
            importaveis: 0,
        });

        const confirmacao = await request(app)
            .post(rota(turmaA._id, `/importar/${segunda.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(confirmacao.body.data.criados).toBe(0);
        expect(confirmacao.body.data.vinculados).toBe(0);
        expect(await Aluno.countDocuments({})).toBe(5);
        expect(await Matricula.countDocuments({})).toBe(5);
    });

    it('confirmar duas vezes a MESMA sessão não duplica (duplo clique)', async () => {
        const previa = await preview(cookieA, turmaA._id, csvSintetico(3));
        const url = rota(turmaA._id, `/importar/${previa.body.data.importacaoId}/confirmar`);

        const primeira = await request(app)
            .post(url)
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});
        const segunda = await request(app)
            .post(url)
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(primeira.body.data.criados).toBe(3);
        // A sessão saiu de 'preview'; a segunda chamada não encontra mais nada.
        expect(segunda.status).toBe(404);
        expect(await Aluno.countDocuments({})).toBe(3);
    });

    it('grava apenas os índices selecionados', async () => {
        const previa = await preview(cookieA, turmaA._id, csvSintetico(5));

        const confirmacao = await request(app)
            .post(rota(turmaA._id, `/importar/${previa.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({ indices: [0, 2] });

        expect(confirmacao.body.data.criados).toBe(2);
        expect(await Aluno.countDocuments({})).toBe(2);
    });

    it('classifica linha inválida como erro e não a grava', async () => {
        const csv = Buffer.from(
            [
                'nome;ra;dig ra;uf ra;data de nascimento',
                'ALUNO SINTETICO VALIDO;900000000101;1;SP;01/03/2014',
                ';900000000102;2;SP;01/03/2014', // sem nome
                'ALUNO SINTETICO SEM RA;123;3;SP;01/03/2014', // RA curto
            ].join('\n'),
            'utf8'
        );

        const previa = await preview(cookieA, turmaA._id, csv);
        expect(previa.body.data.resumo).toMatchObject({
            total: 3,
            novos: 1,
            comErro: 2,
            importaveis: 1,
        });

        await request(app)
            .post(rota(turmaA._id, `/importar/${previa.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(await Aluno.countDocuments({})).toBe(1);
    });

    it('marca a primeira ocorrência e ignora o RA repetido dentro do arquivo', async () => {
        const csv = Buffer.from(
            [
                'nome;ra;dig ra;uf ra;data de nascimento',
                'ALUNO SINTETICO REPETIDO;900000000201;1;SP;01/03/2014',
                'ALUNO SINTETICO REPETIDO;900000000201;1;SP;01/03/2014',
            ].join('\n'),
            'utf8'
        );

        const previa = await preview(cookieA, turmaA._id, csv);
        expect(previa.body.data.resumo).toMatchObject({ duplicados: 1, importaveis: 1 });

        await request(app)
            .post(rota(turmaA._id, `/importar/${previa.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(await Aluno.countDocuments({ matricula: '900000000201' })).toBe(1);
    });

    it('importa XLSX com data em número serial do Excel', async () => {
        const xlsx = construirXlsx([
            ['Nr', 'Nome do Aluno', 'RA', 'Dig. RA', 'UF RA', 'Data de Nascimento'],
            [1, 'ALUNO SINTETICO PLANILHA UM', '900000000301', 'X', 'SP', { serial: 42005 }],
            [2, 'ALUNO SINTETICO PLANILHA DOIS', '900000000302', '2', 'SP', '05/06/2015'],
        ]);

        const previa = await preview(cookieA, turmaA._id, xlsx, 'alunos.xlsx');
        expect(previa.status).toBe(201);
        expect(previa.body.data.tipoArquivo).toBe('xlsx');
        expect(previa.body.data.resumo.novos).toBe(2);

        await request(app)
            .post(rota(turmaA._id, `/importar/${previa.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        const aluno = await Aluno.findOne({ matricula: '900000000301' }).lean();
        expect(aluno.nascimento.toISOString().slice(0, 10)).toBe('2015-01-01');
        expect(aluno.raDigito).toBe('X');
    });

    it('recusa arquivo de tipo não suportado', async () => {
        const executavel = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
        const resposta = await preview(cookieA, turmaA._id, executavel, 'lista.csv');

        expect(resposta.status).toBe(422);
        expect(await ImportacaoAlunos.countDocuments({})).toBe(0);
    });

    it('cancela a pré-visualização e descarta as linhas', async () => {
        const previa = await preview(cookieA, turmaA._id, csvSintetico(3));

        const cancelamento = await request(app)
            .post(rota(turmaA._id, `/importar/${previa.body.data.importacaoId}/cancelar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(cancelamento.status).toBe(200);
        const sessao = await ImportacaoAlunos.findById(previa.body.data.importacaoId).lean();
        expect(sessao.status).toBe('cancelada');
        // Minimização de dado: cancelou, a cópia dos alunos some.
        expect(sessao.linhas).toHaveLength(0);
        expect(await Aluno.countDocuments({})).toBe(0);
    });

    it('a secretaria da escola B não confirma uma importação da escola A', async () => {
        const previa = await preview(cookieA, turmaA._id, csvSintetico(3));

        const invasao = await request(app)
            .post(rota(turmaB._id, `/importar/${previa.body.data.importacaoId}/confirmar`))
            .set('Cookie', cookieB)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(invasao.status).toBe(404);
        expect(await Aluno.countDocuments({})).toBe(0);
    });
});

describe('desfazer importação', () => {
    it('remove apenas o que o lote criou, preservando quem já existia', async () => {
        // Aluno que JÁ existia antes da importação, cadastrado à mão.
        const preexistente = await request(app)
            .post(rota(turmaA._id))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send(alunoValido({ nome: 'ALUNO SINTETICO PREEXISTENTE', ra: '900000000102' }));
        expect(preexistente.status).toBe(201);

        // O arquivo traz esse mesmo aluno (RA 900000000102) + dois novos.
        const previa = await preview(cookieA, turmaA._id, csvSintetico(3, 1));
        const importacaoId = previa.body.data.importacaoId;

        await request(app)
            .post(rota(turmaA._id, `/importar/${importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(await Aluno.countDocuments({})).toBe(3);

        const desfazer = await request(app)
            .post(rota(turmaA._id, `/importar/${importacaoId}/desfazer`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        expect(desfazer.status).toBe(200);
        expect(desfazer.body.data.alunosRemovidos).toBe(2);

        // O aluno cadastrado à mão continua existindo — ele não foi criado
        // pelo lote, e apagá-lo seria perda de dado real.
        const sobreviventes = await Aluno.find({}).lean();
        expect(sobreviventes).toHaveLength(1);
        expect(sobreviventes[0].matricula).toBe('900000000102');
        expect(sobreviventes[0].origemCadastro).toBe('manual');

        const sessao = await ImportacaoAlunos.findById(importacaoId).lean();
        expect(sessao.status).toBe('desfeita');
    });

    it('lista o lote como desfazível no histórico e recusa desfazer duas vezes', async () => {
        const previa = await preview(cookieA, turmaA._id, csvSintetico(2));
        const importacaoId = previa.body.data.importacaoId;

        await request(app)
            .post(rota(turmaA._id, `/importar/${importacaoId}/confirmar`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        const historico = await request(app)
            .get(rota(turmaA._id, '/importar/historico'))
            .set('Cookie', cookieA);
        expect(historico.status).toBe(200);
        expect(historico.body.data.lotes[0]).toMatchObject({ importacaoId, podeDesfazer: true });

        await request(app)
            .post(rota(turmaA._id, `/importar/${importacaoId}/desfazer`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});

        const segunda = await request(app)
            .post(rota(turmaA._id, `/importar/${importacaoId}/desfazer`))
            .set('Cookie', cookieA)
            .set('X-CSRF-Token', 'test')
            .send({});
        expect(segunda.status).toBe(404);
    });

    async function preview(cookie, turmaId, buffer, nomeArquivo = 'lista.csv') {
        return request(app)
            .post(rota(turmaId, '/importar/preview'))
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .field('anoLetivo', String(ANO_LETIVO))
            .attach('arquivo', buffer, nomeArquivo);
    }
});
