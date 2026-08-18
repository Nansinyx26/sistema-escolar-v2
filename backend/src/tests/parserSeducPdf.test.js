/**
 * parserSeducPdf.test.js
 * Camada PURA da importação de alunos: parser do relatório da SEDUC-SP,
 * leitura de planilha (XLSX/CSV) e classificação das linhas.
 *
 * Não toca o banco nem o Express de propósito — é o que permite exercitar as
 * armadilhas de parsing uma a uma, que é onde este módulo realmente quebra.
 *
 * ⚠️ Fixtures 100% SINTÉTICAS (§7.8). Nenhum RA, nome ou data real.
 */
const {
    parsearTextoSeduc,
    parsearCauda,
    extrairTextoPdf,
} = require('../services/importacaoAlunos/parserPdfSeduc');
const {
    parsearCsv,
    parsearXlsx,
    decodificarTexto,
    detectarSeparador,
} = require('../services/importacaoAlunos/parserPlanilha');
const { serialParaData } = require('../services/importacaoAlunos/leitorXlsx');
const classificador = require('../services/importacaoAlunos/classificador');
const normalizacao = require('../services/importacaoAlunos/normalizacao');
const importacao = require('../services/importacaoAlunos');

const {
    montarRelatorio,
    raSintetico,
    NOMES,
    CABECALHO_COLUNAS_COM_ERRO,
} = require('./fixtures/relatorioSeduc');
const { construirXlsx } = require('./fixtures/construirXlsx');
const { construirPdf } = require('./fixtures/construirPdf');

