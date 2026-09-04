/**
 * educacenso.js — exportação das matrículas no vocabulário do INEP.
 *
 * POR QUE ISTO NÃO É "MAIS UM RELATÓRIO"
 * --------------------------------------
 * O Censo Escolar (Educacenso/INEP) é declaração anual obrigatória e é dele que
 * sai o repasse do Fundeb. Um aluno com deficiência não declarado, ou uma
 * matrícula ausente, é dinheiro que não chega à escola — e a correção depois do
 * prazo depende de retificação, que nem sempre acontece.
 *
 * O QUE ESTE MÓDULO FAZ, E O QUE ELE DELIBERADAMENTE NÃO FAZ
 * ----------------------------------------------------------
 * FAZ: traduzir o cadastro interno para os CÓDIGOS do INEP e, principalmente,
 * apontar o que falta preencher ANTES do prazo. A parte cara do Censo não é
 * gerar o arquivo, é descobrir em novembro que 40 alunos estão sem data de
 * nascimento.
 *
 * NÃO FAZ: prometer que o arquivo é aceito de olhos fechados pelo sistema do
 * INEP. O leiaute do Educacenso muda a cada ano (o INEP publica o "Caderno de
 * Instruções" e o leiaute de migração anualmente) e é posicional, com dezenas
 * de registros (00, 10, 20, 30, 40, 50, 60...). Fingir aderência a um leiaute
 * que muda seria pior do que não ter nada: a escola confiaria e perderia o
 * prazo. Por isso a saída é um JSON estável e auditável, com os códigos oficiais
 * já aplicados, servindo de base para a migração e para conferência humana —
 * e a `versaoLeiaute` diz explicitamente a qual referência ele corresponde.
 *
 * DE ONDE VÊM OS CÓDIGOS
 * ----------------------
 * São os domínios do Censo Escolar da Educação Básica (cor/raça, nacionalidade,
 * sexo), estáveis há anos justamente porque alimentam série histórica. Ficam
 * aqui em tabela nomeada, e não espalhados em `if`, porque um dia mudam e
 * precisam mudar em UM lugar.
 */

/** Referência do domínio de códigos aplicado — sobe quando o INEP mudar. */
const VERSAO_LEIAUTE = 'censo-basica-dominios-2024';

/** Cor/raça — domínio do Censo Escolar. */
const COR_RACA = {
    0: 'Não declarada',
    1: 'Branca',
    2: 'Preta',
    3: 'Parda',
    4: 'Amarela',
    5: 'Indígena',
};

/** Nacionalidade — domínio do Censo Escolar. */
const NACIONALIDADE = {
    1: 'Brasileira',
    2: 'Brasileira, nascido no exterior ou naturalizado',
    3: 'Estrangeira',
};

/** Sexo — domínio do Censo Escolar. */
const SEXO = { 1: 'Masculino', 2: 'Feminino' };

/** Dependência administrativa — domínio do Censo Escolar. */
const DEPENDENCIA_ADMINISTRATIVA = { 1: 'Federal', 2: 'Estadual', 3: 'Municipal', 4: 'Privada' };

