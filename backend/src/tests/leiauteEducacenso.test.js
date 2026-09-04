/**
 * leiauteEducacenso.test.js — o arquivo que o INEP realmente importa.
 *
 * POR QUE ESTE ARQUIVO MERECE TESTE PRÓPRIO
 * -----------------------------------------
 * O JSON do lote é para a secretaria conferir; o arquivo delimitado é o que
 * entra no sistema do Censo. Dois defeitos aqui custam repasse do Fundeb e só
 * aparecem no dia do envio:
 *
 *   1. um `|` dentro de um campo de texto livre desloca TODAS as colunas
 *      seguintes daquela linha — o INEP passa a ler "turma" no lugar de "nome";
 *   2. um arquivo gerado com cadastro incompleto: aceito pelo nosso código,
 *      recusado (ou pior, aceito errado) pelo deles.
 *
 * A recusa de gerar com pendência é o único momento em que ainda dá tempo de
 * corrigir o cadastro — por isso ela é comportamento, não aviso.
 */
const {
    gerarArquivo,
    dataBr,
    sanitizar,
    SEPARADOR,
} = require('../services/conformidade/leiauteEducacenso');
const { montarLote } = require('../services/conformidade/educacenso');

const escola = {
    nome: 'EMEF Jaguari',
    municipio: 'Americana',
    codigoInep: '35123456',
    dependenciaAdministrativa: 'MUNICIPAL',
};

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

const lotePronto = (alunos = [alunoCompleto()]) => montarLote({ escola, alunos, anoCenso: 2026 });

describe('estrutura do arquivo', () => {
    const { conteudo, linhas } = gerarArquivo(lotePronto());
    const registros = conteudo.trim().split('\n');

    it('abre com o registro 00 da escola', () => {
        expect(registros[0].startsWith(`00${SEPARADOR}35123456${SEPARADOR}2026`)).toBe(true);
    });

    it('escreve um registro 30 (pessoa) e um 60 (vínculo) por aluno', () => {
        expect(registros[1].startsWith('30|')).toBe(true);
        expect(registros[2].startsWith('60|')).toBe(true);
        expect(linhas).toBe(3);
    });

    it('termina com quebra de linha — leitor que conta linhas descarta a última sem ela', () => {
        expect(conteudo.endsWith('\n')).toBe(true);
    });

    it('escreve a data no formato do leiaute (dd/mm/aaaa)', () => {
        expect(registros[1]).toContain('10/04/2015');
    });

    it('campo ausente vira vazio, e não "undefined" escrito no arquivo', () => {
        // Aluno sem código INEP é o caso normal de quem nunca estudou em outra
        // rede; o campo é opcional e precisa sair em branco.
        expect(registros[1]).toContain('30||2026001|Ana Souza|');
    });
});

describe('sanitização', () => {
    it('remove o separador de dentro do valor', () => {
        // Sem isto, "Baixa visão | uso de lupa" vira duas colunas e desalinha a
        // linha inteira.
        expect(sanitizar('Baixa visão | uso de lupa')).toBe('Baixa visão uso de lupa');
    });

    it('remove quebras de linha, que partiriam um registro em dois', () => {
        expect(sanitizar('linha1\nlinha2')).toBe('linha1 linha2');
    });

    it('o texto livre do cadastro passa pela sanitização', () => {
        const { conteudo } = gerarArquivo(
            lotePronto([alunoCompleto({ pcd: true, deficiencia: 'Baixa visão | lupa' })])
        );
        const linha30 = conteudo.split('\n')[1];
        expect(linha30.split(SEPARADOR)).toHaveLength(11);
        expect(linha30).toContain('Baixa visão lupa');
    });
});

describe('recusa de lote incompleto', () => {
    it('não gera arquivo quando falta dado de aluno', () => {
        const lote = lotePronto([alunoCompleto(), { _id: 'x', nome: 'Miguel' }]);
        expect(() => gerarArquivo(lote)).toThrow(/pendências/i);
    });

    it('o erro diz o que falta, para a secretaria saber o que corrigir', () => {
        const lote = lotePronto([{ _id: 'x', nome: 'Miguel' }]);
        try {
            gerarArquivo(lote);
            throw new Error('deveria ter recusado');
        } catch (erro) {
            expect(erro.codigo).toBe('EDUCACENSO_LOTE_INCOMPLETO');
            expect(erro.pendencias[0].faltando).toContain('Sexo');
        }
    });

    it('não gera quando falta o código INEP da escola, mesmo com alunos completos', () => {
        const lote = montarLote({
            escola: { ...escola, codigoInep: null },
            alunos: [alunoCompleto()],
        });
        expect(() => gerarArquivo(lote)).toThrow(/pendências/i);
    });

    it('permitirPendencias libera a geração para conferência interna', () => {
        const lote = lotePronto([{ _id: 'x', nome: 'Miguel' }]);
        expect(gerarArquivo(lote, { permitirPendencias: true }).linhas).toBe(3);
    });
});

describe('dataBr', () => {
    it('converte ISO para o formato do leiaute', () => {
        expect(dataBr('2015-04-10')).toBe('10/04/2015');
    });

    it('valor vazio vira string vazia, nunca "Invalid Date"', () => {
        expect(dataBr(null)).toBe('');
        expect(dataBr('')).toBe('');
    });
});