describe('parser do relatório SEDUC — texto', () => {
    it('lê uma turma completa de 30 alunos com o total do cabeçalho batendo', () => {
        const resultado = parsearTextoSeduc(montarRelatorio({ quantidade: 30 }));

        expect(resultado.registros).toHaveLength(30);
        expect(resultado.totalDeclarado).toBe(30);

        const conferencia = classificador.conferirTotais(
            resultado.totalDeclarado,
            resultado.registros.length
        );
        expect(conferencia.confere).toBe(true);
        expect(conferencia.mensagem).toContain('30 de 30');
    });

    it('extrai o cabeçalho institucional do documento', () => {
        const { cabecalho } = parsearTextoSeduc(montarRelatorio({ quantidade: 3 }));

        expect(cabecalho.codigoEscola).toBe('900001');
        expect(cabecalho.nomeEscola).toBe('ESCOLA ESTADUAL SINTETICA DE TESTE');
        expect(cabecalho.codigoClasse).toBe('7000001');
        expect(cabecalho.tipoEnsino).toBe('ENSINO FUNDAMENTAL DE 9 ANOS');
        expect(cabecalho.sala).toBe('012');
        expect(cabecalho.turma).toBe('5 ANO A - MANHA');
        expect(cabecalho.totais.cadastrados).toBe(3);
    });

    it('remonta o nome partido na quebra de página (fragmento isolado no fim)', () => {
        const resultado = parsearTextoSeduc(montarRelatorio({ quantidade: 20, nomePartido: true }));

        expect(resultado.registros).toHaveLength(20);

        const ultimo = resultado.registros[19];
        // NOMES[19] é "THIAGO VINÍCIUS DE ARAÚJO RIBEIRO": o fixture corta as
        // duas últimas palavras e as joga para o fim do documento.
        expect(ultimo.nome).toBe(NOMES[19]);
        expect(ultimo.nome).toContain('ARAÚJO RIBEIRO');
        expect(ultimo.transtornos).toBe('');
        expect(resultado.avisos.join(' ')).toMatch(/quebra de página/i);
    });

    it('aceita dígito verificador X sem perder o aluno', () => {
        const resultado = parsearTextoSeduc(montarRelatorio({ quantidade: 30 }));

        const comX = resultado.registros.filter((registro) => registro.raDigito === 'X');
        expect(comX.length).toBeGreaterThan(0);
        // Um `\d` no lugar de `[0-9Xx]` faria estes alunos sumirem em silêncio.
        expect(resultado.registros).toHaveLength(30);
        comX.forEach((registro) => {
            expect(registro.ra).toMatch(/^\d{12}$/);
        });
    });

    it('remove o cabeçalho de colunas repetido, nas duas grafias (com e sem o erro "Defciência")', () => {
        // alunosPorPagina=5 força o cabeçalho a se repetir várias vezes,
        // alternando entre "Defciência" e "Deficiência".
        const resultado = parsearTextoSeduc(
            montarRelatorio({ quantidade: 12, alunosPorPagina: 5 })
        );

        expect(resultado.registros).toHaveLength(12);
        resultado.registros.forEach((registro) => {
            expect(registro.nome).not.toMatch(/Transtorno|Defci|Defici|Nome do Aluno/i);
        });
    });

    it('separa Situação "Não Comp." de Deficiência "Não" na ordem correta', () => {
        const resultado = parsearTextoSeduc(montarRelatorio({ quantidade: 5 }));

        // O fixture põe "Não Comp. 15/03/2025 Não" na cauda do aluno 2.
        const aluno = resultado.registros[1];
        expect(aluno.situacao).toBe('Não Comp.');
        expect(aluno.dataMovimentacao).toBe('15/03/2025');
        expect(aluno.deficiencia).toBe('Não');
        expect(aluno.transtornos).toBe('');

        expect(normalizacao.normalizarSituacao(aluno.situacao)).toBe('nao_compareceu');
        expect(normalizacao.normalizarSimNao(aluno.deficiencia)).toBe(false);
    });

    it('lê deficiência "Sim" com texto de transtorno preenchido', () => {
        const texto = montarRelatorio({
            quantidade: 2,
            cadastradosDeclarado: 3,
            extras: [
                `5 3 CARLOS FICTICIO ANDRADE ${raSintetico(3)} X SP 09/09/2014 Sim Dislexia, TDAH`,
            ],
        });
        const resultado = parsearTextoSeduc(texto);

        const aluno = resultado.registros[2];
        expect(aluno.nome).toBe('CARLOS FICTICIO ANDRADE');
        expect(aluno.deficiencia).toBe('Sim');
        expect(aluno.transtornos).toBe('Dislexia, TDAH');
        expect(normalizacao.normalizarTranstornos(aluno.transtornos)).toEqual(['Dislexia', 'TDAH']);
    });

    it('gera alerta — e não exceção — quando o total do cabeçalho diverge', () => {
        const resultado = parsearTextoSeduc(
            montarRelatorio({ quantidade: 8, cadastradosDeclarado: 12 })
        );

        expect(resultado.registros).toHaveLength(8);
        expect(resultado.totalDeclarado).toBe(12);

        const conferencia = classificador.conferirTotais(
            resultado.totalDeclarado,
            resultado.registros.length
        );
        expect(conferencia.confere).toBe(false);
        expect(conferencia.mensagem).toContain('declara 12');
        expect(conferencia.mensagem).toContain('identificados 8');
    });

    it('trata documento sem nenhum registro com erro legível, sem quebrar', () => {
        const semAlunos = [
            'Relação de Alunos por Classe',
            'Escola: 900001 - ESCOLA X NR. Classe: 7000001',
            CABECALHO_COLUNAS_COM_ERRO,
        ].join('\n');

        const resultado = parsearTextoSeduc(semAlunos);
        expect(resultado.registros).toHaveLength(0);
        expect(resultado.avisos[0]).toMatch(/Nenhum aluno foi identificado/i);

        const vazio = parsearTextoSeduc('');
        expect(vazio.registros).toHaveLength(0);
        expect(vazio.avisos[0]).toMatch(/não contém texto legível/i);

        expect(() => parsearTextoSeduc(null)).not.toThrow();
        expect(() => parsearTextoSeduc(undefined)).not.toThrow();
    });

    it('parseia a cauda respeitando a ordem situação → data → deficiência → transtorno', () => {
        expect(parsearCauda('Não')).toMatchObject({
            situacao: '',
            deficiencia: 'Não',
            transtornos: '',
        });
        expect(parsearCauda('Não Comp. 01/02/2025 Não')).toMatchObject({
            situacao: 'Não Comp.',
            dataMovimentacao: '01/02/2025',
            deficiencia: 'Não',
            transtornos: '',
        });
        expect(parsearCauda('Transferido 10/10/2024 Sim TEA')).toMatchObject({
            situacao: 'Transferido',
            dataMovimentacao: '10/10/2024',
            deficiencia: 'Sim',
            transtornos: 'TEA',
        });
        expect(parsearCauda('')).toMatchObject({ situacao: '', deficiencia: '', transtornos: '' });
    });
});