/** Remove acento e caixa para casar texto livre do cadastro com o domínio. */
function chave(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

/**
 * `Aluno.etnia` é texto livre — o cadastro manual, a importação de planilha e o
 * relatório da SEDUC escrevem cada um do seu jeito. Mapear aqui, com sinônimos,
 * evita que a escola perca a declaração por causa de "Parda " com espaço.
 * O que não casar vira 0 (Não declarada) E entra em `pendencias`: silenciar
 * como "não declarada" um dado que existe seria falsear a declaração.
 */
const SINONIMOS_COR_RACA = {
    branca: 1,
    branco: 1,
    preta: 2,
    preto: 2,
    negra: 2,
    negro: 2,
    parda: 3,
    pardo: 3,
    amarela: 4,
    amarelo: 4,
    indigena: 5,
    'nao declarada': 0,
    'nao declarado': 0,
    'nao informada': 0,
    'nao informado': 0,
};

const SINONIMOS_NACIONALIDADE = {
    brasileira: 1,
    brasileiro: 1,
    br: 1,
    brasil: 1,
    'brasileira nascido no exterior': 2,
    naturalizado: 2,
    naturalizada: 2,
    estrangeira: 3,
    estrangeiro: 3,
};

const SINONIMOS_SEXO = {
    m: 1,
    masculino: 1,
    masc: 1,
    homem: 1,
    f: 2,
    feminino: 2,
    fem: 2,
    mulher: 2,
};

const SINONIMOS_DEPENDENCIA = { federal: 1, estadual: 2, municipal: 3, privada: 4, particular: 4 };

/**
 * Converte o valor gravado no cadastro para o código do INEP.
 *
 * Recebe o DOMÍNIO junto com os sinônimos porque o cadastro pode já ter o
 * código numérico (importação futura, correção manual) — e aceitar qualquer
 * número sem conferir contra o domínio deixaria passar um `9` inválido para
 * dentro da declaração.
 */
function codificar(dominio, sinonimos, valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number' || /^\d+$/.test(String(valor).trim())) {
        const codigo = Number(valor);
        return Object.hasOwn(dominio, codigo) ? codigo : null;
    }
    const encontrado = sinonimos[chave(valor)];
    return encontrado === undefined ? null : encontrado;
}

/** aaaa-mm-dd no fuso da escola — formato de data do Educacenso é dd/mm/aaaa,
 *  mas o JSON intermediário guarda ISO para não perder precisão na conversão. */
