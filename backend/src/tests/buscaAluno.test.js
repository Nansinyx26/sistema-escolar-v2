/**
 * buscaAluno.test.js — regras de busca de aluno compartilhadas pela Secretaria.
 *
 * Cada caso aqui é uma busca que a secretaria fez e voltou vazia com um aluno
 * cadastrado no banco.
 */
const busca = require('../utils/buscaAluno');

/** Aplica um filtro Mongo simples em memória, para testar sem banco. */
function casa(filtro, doc) {
    if (!filtro) return true;
    if (filtro.$and) return filtro.$and.every((f) => casa(f, doc));
    if (filtro.$or) return filtro.$or.some((f) => casa(f, doc));
    return Object.entries(filtro).every(([campo, cond]) => {
        const valor = doc[campo];
        if (cond && typeof cond === 'object' && cond.$regex) {
            if (valor === undefined || valor === null) return false;
            return new RegExp(cond.$regex, cond.$options || '').test(String(valor));
        }
        if (cond && typeof cond === 'object' && cond.$in) {
            return cond.$in.includes(valor);
        }
        if (cond && typeof cond === 'object' && '$ne' in cond) return valor !== cond.$ne;
        return valor === cond;
    });
}

describe('normalizarSala', () => {
    it('colapsa as grafias que convivem na base', () => {
        ['1A', '1ºA', '1º A', '1 a', '1-A'].forEach((grafia) => {
            expect(busca.normalizarSala(grafia)).toBe('1A');
        });
    });

    it('devolve string vazia para valor ausente', () => {
        expect(busca.normalizarSala(null)).toBe('');
        expect(busca.normalizarSala(undefined)).toBe('');
    });
});

describe('filtroDeBusca', () => {
    const joao = {
        nome: 'João',
        sobrenome: 'da Silva Pereira',
        nomeNormalizado: 'joao da silva pereira',
        matricula: '2024001',
        turma: '1ºA',
        codigoSecreto: 'XKCD42',
    };

    it('acha nome acentuado a partir de busca sem acento', () => {
        expect(casa(busca.filtroDeBusca('joao'), joao)).toBe(true);
    });

    it('acha nome sem acento a partir de busca acentuada', () => {
        const legado = { nome: 'JOAO', sobrenome: 'SILVA' };
        expect(casa(busca.filtroDeBusca('joão'), legado)).toBe(true);
    });

    /**
     * REGRESSÃO: a regex única exigia a ordem exata do cadastro, então quem
     * procurava pelo sobrenome primeiro não achava ninguém.
     */
    it('acha com os termos fora de ordem e em campos diferentes', () => {
        expect(casa(busca.filtroDeBusca('silva joao'), joao)).toBe(true);
        expect(casa(busca.filtroDeBusca('pereira joao'), joao)).toBe(true);
    });

    /**
     * REGRESSÃO: `sobrenome` ficava de fora da busca — e é onde metade do nome
     * do aluno mora depois da importação do relatório da SEDUC.
     */
    it('procura também no sobrenome, mesmo sem nomeNormalizado', () => {
        const semNormalizado = { nome: 'Maria', sobrenome: 'Aparecida Souza' };
        expect(casa(busca.filtroDeBusca('souza'), semNormalizado)).toBe(true);
    });

    it('todos os termos precisam casar', () => {
        expect(casa(busca.filtroDeBusca('joao carlos'), joao)).toBe(false);
    });

    it('acha por matrícula', () => {
        expect(casa(busca.filtroDeBusca('2024001'), joao)).toBe(true);
    });

    it('acha por sala digitada junto do nome', () => {
        expect(casa(busca.filtroDeBusca('joao 1A'), joao)).toBe(true);
    });

    it('só procura no código secreto quando o chamador autoriza', () => {
        expect(casa(busca.filtroDeBusca('XKCD42'), joao)).toBe(false);
        expect(casa(busca.filtroDeBusca('XKCD42', { incluirCodigo: true }), joao)).toBe(true);
    });

    it('sem termo não devolve filtro (não restringe nada)', () => {
        expect(busca.filtroDeBusca('')).toBeNull();
        expect(busca.filtroDeBusca('   ')).toBeNull();
        expect(busca.filtroDeBusca(undefined)).toBeNull();
    });

    /** ReDoS: entrada hostil vira literal, não quantificador aninhado. */
    it('escapa metacaracteres do termo', () => {
        const alvo = { nome: 'a+b' };
        expect(casa(busca.filtroDeBusca('(a+)+'), alvo)).toBe(false);
        expect(casa(busca.filtroDeBusca('a+b'), alvo)).toBe(true);
    });
});

describe('filtroDeSala', () => {
    it('casa a sala escrita de outra forma no cadastro do aluno', () => {
        const filtro = busca.filtroDeSala('1A');
        expect(casa(filtro, { turma: '1ºA' })).toBe(true);
        expect(casa(filtro, { turma: '1º A' })).toBe(true);
        expect(casa(filtro, { turmaId: '1 A' })).toBe(true);
    });

    it('não confunde salas diferentes', () => {
        const filtro = busca.filtroDeSala('1A');
        expect(casa(filtro, { turma: '1B' })).toBe(false);
        expect(casa(filtro, { turma: '11A' })).toBe(false);
    });

    it('SERIE_ pega o ano inteiro', () => {
        const filtro = busca.filtroDeSala('SERIE_1');
        expect(casa(filtro, { turma: '1A' })).toBe(true);
        expect(casa(filtro, { turma: '1ºB' })).toBe(true);
        expect(casa(filtro, { turma: '2A' })).toBe(false);
    });

    it('alcança o aluno vinculado pelo _id da turma', () => {
        const filtro = busca.filtroDeSala('1A', { idsEquivalentes: ['abc123'] });
        expect(casa(filtro, { turmaId: 'abc123' })).toBe(true);
    });

    it('sem sala não devolve filtro', () => {
        expect(busca.filtroDeSala('')).toBeNull();
        expect(busca.filtroDeSala(null)).toBeNull();
    });
});

describe('combinar', () => {
    it('preserva o $or da base em vez de sobrescrevê-lo', () => {
        const base = { escolaId: 'e1', $or: [{ turma: '1A' }, { turmaId: '1A' }] };
        const filtro = busca.combinar(base, { $or: [{ nome: { $regex: 'ana' } }] });

        // O aluno da 1A chamado Ana passa...
        expect(casa(filtro, { escolaId: 'e1', turma: '1A', nome: 'ana' })).toBe(true);
        // ...mas o da 2A com o mesmo nome NÃO — era esse o filtro que sumia
        // quando o segundo $or era escrito por cima do primeiro.
        expect(casa(filtro, { escolaId: 'e1', turma: '2A', nome: 'ana' })).toBe(false);
    });

    it('ignora condições nulas', () => {
        expect(busca.combinar({ ativo: true }, null, undefined)).toEqual({ ativo: true });
    });
});