/**
 * Os testes que abrem um PDF BINÁRIO exigem `--experimental-vm-modules`.
 *
 * Não é limitação do sistema: em produção (`node src/index.js`) a leitura
 * funciona normalmente. É o VM do Jest que bloqueia o `import()` dinâmico com
 * que o pdfjs-dist — usado por dentro do pdf-parse — carrega o worker.
 *
 * A Issue #55 TENTOU torná-lo padrão de `npm test`, e o CI reprovou: com o flag
 * ligado a suíte inteira estoura o heap do runner ("Reached heap limit
 * Allocation failed"), abortando na suíte 44 de 68. Passa em máquina de
 * desenvolvimento só porque lá o heap padrão do Node é proporcional a uma RAM
 * bem maior. O flag ficou, portanto, restrito a `npm run test:pdf`.
 *
 * Consequência aceita: estes 3 casos NÃO rodam no CI. A lógica de parsing — as
 * armadilhas do §5.2, que é onde este módulo de fato quebra — é exercitada no
 * nível de texto pelos blocos acima, sem depender do flag. O que fica sem
 * cobertura automatizada é a integração com o pdf-parse, que muda pouco.
 */
const VM_MODULES_ATIVO = `${process.execArgv.join(' ')} ${process.env.NODE_OPTIONS || ''}`.includes(
    'experimental-vm-modules'
);
const descreveComPdfBinario = VM_MODULES_ATIVO ? describe : describe.skip;

descreveComPdfBinario('parser do relatório SEDUC — PDF de verdade', () => {
    it('extrai o texto de um PDF gerado e identifica todos os alunos', async () => {
        const pdf = await construirPdf(montarRelatorio({ quantidade: 30 }));
        expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

        const texto = await extrairTextoPdf(pdf);
        expect(texto.length).toBeGreaterThan(100);

        const resultado = parsearTextoSeduc(texto);
        expect(resultado.registros).toHaveLength(30);
        expect(classificador.conferirTotais(resultado.totalDeclarado, 30).confere).toBe(true);
    }, 30000);

    it('reconhece o PDF pelos magic bytes e roteia para o parser certo', async () => {
        const pdf = await construirPdf(montarRelatorio({ quantidade: 3 }));

        expect(importacao.detectarTipo(pdf).tipo).toBe('pdf');

        const lido = await importacao.lerArquivo({ buffer: pdf });
        expect(lido.tipo).toBe('pdf');
        expect(lido.origemCadastro).toBe('importacao_pdf');
        expect(lido.registros).toHaveLength(3);
    }, 30000);
});

describe('detecção de tipo de arquivo', () => {
    it('recusa binário disfarçado e formatos não suportados', async () => {
        const executavel = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
        expect(importacao.detectarTipo(executavel).tipo).toBeNull();

        expect(importacao.detectarTipo(Buffer.alloc(0)).tipo).toBeNull();

        // OLE2 (.xls antigo) recebe orientação específica em vez de erro cru.
        const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
        expect(importacao.detectarTipo(ole2).motivo).toMatch(/\.xls antigo/i);

        await expect(importacao.lerArquivo({ buffer: executavel })).rejects.toMatchObject({
            leitura: true,
        });
    });

    it('recusa arquivo acima de 5 MB', async () => {
        const grande = Buffer.alloc(importacao.TAMANHO_MAXIMO + 1, 0x41);
        await expect(importacao.lerArquivo({ buffer: grande })).rejects.toThrow(/5 MB/);
    });
});

