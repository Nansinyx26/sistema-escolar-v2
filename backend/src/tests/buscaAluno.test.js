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

// ═════════════════════════════════════════════════════════════════════════════
// Autocomplete: o que aparece enquanto a pessoa digita
// ═════════════════════════════════════════════════════════════════════════════

describe('filtroDePrefixo', () => {
    const doc = (nome, extras = {}) => ({
        nome,
        nomeNormalizado: nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
        ...extras,
    });

    it('casa o começo do nome ignorando acento e caixa', () => {
        const filtro = busca.filtroDePrefixo('joao');
        expect(casa(filtro, doc('João Pedro'))).toBe(true);
        expect(casa(filtro, doc('JOÃO'))).toBe(true);
    });

    it('não casa o texto no meio do nome — é isso que o distingue da busca livre', () => {
        // "ana" no fim de "Mariana" é exatamente o casamento que fazia a lista
        // de sugestões parecer aleatória.
        expect(casa(busca.filtroDePrefixo('ana'), doc('Mariana Souza'))).toBe(false);
        expect(casa(busca.filtroDePrefixo('ana'), doc('Ana Beatriz'))).toBe(true);
    });

    it('alcança cadastro legado, que não tem nomeNormalizado', () => {
        expect(casa(busca.filtroDePrefixo('jo'), { nome: 'João Antigo' })).toBe(true);
    });

    it('devolve null sem texto', () => {
        expect(busca.filtroDePrefixo('')).toBeNull();
        expect(busca.filtroDePrefixo(null)).toBeNull();
    });
});

describe('relevanciaDeNome', () => {
    it('separa começo do nome, começo de palavra e meio de palavra', () => {
        expect(busca.relevanciaDeNome('João Pedro', 'joa')).toBe(busca.RELEVANCIA.INICIO);
        expect(busca.relevanciaDeNome('João Pedro', 'ped')).toBe(busca.RELEVANCIA.PALAVRA);
        expect(busca.relevanciaDeNome('João Pedro', 'edr')).toBe(busca.RELEVANCIA.CONTEM);
        expect(busca.relevanciaDeNome('João Pedro', 'maria')).toBe(busca.RELEVANCIA.NENHUMA);
    });

    it('ignora acento nos dois sentidos', () => {
        expect(busca.relevanciaDeNome('João', 'joao')).toBe(busca.RELEVANCIA.INICIO);
        expect(busca.relevanciaDeNome('Erica Lima', 'érica')).toBe(busca.RELEVANCIA.INICIO);
        expect(busca.relevanciaDeNome('José', 'JOSE')).toBe(busca.RELEVANCIA.INICIO);
    });

    it('com vários termos, o texto inteiro como prefixo vale como início', () => {
        expect(busca.relevanciaDeNome('João Pedro Silva', 'joao pe')).toBe(busca.RELEVANCIA.INICIO);
    });

    it('com vários termos fora de ordem, exige que todos apareçam', () => {
        expect(busca.relevanciaDeNome('João da Silva', 'silva joao')).toBe(
            busca.RELEVANCIA.PALAVRA
        );
        expect(busca.relevanciaDeNome('João da Silva', 'silva maria')).toBe(
            busca.RELEVANCIA.NENHUMA
        );
    });
});

describe('ordenarSugestoes', () => {
    // A turma inteira do exemplo da Issue.
    const TURMA = [
        'João',
        'João Pedro',
        'José',
        'Julia',
        'Juliana',
        'Marcos',
        'Maria',
        'Mariana',
    ].map((nome, i) => ({ id: `id${i}`, nome }));

    const nomesPara = (texto) => busca.ordenarSugestoes(TURMA, texto).map((a) => a.nome);

    it('reduz a lista a cada letra digitada', () => {
        expect(nomesPara('J')).toEqual(['João', 'João Pedro', 'José', 'Julia', 'Juliana']);
        expect(nomesPara('Jo')).toEqual(['João', 'João Pedro', 'José']);
        expect(nomesPara('Joa')).toEqual(['João', 'João Pedro']);
        expect(nomesPara('João')).toEqual(['João', 'João Pedro']);
        expect(nomesPara('Jul')).toEqual(['Julia', 'Juliana']);
        expect(nomesPara('Mar')).toEqual(['Marcos', 'Maria', 'Mariana']);
    });

    it('não devolve nada que não case com o texto', () => {
        expect(nomesPara('xyz')).toEqual([]);
        expect(nomesPara('Jo')).not.toContain('Marcos');
    });

    it('quem começa com o texto vem antes de quem apenas o contém', () => {
        const lista = [
            { id: 'a', nome: 'Mariana Souza' }, // contém "ana" no meio
            { id: 'b', nome: 'Ana Beatriz' }, // começa com "ana"
            { id: 'c', nome: 'Beatriz Anastácio' }, // começa uma palavra com "ana"
        ];
        expect(busca.ordenarSugestoes(lista, 'ana').map((a) => a.nome)).toEqual([
            'Ana Beatriz',
            'Beatriz Anastácio',
            'Mariana Souza',
        ]);
    });

    it('ordena alfabeticamente dentro do mesmo grau de relevância', () => {
        const lista = [
            { id: 'a', nome: 'Julia Zanetti' },
            { id: 'b', nome: 'Juliana Alves' },
            { id: 'c', nome: 'Juliana Abreu' },
        ];
        expect(busca.ordenarSugestoes(lista, 'jul').map((a) => a.nome)).toEqual([
            'Julia Zanetti',
            'Juliana Abreu',
            'Juliana Alves',
        ]);
    });

    it('não repete o mesmo aluno vindo das duas etapas de consulta', () => {
        const repetido = { id: 'x1', nome: 'João Pedro' };
        expect(busca.ordenarSugestoes([repetido, { ...repetido }], 'joao')).toHaveLength(1);
    });

    it('respeita o limite pedido', () => {
        const muitos = Array.from({ length: 40 }, (_, i) => ({
            id: `id${i}`,
            nome: `Joana ${String(i).padStart(2, '0')}`,
        }));
        expect(busca.ordenarSugestoes(muitos, 'joana', { limite: 10 })).toHaveLength(10);
    });

    it('relevanciaMaxima recusa o casamento no meio da palavra', () => {
        const lista = [{ id: 'a', nome: 'Mariana Souza' }];
        expect(busca.ordenarSugestoes(lista, 'ana')).toHaveLength(1);
        expect(
            busca.ordenarSugestoes(lista, 'ana', { relevanciaMaxima: busca.RELEVANCIA.PALAVRA })
        ).toHaveLength(0);
    });
});
