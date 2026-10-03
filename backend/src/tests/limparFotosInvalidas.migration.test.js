/**
 * limparFotosInvalidas.migration.test.js — Issue #584
 *
 * A #572 passou a recusar `foto` fora do formato nas gravações novas; esta
 * migração limpa o que foi gravado antes. Os documentos são inseridos direto
 * na coleção, como já estão no banco — sem passar pelo middleware.
 */
const mongoose = require('mongoose');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const migration = require('../../migrations/1790992254198-limpar-fotos-invalidas');

const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const Aluno = require('../models/Aluno');
const Comentario = require('../models/Comentario');

const colecao = (Model) => mongoose.connection.db.collection(Model.collection.collectionName);

const INVALIDAS = [
    'x" onerror="window.__xss=1',
    "gridfs:000000000000000000000000' onerror='x",
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'https://exemplo.test/a.png" onload="x',
];

// Fica intacto: o que é válido E o que é inválido mas inofensivo — não sai de
// um atributo entre aspas nem executa (http://, nome com espaço).
const VALIDAS = [
    'gridfs:65f1a2b3c4d5e6f708192a3b',
    '65f1a2b3c4d5e6f708192a3b',
    '/api/files/65f1a2b3c4d5e6f708192a3b',
    'https://lh3.googleusercontent.com/a/ACg8ocK-abc=s96-c',
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
    'http://sistema-escolar-bfty.onrender.com/api/files/65f1a2b3c4d5e6f708192a3b',
    'foto do aluno.jpg',
];

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

let sequencia = 0;

async function inserirFotos(Model, campo, valores) {
    // `usuarios.email` e `secretarias.idUsuario` têm índice único.
    const { insertedIds } = await colecao(Model).insertMany(
        valores.map((valor) => {
            sequencia += 1;
            return {
                nome: `Pessoa ${sequencia}`,
                email: `pessoa${sequencia}@exemplo.test`,
                idUsuario: `usuario-${sequencia}`,
                [campo]: valor,
            };
        })
    );
    return Object.values(insertedIds);
}

async function valoresDe(Model, campo, ids) {
    const docs = await colecao(Model)
        .find({ _id: { $in: ids } })
        .toArray();
    const porId = new Map(docs.map((d) => [String(d._id), d[campo]]));
    return ids.map((id) => porId.get(String(id)));
}

describe('migração 1790992254198-limpar-fotos-invalidas', () => {
    it.each([
        ['usuarios.foto', Usuario, 'foto'],
        ['usuarios.fotoGoogle', Usuario, 'fotoGoogle'],
        ['professores.foto', Professor, 'foto'],
        ['diretores.foto', Diretor, 'foto'],
        ['secretarias.foto', Secretaria, 'foto'],
        ['alunos.foto', Aluno, 'foto'],
        ['comentarios.usuarioFoto', Comentario, 'usuarioFoto'],
    ])('%s: zera o inválido e não toca no válido', async (_rotulo, Model, campo) => {
        const idsInvalidas = await inserirFotos(Model, campo, INVALIDAS);
        const idsValidas = await inserirFotos(Model, campo, VALIDAS);

        const resultado = await migration.up();

        expect(await valoresDe(Model, campo, idsInvalidas)).toEqual(INVALIDAS.map(() => ''));
        expect(await valoresDe(Model, campo, idsValidas)).toEqual(VALIDAS);
        expect(resultado.total).toBe(INVALIDAS.length);
        expect(resultado.limpos).toEqual({
            [`${Model.collection.collectionName}.${campo}`]: INVALIDAS.length,
        });
    });

    it('é idempotente: a segunda execução não limpa nada', async () => {
        await inserirFotos(Usuario, 'foto', [...INVALIDAS, ...VALIDAS]);

        await migration.up();
        const segunda = await migration.up();

        expect(segunda.total).toBe(0);
        expect(segunda.limpos).toEqual({});
    });

    it('ignora vazio, nulo e documento sem o campo', async () => {
        await colecao(Aluno).insertMany([
            { nome: 'A', foto: '' },
            { nome: 'B', foto: null },
            { nome: 'C' },
        ]);

        const resultado = await migration.up();

        expect(resultado.total).toBe(0);
        const alunos = await colecao(Aluno).find({}).sort({ nome: 1 }).toArray();
        expect(alunos.map((a) => a.foto)).toEqual(['', null, undefined]);
    });

    it('o resultado e o log não carregam o valor removido', async () => {
        await inserirFotos(Professor, 'foto', INVALIDAS);
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});

        const resultado = await migration.up();

        const tudo = JSON.stringify(resultado) + JSON.stringify(log.mock.calls);
        for (const valor of INVALIDAS) expect(tudo).not.toContain(valor);
        log.mockRestore();
    });

    it('down não restaura nada', async () => {
        const [id] = await inserirFotos(Usuario, 'foto', [INVALIDAS[0]]);
        await migration.up();

        await migration.down();

        expect(await valoresDe(Usuario, 'foto', [id])).toEqual(['']);
    });
});
