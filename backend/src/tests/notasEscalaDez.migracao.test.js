/**
 * notasEscalaDez.migracao.test.js — Issue #330.
 *
 * Nota de avaliação que vale menos de 10 era gravada em PONTOS em `Nota.nota`,
 * e o boletim, o portal e as médias da escola somavam esse número como se fosse
 * 0–10. A migração converte o que já está no banco. Este arquivo cobra:
 *
 *   1. a conversão (pontos → 0–10, com os pontos preservados);
 *   2. o arredondamento meio para cima, igual ao do controller;
 *   3. o que NÃO pode ser tocado: pendente, avaliação de valor 10, nota já convertida;
 *   4. idempotência e `down`.
 */

const mongoose = require('mongoose');

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const migracao = require('../../migrations/1789344000000-notas-de-avaliacao-na-escala-dez');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
const colecao = (nome) => mongoose.connection.db.collection(nome);

beforeEach(async () => {
    await limparBanco();
    // `limparBanco` só enxerga coleções de models carregados, e este arquivo usa
    // as coleções cruas, como a própria migração — sem isto, um caso herda as
    // notas do anterior.
    await colecao('notas').deleteMany({});
    await colecao('avaliacoes').deleteMany({});
});

async function avaliacao(valor) {
    const _id = new mongoose.Types.ObjectId().toString();
    await colecao('avaliacoes').insertOne({ _id, titulo: `Vale ${valor}`, valor });
    return _id;
}

async function nota(avaliacaoId, alunoId, campos) {
    await colecao('notas').insertOne({ avaliacaoId, alunoId, ...campos });
}

const notaDe = (alunoId) => colecao('notas').findOne({ alunoId });

describe('migração 1.5 — notas de avaliação na escala 0–10', () => {
    it('converte pontos em 0–10 e guarda os pontos lançados', async () => {
        const id = await avaliacao(5);
        await nota(id, 'a1', { nota: 4, presente: true, status: 'Aprovado' });

        const resultado = await migracao.up();

        expect(resultado.convertidas).toBe(1);
        expect(await notaDe('a1')).toMatchObject({
            nota: 8,
            pontos: 4,
            valorAvaliacao: 5,
            status: 'Aprovado',
        });
    });

    it('arredonda meio para cima, como o lançamento de hoje', async () => {
        const id = await avaliacao(4);
        // 2,5 de 4 = 6,25. O $round do MongoDB daria 6,2 (meio para o par).
        await nota(id, 'a1', { nota: 2.5 });
        // 3,5 de 4 = 8,75 → 8,8.
        await nota(id, 'a2', { nota: 3.5 });

        await migracao.up();

        expect((await notaDe('a1')).nota).toBe(6.3);
        expect((await notaDe('a2')).nota).toBe(8.8);
    });

    it('deixa de fora pendente, valor 10 e nota já convertida', async () => {
        const vale5 = await avaliacao(5);
        const vale10 = await avaliacao(10);
        await nota(vale5, 'pendente', { nota: null });
        await nota(vale10, 'valor-dez', { nota: 7 });
        await nota(vale5, 'ja-convertida', { nota: 8, pontos: 4, valorAvaliacao: 5 });
        await nota(null, 'sem-avaliacao', { nota: 3 }); // nota avulsa, fora de avaliação

        const resultado = await migracao.up();

        expect(resultado.convertidas).toBe(0);
        expect(await notaDe('pendente')).toMatchObject({ nota: null });
        expect(await notaDe('pendente')).not.toHaveProperty('pontos');
        expect((await notaDe('valor-dez')).nota).toBe(7);
        expect(await notaDe('valor-dez')).not.toHaveProperty('pontos');
        expect(await notaDe('ja-convertida')).toMatchObject({ nota: 8, pontos: 4 });
        expect((await notaDe('sem-avaliacao')).nota).toBe(3);
    });

    it('é idempotente: a segunda execução não converte de novo', async () => {
        const id = await avaliacao(5);
        await nota(id, 'a1', { nota: 4 });

        await migracao.up();
        const segunda = await migracao.up();

        expect(segunda.convertidas).toBe(0);
        expect((await notaDe('a1')).nota).toBe(8);
    });

    it('down devolve os pontos a nota e remove os campos novos', async () => {
        const id = await avaliacao(5);
        await nota(id, 'a1', { nota: 4 });
        await migracao.up();

        const resultado = await migracao.down();

        expect(resultado.revertidas).toBe(1);
        const revertida = await notaDe('a1');
        expect(revertida.nota).toBe(4);
        expect(revertida).not.toHaveProperty('pontos');
        expect(revertida).not.toHaveProperty('valorAvaliacao');
    });

    it('o filtro exportado é o mesmo que a migração usa', () => {
        expect(migracao.filtroEmPontos('abc')).toEqual({
            avaliacaoId: 'abc',
            pontos: { $exists: false },
            nota: { $type: 'number' },
        });
    });
});
