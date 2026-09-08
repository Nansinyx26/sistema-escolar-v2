/**
 * educacenso.test.js — a tradução do cadastro para o vocabulário do INEP.
 *
 * O QUE ESTES TESTES PROTEGEM
 * ---------------------------
 * O Censo Escolar é declaração anual de onde sai o repasse do Fundeb. Dois
 * erros custam dinheiro à escola e são invisíveis até o prazo fechar:
 *
 *   1. dado que existe no cadastro e se perde na tradução (a etnia escrita
 *      "Parda " com espaço, que não casa com o domínio e vira "não declarada"
 *      sem ninguém perceber); e
 *   2. aluno com deficiência declarada sem o TIPO da deficiência — o "sim"
 *      sozinho não gera o repasse adicional da educação especial.
 *
 * Por isso quase todo caso aqui verifica a PENDÊNCIA, não só o código: o valor
 * do módulo está em apontar o que falta enquanto ainda dá tempo de corrigir.
 */
const { mapearAluno, montarLote, COR_RACA } = require('../services/conformidade/educacenso');

const alunoCompleto = (extras = {}) => ({
    _id: 'aluno-1',
    nome: 'Ana',
    sobrenome: 'Souza',
    matricula: '2026001',
    nascimento: new Date('2015-04-10T00:00:00Z'),
    sexo: 'Feminino',
    etnia: 'Parda',
    nacionalidade: 'Brasileira',
    turma: '3A',
    ...extras,
});

describe('tradução para os domínios do INEP', () => {
    it('converte cor/raça, nacionalidade e sexo para os códigos oficiais', () => {
        const { registro, pendencias } = mapearAluno(alunoCompleto());
        expect(registro.corRaca).toBe(3);
        expect(registro.corRacaDescricao).toBe(COR_RACA[3]);
        expect(registro.nacionalidade).toBe(1);
        expect(registro.sexo).toBe(2);
        expect(registro.nome).toBe('Ana Souza');
        expect(pendencias).toEqual([]);
    });

    it('aceita as variações que o cadastro real produz (caixa, acento, espaço)', () => {
        // O mesmo campo é preenchido por digitação manual, importação de
        // planilha e relatório da SEDUC. Exigir grafia exata reprovaria a rede
        // inteira por causa de "INDÍGENA" em caixa alta.
        expect(mapearAluno(alunoCompleto({ etnia: '  INDÍGENA ' })).registro.corRaca).toBe(5);
        expect(mapearAluno(alunoCompleto({ sexo: 'M' })).registro.sexo).toBe(1);
        expect(
            mapearAluno(alunoCompleto({ nacionalidade: 'estrangeiro' })).registro.nacionalidade
        ).toBe(3);
    });

    it('aceita o código numérico já gravado, mas recusa número fora do domínio', () => {
        expect(mapearAluno(alunoCompleto({ etnia: 4 })).registro.corRaca).toBe(4);
        const fora = mapearAluno(alunoCompleto({ etnia: 9 }));
        expect(fora.registro.corRaca).toBeNull();
        expect(fora.pendencias.join(' ')).toMatch(/Cor\/raça/);
    });

    it('não silencia como "não declarada" uma etnia que existe e não foi reconhecida', () => {
        // Este é o erro caro: o dado ESTÁ no cadastro, a declaração sai sem ele
        // e ninguém revisa, porque "não declarada" é um valor válido.
        const { registro, pendencias } = mapearAluno(alunoCompleto({ etnia: 'Morena' }));
        expect(registro.corRaca).toBeNull();
        expect(pendencias.some((p) => p.includes('Morena'))).toBe(true);
    });

    it('campo em branco vira pendência, não código zero', () => {
        const { pendencias } = mapearAluno(alunoCompleto({ etnia: '', sexo: undefined }));
        expect(pendencias).toContain('Cor/raça');
        expect(pendencias).toContain('Sexo');
    });
});

describe('deficiência declarada e o repasse do Fundeb', () => {
    it('exige o tipo quando há deficiência', () => {
        const { registro, pendencias } = mapearAluno(alunoCompleto({ pcd: true }));
        expect(registro.possuiDeficiencia).toBe(true);
        expect(registro.tipoDeficiencia).toBeNull();
        expect(pendencias.join(' ')).toMatch(/Tipo de deficiência/);
    });

    it('sem deficiência, não cobra o tipo nem carrega descrição órfã', () => {
        const { registro, pendencias } = mapearAluno(
            alunoCompleto({ pcd: false, deficiencia: 'texto residual de edição anterior' })
        );
        expect(registro.tipoDeficiencia).toBeNull();
        expect(pendencias).toEqual([]);
    });
});

describe('lote da escola', () => {
    const escola = {
        nome: 'EMEF Jaguari',
        municipio: 'Americana',
        codigoInep: '35123456',
        dependenciaAdministrativa: 'MUNICIPAL',
    };

    it('marca o lote como pronto só quando não há pendência nenhuma', () => {
        const lote = montarLote({ escola, alunos: [alunoCompleto()], anoCenso: 2026 });
        expect(lote.cabecalho.dependenciaAdministrativa).toBe(3);
        expect(lote.cabecalho.anoCenso).toBe(2026);
        expect(lote.resumo).toMatchObject({ totalAlunos: 1, alunosComPendencia: 0, pronto: true });
    });

    it('escola sem código INEP bloqueia o lote inteiro, mesmo com alunos completos', () => {
        // O Educacenso identifica a unidade pelo código; sem ele não há a quem
        // atribuir as matrículas — o arquivo não serve nem parcialmente.
        const lote = montarLote({
            escola: { ...escola, codigoInep: null },
            alunos: [alunoCompleto()],
        });
        expect(lote.pendenciasEscola).toContain('Código INEP da escola');
        expect(lote.resumo.pronto).toBe(false);
    });

    it('lista a pendência por aluno com nome, RA e turma — é a lista de trabalho da secretaria', () => {
        const lote = montarLote({
            escola,
            alunos: [alunoCompleto(), alunoCompleto({ _id: 'aluno-2', nome: 'Bruno', sexo: null })],
        });
        expect(lote.resumo.alunosComPendencia).toBe(1);
        expect(lote.pendencias[0]).toMatchObject({
            alunoId: 'aluno-2',
            ra: '2026001',
            turma: '3A',
        });
        expect(lote.pendencias[0].faltando).toContain('Sexo');
        // O aluno pendente CONTINUA no lote: quem confere precisa ver a linha
        // incompleta, não descobrir que ela sumiu do arquivo.
        expect(lote.alunos).toHaveLength(2);
    });
});