describe('leitura de CSV', () => {
    it('lê CSV em ISO-8859-1 preservando os acentos', () => {
        const csv = Buffer.from(
            'nome;ra;dig ra;uf ra;data de nascimento;nr\n' +
                'JOSÉ ANTÔNIO FICTÍCIO MOISÉS;900000000099;X;SP;01/02/2015;7\n',
            'latin1'
        );

        // Lido como UTF-8, cada acento viraria U+FFFD — sem erro nenhum.
        expect(decodificarTexto(csv)).toContain('JOSÉ ANTÔNIO FICTÍCIO MOISÉS');

        const resultado = parsearCsv(csv);
        expect(resultado.registros).toHaveLength(1);
        expect(resultado.registros[0].nome).toBe('JOSÉ ANTÔNIO FICTÍCIO MOISÉS');
        expect(resultado.registros[0].raDigito).toBe('X');
        expect(resultado.registros[0].numeroChamada).toBe('7');
    });

    it('detecta o separador e respeita campo entre aspas', () => {
        expect(detectarSeparador('a,b,c')).toBe(',');
        expect(detectarSeparador('a;b;c')).toBe(';');

        const csv = Buffer.from(
            'Nome do Aluno,RA,Dig,UF,Nascimento\n"FICTICIA, ANA",900000000010,3,SP,02/03/2015\n',
            'utf8'
        );
        const resultado = parsearCsv(csv);
        expect(resultado.registros[0].nome).toBe('FICTICIA, ANA');
        expect(resultado.registros[0].ra).toBe('900000000010');
    });

    it('pede mapeamento manual quando falta coluna obrigatória', () => {
        const csv = Buffer.from('coluna a;coluna b\nvalor 1;valor 2\n', 'utf8');
        const resultado = parsearCsv(csv);

        expect(resultado.registros).toHaveLength(0);
        expect(resultado.faltando.length).toBeGreaterThan(0);
        expect(resultado.avisos.join(' ')).toMatch(/mapeamento manual/i);
    });

    it('aceita mapeamento manual de colunas', () => {
        const csv = Buffer.from('c1;c2;c3\nANA FICTICIA SOUZA;900000000011;01/02/2015\n', 'utf8');
        const resultado = parsearCsv(csv, { nome: 0, ra: 1, dataNascimento: 2 });

        expect(resultado.registros).toHaveLength(1);
        expect(resultado.registros[0].nome).toBe('ANA FICTICIA SOUZA');
        expect(resultado.registros[0].ra).toBe('900000000011');
    });
});

describe('leitura de XLSX', () => {
    it('converte data em número serial do Excel, Date e texto', () => {
        const xlsx = construirXlsx([
            ['Nr', 'Série', 'Nome do Aluno', 'RA', 'Dig. RA', 'UF RA', 'Data de Nascimento'],
            [1, '5', 'ANA FICTICIA DE SOUZA', '900000000001', '0', 'SP', { serial: 42005 }],
            [
                2,
                '5',
                'BRUNO INVENTADO LIMA',
                '900000000002',
                'X',
                'SP',
                new Date(Date.UTC(2015, 3, 3)),
            ],
            [3, '5', 'CAMILA IMAGINARIA', '900000000003', '7', 'SP', '05/06/2015'],
        ]);

        expect(importacao.detectarTipo(xlsx).tipo).toBe('xlsx');

        const resultado = parsearXlsx(xlsx);
        expect(resultado.registros).toHaveLength(3);
        // 42005 é o serial de 01/01/2015 no calendário do Excel.
        expect(resultado.registros[0].dataNascimento).toBe('01/01/2015');
        expect(resultado.registros[1].dataNascimento).toBe('03/04/2015');
        expect(resultado.registros[2].dataNascimento).toBe('05/06/2015');
        expect(resultado.registros[1].raDigito).toBe('X');
    });

    it('converte serial do Excel respeitando o bug do ano bissexto de 1900', () => {
        expect(serialParaData(1).toISOString().slice(0, 10)).toBe('1900-01-01');
        expect(serialParaData(61).toISOString().slice(0, 10)).toBe('1900-03-01');
        expect(serialParaData(0)).toBeNull();
        expect(serialParaData(-5)).toBeNull();
    });

    it('recusa um ZIP que não é planilha', () => {
        const { montarZip } = require('./fixtures/construirXlsx');
        const docx = montarZip([{ nome: 'word/document.xml', conteudo: '<w:document/>' }]);

        const deteccao = importacao.detectarTipo(docx);
        expect(deteccao.tipo).toBeNull();
        expect(deteccao.motivo).toMatch(/não é uma planilha/i);
    });
});

