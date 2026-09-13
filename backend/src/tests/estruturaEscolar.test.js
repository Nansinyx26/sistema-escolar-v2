/**
 * estruturaEscolar.test.js — grafia canônica de turma e disciplina.
 *
 * O banco grava a mesma sala como "1A", "1ºA", "1º A" e "1º Ano A", e a mesma
 * matéria como "Português", "Língua Portuguesa" e "portugues". A página de
 * Avaliações só mostra uma opção por sala e por disciplina se estas funções
 * reconhecerem todas as grafias — e só não inventa turma se recusarem o resto.
 */

const {
    canonizarTurma,
    grafiasDaTurma,
    agruparPorSerie,
    canonizarLista,
    canonizarDisciplina,
} = require('../services/avaliacoes/estruturaEscolar');

describe('canonizarTurma', () => {
    it.each(['1A', '1ºA', '1º A', '1 A', '1º Ano A', '1° ano - a', ' 1a '])(
        '"%s" é a turma 1ºA',
        (texto) => {
            expect(canonizarTurma(texto)).toEqual({
                id: '1A',
                nome: '1ºA',
                serie: 1,
                serieNome: '1º Ano',
                letra: 'A',
            });
        }
    );

    it.each(['VARIADOS', 'Sala Principal', '1º Ano', 'A', '', null, undefined, '0A', '1AB'])(
        '"%s" não é turma',
        (texto) => {
            expect(canonizarTurma(texto)).toBeNull();
        }
    );

    it('não limita a série: EMEF vai até o 9º ano', () => {
        expect(canonizarTurma('9ºB')?.serieNome).toBe('9º Ano');
    });

    it('lista as grafias equivalentes para consulta por igualdade', () => {
        expect(grafiasDaTurma('1ºA')).toEqual(
            expect.arrayContaining(['1A', '1ºA', '1º A', '1 A', '1º Ano A'])
        );
    });

    it('agrupa por série em ordem, sem repetir sala', () => {
        const turmas = canonizarLista(['2B', '1ºA', '1A', '2ºA', 'VARIADOS', '1 B']);
        expect(turmas.map((t) => t.nome)).toEqual(['1ºA', '1ºB', '2ºA', '2ºB']);
        expect(agruparPorSerie(turmas).map((g) => [g.nome, g.turmas.length])).toEqual([
            ['1º Ano', 2],
            ['2º Ano', 2],
        ]);
    });
});

describe('canonizarDisciplina', () => {
    it.each([
        ['Português', 'Língua Portuguesa'],
        ['portugues', 'Língua Portuguesa'],
        ['Matematica', 'Matemática'],
        ['Artes', 'Arte'],
        ['Ed. Física', 'Educação Física'],
        ['Ingles', 'Inglês'],
    ])('"%s" vira "%s"', (texto, nome) => {
        expect(canonizarDisciplina(texto)?.nome).toBe(nome);
    });

    it.each(['Geral', 'PEB I', 'Sala Principal', 'VARIADOS', ''])('"%s" não é disciplina', (t) => {
        expect(canonizarDisciplina(t)).toBeNull();
    });

    it('mantém disciplina própria da escola com o nome cadastrado', () => {
        expect(canonizarDisciplina('Oficina de Leitura')).toMatchObject({
            nome: 'Oficina de Leitura',
            grupo: 'diversificada',
        });
    });
});