function dataIso(valor) {
    if (!valor) return null;
    const d = valor instanceof Date ? valor : new Date(valor);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

function somenteDigitos(valor) {
    return String(valor ?? '').replace(/\D/g, '') || null;
}

/**
 * Campos sem os quais a matrícula não é declarável. Não incluímos CPF: o INEP
 * aceita a matrícula sem CPF do aluno (usa a certidão/identificação única), e
 * exigi-lo aqui geraria pendência falsa para a rede inteira.
 */
const OBRIGATORIOS = [
    ['nome', 'Nome completo'],
    ['dataNascimento', 'Data de nascimento'],
    ['sexo', 'Sexo'],
    ['corRaca', 'Cor/raça'],
    ['nacionalidade', 'Nacionalidade'],
];

/**
 * Traduz um aluno para o registro do Censo e lista o que falta nele.
 *
 * @param {object} aluno documento de Aluno (`.lean()`).
 * @returns {{registro: object, pendencias: string[]}}
 */
function mapearAluno(aluno = {}) {
    const corRaca = codificar(COR_RACA, SINONIMOS_COR_RACA, aluno.etnia);
    const nacionalidade = codificar(NACIONALIDADE, SINONIMOS_NACIONALIDADE, aluno.nacionalidade);
    const sexo = codificar(SEXO, SINONIMOS_SEXO, aluno.sexo);

    const registro = {
        codigoInep: aluno.codigoInep || null,
        // O RA é a chave que a rede usa para reconciliar com a base estadual;
        // o INEP identifica pelo código dele, mas sem o RA a conferência humana
        // do arquivo fica impossível.
        ra: aluno.matricula || null,
        nome: [aluno.nome, aluno.sobrenome].filter(Boolean).join(' ').trim() || null,
        cpf: somenteDigitos(aluno.cpfAluno),
        dataNascimento: dataIso(aluno.nascimento),
        sexo,
        sexoDescricao: sexo === null ? null : SEXO[sexo],
        corRaca,
        corRacaDescricao: corRaca === null ? null : COR_RACA[corRaca],
        nacionalidade,
        nacionalidadeDescricao: nacionalidade === null ? null : NACIONALIDADE[nacionalidade],
        turma: aluno.turma || null,
        // O par deficiência/detalhamento é o que sustenta o repasse adicional do
        // Fundeb para a educação especial. `pcd` verdadeiro sem descrição é
        // pendência: o INEP exige o TIPO da deficiência, não só o "sim".
        possuiDeficiencia: Boolean(aluno.pcd),
        tipoDeficiencia: aluno.pcd ? aluno.deficiencia || null : null,
        transtornos: Array.isArray(aluno.transtornos) ? aluno.transtornos : [],
        situacao: aluno.situacao || 'ativo',
    };

    const pendencias = OBRIGATORIOS.filter(([campo]) => {
        const v = registro[campo];
        return v === null || v === undefined || v === '';
    }).map(([, rotulo]) => rotulo);

    if (registro.possuiDeficiencia && !registro.tipoDeficiencia) {
        pendencias.push('Tipo de deficiência (obrigatório quando há deficiência declarada)');
    }
    // `etnia` preenchida que não casou com o domínio: o dado existe e foi
    // perdido na tradução — pior do que estar em branco, porque ninguém percebe.
    if (corRaca === null && aluno.etnia) {
        pendencias.push(`Cor/raça não reconhecida no domínio do INEP: "${aluno.etnia}"`);
    }
    if (nacionalidade === null && aluno.nacionalidade) {
        pendencias.push(
            `Nacionalidade não reconhecida no domínio do INEP: "${aluno.nacionalidade}"`
        );
    }

    return { registro, pendencias };
}

/**
 * Monta o lote de exportação de uma escola.
 *
 * @param {object} entrada
 * @param {object} entrada.escola  documento de Escola.
 * @param {object[]} entrada.alunos alunos ativos da escola.
 * @param {number} [entrada.anoCenso] ano de referência (padrão: o corrente).
 * @param {string} [entrada.geradoPor] identificação de quem exportou (auditoria).
 * @returns {{cabecalho: object, alunos: object[], pendencias: object[], resumo: object}}
 */
function montarLote({ escola = {}, alunos = [], anoCenso, geradoPor } = {}) {
    const ano = Number(anoCenso) || new Date().getFullYear();
    const dependencia = codificar(
        DEPENDENCIA_ADMINISTRATIVA,
        SINONIMOS_DEPENDENCIA,
        escola.dependenciaAdministrativa
    );

    const mapeados = alunos.map((aluno) => ({ aluno, ...mapearAluno(aluno) }));

    const pendencias = mapeados
        .filter((m) => m.pendencias.length > 0)
        .map((m) => ({
            alunoId: String(m.aluno._id),
            nome: m.registro.nome || 'Sem nome',
            ra: m.registro.ra,
            turma: m.registro.turma,
            faltando: m.pendencias,
        }));

    const cabecalho = {
        codigoInepEscola: escola.codigoInep || null,
        nomeInstituicao: escola.nome || null,
        municipio: escola.municipio || null,
        dependenciaAdministrativa: dependencia,
        dependenciaAdministrativaDescricao:
            dependencia === null ? null : DEPENDENCIA_ADMINISTRATIVA[dependencia],
        anoCenso: ano,
        versaoLeiaute: VERSAO_LEIAUTE,
        geradoEm: new Date().toISOString(),
        geradoPor: geradoPor || null,
    };

    const pendenciasEscola = [];
    if (!cabecalho.codigoInepEscola) pendenciasEscola.push('Código INEP da escola');
    if (dependencia === null) pendenciasEscola.push('Dependência administrativa');

    return {
        cabecalho,
        pendenciasEscola,
        alunos: mapeados.map((m) => m.registro),
        pendencias,
        resumo: {
            totalAlunos: mapeados.length,
            alunosComPendencia: pendencias.length,
            alunosProntos: mapeados.length - pendencias.length,
            // "Pronto para declarar" é o único status que interessa antes do
            // prazo. Escola com pendência no cabeçalho não declara nem os alunos
            // completos — o arquivo inteiro depende do código INEP da unidade.
            pronto: pendencias.length === 0 && pendenciasEscola.length === 0,
        },
    };
}

module.exports = {
    VERSAO_LEIAUTE,
    COR_RACA,
    NACIONALIDADE,
    SEXO,
    DEPENDENCIA_ADMINISTRATIVA,
    mapearAluno,
    montarLote,
};