describe('normalização de dados do aluno', () => {
    it('valida o FORMATO do RA e nunca o dígito verificador', () => {
        expect(normalizacao.validarRa('90.000.000-001/2')).toMatchObject({
            ok: true,
            valor: '900000000012',
        });
        expect(normalizacao.validarRa('123').ok).toBe(false);
        // Dígito X é válido — não existe cálculo de DV neste sistema.
        expect(normalizacao.validarDigitoRa('x')).toMatchObject({ ok: true, valor: 'X' });
        expect(normalizacao.validarDigitoRa('9')).toMatchObject({ ok: true, valor: '9' });
        expect(normalizacao.validarDigitoRa('AB').ok).toBe(false);
    });

    it('guarda data de nascimento como valor de calendário estável', () => {
        const data = normalizacao.parseDataBr('10/03/2015');
        expect(normalizacao.chaveData(data)).toBe('2015-03-10');
        expect(normalizacao.formatarDataBr(data)).toBe('10/03/2015');

        // Registro legado gravado à meia-noite UTC precisa comparar igual.
        expect(normalizacao.chaveData(new Date(Date.UTC(2015, 2, 10)))).toBe('2015-03-10');

        expect(normalizacao.parseDataBr('31/02/2015')).toBeNull();
        expect(normalizacao.parseDataBr('sem data')).toBeNull();
    });

    it('avisa sobre idade fora da faixa sem bloquear a importação', () => {
        const referencia = new Date(Date.UTC(2026, 0, 1));

        const normal = normalizacao.validarNascimento('01/01/2015', referencia);
        expect(normal.ok).toBe(true);
        expect(normal.avisos).toHaveLength(0);

        // EJA: adulto matriculado é caso real, não erro.
        const eja = normalizacao.validarNascimento('01/01/1980', referencia);
        expect(eja.ok).toBe(true);
        expect(eja.avisos.join(' ')).toMatch(/fora da faixa usual/i);

        expect(normalizacao.validarNascimento('01/01/2030', referencia).ok).toBe(false);
    });

    it('exibe nome em Title Case respeitando preposições', () => {
        expect(normalizacao.tituloCase('MARIA DAS DORES ENSAIO')).toBe('Maria das Dores Ensaio');
        expect(normalizacao.tituloCase('THIAGO VINÍCIUS DE ARAÚJO RIBEIRO')).toBe(
            'Thiago Vinícius de Araújo Ribeiro'
        );
        expect(normalizacao.normalizarNome('  MOISÉS   ARAÚJO ')).toBe('moises araujo');
    });

    it('exige nome e sobrenome', () => {
        expect(normalizacao.validarNome('ANA CLARA SOUZA').ok).toBe(true);
        expect(normalizacao.validarNome('Ana').ok).toBe(false);
        expect(normalizacao.validarNome('12345678').ok).toBe(false);
        expect(normalizacao.validarNome('').ok).toBe(false);
    });
});

describe('classificação das linhas', () => {
    const registro = (n, extras = {}) => ({
        serie: '5',
        numeroChamada: String(n),
        nome: NOMES[n - 1],
        ra: raSintetico(n),
        raDigito: '1',
        raUf: 'SP',
        dataNascimento: '10/03/2014',
        situacao: '',
        dataMovimentacao: '',
        deficiencia: 'Não',
        transtornos: '',
        ...extras,
    });

    it('marca como novo o RA que ainda não existe na escola', () => {
        const { linhas, resumo } = classificador.classificarLinhas({
            registros: [registro(1), registro(2)],
            alunosPorRa: new Map(),
            alunosJaNaTurma: new Set(),
        });

        expect(linhas.every((linha) => linha.status === 'novo')).toBe(true);
        expect(resumo).toMatchObject({ total: 2, novos: 2, importaveis: 2, comErro: 0 });
    });

    it('marca como existente o aluno já cadastrado que não está nesta turma', () => {
        const alunosPorRa = new Map([
            [
                raSintetico(1),
                {
                    _id: 'aluno-1',
                    nome: NOMES[0],
                    nascimento: new Date(Date.UTC(2014, 2, 10)),
                },
            ],
        ]);

        const { linhas } = classificador.classificarLinhas({
            registros: [registro(1)],
            alunosPorRa,
            alunosJaNaTurma: new Set(),
        });

        expect(linhas[0].status).toBe('existente');
        expect(linhas[0].alunoExistenteId).toBe('aluno-1');
    });

    it('marca como já na turma e desmarca por padrão', () => {
        const alunosPorRa = new Map([
            [
                raSintetico(1),
                {
                    _id: 'aluno-1',
                    nome: NOMES[0],
                    nascimento: new Date(Date.UTC(2014, 2, 10)),
                },
            ],
        ]);

        const { linhas, resumo } = classificador.classificarLinhas({
            registros: [registro(1)],
            alunosPorRa,
            alunosJaNaTurma: new Set(['aluno-1']),
        });

        expect(linhas[0].status).toBe('ja_na_turma');
        expect(classificador.STATUS_IMPORTAVEIS.has('ja_na_turma')).toBe(false);
        expect(resumo.importaveis).toBe(0);
    });

    it('marca divergência quando nome ou nascimento diferem do cadastro', () => {
        const alunosPorRa = new Map([
            [
                raSintetico(1),
                {
                    _id: 'aluno-1',
                    nome: 'NOME DIFERENTE NO CADASTRO',
                    nascimento: new Date(Date.UTC(2013, 0, 1)),
                },
            ],
        ]);

        const { linhas } = classificador.classificarLinhas({
            registros: [registro(1)],
            alunosPorRa,
            alunosJaNaTurma: new Set(),
        });

        expect(linhas[0].status).toBe('divergente');
        expect(linhas[0].divergencias.map((d) => d.campo).sort()).toEqual([
            'dataNascimento',
            'nome',
        ]);
    });

    it('marca só a primeira ocorrência de um RA repetido no arquivo', () => {
        const { linhas, resumo } = classificador.classificarLinhas({
            registros: [registro(1), registro(1), registro(2)],
            alunosPorRa: new Map(),
            alunosJaNaTurma: new Set(),
        });

        expect(linhas.map((linha) => linha.status)).toEqual([
            'novo',
            'duplicado_no_arquivo',
            'novo',
        ]);
        expect(resumo.duplicados).toBe(1);
        expect(resumo.importaveis).toBe(2);
    });

    it('marca como erro a linha com campo obrigatório inválido', () => {
        const { linhas, resumo } = classificador.classificarLinhas({
            registros: [
                registro(1, { nome: '' }),
                registro(2, { ra: '123' }),
                registro(3, { dataNascimento: '31/02/2015' }),
            ],
            alunosPorRa: new Map(),
            alunosJaNaTurma: new Set(),
        });

        expect(linhas.every((linha) => linha.status === 'erro')).toBe(true);
        expect(resumo.comErro).toBe(3);
        expect(resumo.importaveis).toBe(0);
        linhas.forEach((linha) => {
            expect(linha.mensagens.some((m) => m.tipo === 'erro')).toBe(true);
        });
    });

    it('avisa que confirmar vai TRANSFERIR o aluno de outra turma', () => {
        const alunosPorRa = new Map([
            [
                raSintetico(1),
                {
                    _id: 'aluno-1',
                    nome: NOMES[0],
                    nascimento: new Date(Date.UTC(2014, 2, 10)),
                },
            ],
        ]);

        const { linhas } = classificador.classificarLinhas({
            registros: [registro(1)],
            alunosPorRa,
            alunosJaNaTurma: new Set(),
            turmaAtualPorAluno: new Map([['aluno-1', { turmaId: 't2', turmaNome: '5B' }]]),
        });

        expect(linhas[0].transferenciaDe).toMatchObject({ turmaId: 't2', turmaNome: '5B' });
        expect(linhas[0].mensagens.some((m) => /TRANSFERIR/.test(m.texto))).toBe(true);
    });

    it('avisa quando a turma do arquivo não bate com a turma de destino', () => {
        const cabecalho = { turma: '5 ANO A - MANHA' };

        expect(classificador.conferirTurma(cabecalho, { nome: '5A' }).confere).toBe(true);
        const divergente = classificador.conferirTurma(cabecalho, { nome: '9B' });
        expect(divergente.confere).toBe(false);
        expect(divergente.mensagem).toMatch(/parece ser da turma/i);
    });
});

descreveComPdfBinario('pipeline completo — arquivo até linhas classificadas', () => {
    it('lê um PDF de 30 alunos e classifica todos como novos', async () => {
        const pdf = await construirPdf(montarRelatorio({ quantidade: 30 }));
        const lido = await importacao.lerArquivo({ buffer: pdf });

        const { linhas, resumo } = classificador.classificarLinhas({
            registros: lido.registros,
            alunosPorRa: new Map(),
            alunosJaNaTurma: new Set(),
        });

        expect(resumo.total).toBe(30);
        expect(resumo.novos).toBe(30);
        expect(resumo.comErro).toBe(0);
        linhas.forEach((linha) => {
            expect(linha.dadosNormalizados.ra).toMatch(/^\d{12}$/);
            expect(linha.dadosNormalizados.dataNascimento).toBeInstanceOf(Date);
            expect(linha.dadosNormalizados.nomeNormalizado).toBe(
                linha.dadosNormalizados.nomeNormalizado.toLowerCase()
            );
        });
    }, 30000);
});
