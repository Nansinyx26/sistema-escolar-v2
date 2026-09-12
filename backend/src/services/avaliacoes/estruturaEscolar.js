/**
 * estruturaEscolar.js — turmas, disciplinas e docentes que a página de
 * Avaliações oferece nos campos "Turma", "Disciplina" e "Professor responsável".
 *
 * DE ONDE VEM CADA LISTA
 * ----------------------
 * Nenhuma lista de turma é fixa aqui. A turma existe se o BANCO diz que existe,
 * em qualquer um dos três lugares onde o projeto a registra:
 *   • coleção `turmas` (cadastro formal da sala);
 *   • `alunos.turma` / `alunos.turmaId` (sala onde há aluno matriculado);
 *   • `professores.salaPrincipal` / `salasAdicionais` / `turmas` (sala com docente).
 * Olhar só a coleção `turmas` escondia salas reais: o script
 * `add_classes_c_d.js` gravou as turmas C e D sem `escolaId`, e o seed gravou
 * `nome: "1º Ano A"` — a mesma sala aparecia com três grafias, ou não aparecia.
 * Mesma regra de `services/vinculoTurmas.js`: nada de faixa de série no código
 * (CIEP vai do 1º ao 5º, EMEF até o 9º); a série sai do texto da turma.
 *
 * As disciplinas juntam três fontes reais: a `config` da escola
 * (`config.materias`), o que os professores da escola declaram lecionar
 * (`materias` / `disciplina`) e os componentes curriculares obrigatórios dos
 * anos iniciais — LDB art. 26 (Língua Portuguesa, Matemática, Ciências,
 * História, Geografia, Arte, Educação Física) e art. 33 (Ensino Religioso, de
 * oferta obrigatória). Estes últimos não são dado de exemplo: é a grade que a
 * lei exige de toda escola de Ensino Fundamental. Inglês não é obrigatório nos
 * anos iniciais, então só aparece quando está cadastrado em uma das duas
 * primeiras fontes.
 *
 * GRAFIA CANÔNICA
 * ---------------
 * Turma: id `1A`, nome de exibição `1ºA`. "1A", "1ºA", "1º A", "1 A" e
 * "1º Ano A" são a mesma sala. Disciplina: nome oficial ("Língua Portuguesa",
 * não "Português"), com o `id` da `config` quando ela já cadastrou a matéria —
 * assim avaliações e notas antigas continuam apontando para o mesmo id.
 */

const Turma = require('../../models/Turma');
const Aluno = require('../../models/Aluno');
const Professor = require('../../models/Professor');
const Config = require('../../models/Config');
const { escolaMatch } = require('../../middleware/filtrarPorEscola');

// ─── Turmas ─────────────────────────────────────────────────────────────────

/**
 * Lê qualquer grafia de turma e devolve a forma canônica, ou `null` quando o
 * texto não é "série + letra" (ex.: "VARIADOS", que marca o especialista).
 *
 * @param {unknown} texto
 * @returns {{id: string, nome: string, serie: number, serieNome: string, letra: string} | null}
 */
function canonizarTurma(texto) {
    const limpo = String(texto ?? '')
        .toUpperCase()
        .replace(/[º°ª]/g, '')
        .replace(/ANO/g, '')
        .replace(/[\s\-–_.]/g, '');
    const m = /^(\d{1,2})([A-Z])$/.exec(limpo);
    if (!m) return null;

    const serie = Number(m[1]);
    if (serie < 1) return null;
    const letra = m[2];
    return {
        id: `${serie}${letra}`,
        nome: `${serie}º${letra}`,
        serie,
        serieNome: `${serie}º Ano`,
        letra,
    };
}

/**
 * Grafias com que a mesma turma pode estar gravada em `alunos` e `notas`.
 * Serve para consultas por igualdade (`$in`), que não entendem equivalência.
 */
function grafiasDaTurma(texto) {
    const turma = canonizarTurma(texto);
    const bruta = String(texto ?? '').trim();
    if (!turma) return bruta ? [bruta] : [];
    const { serie, letra } = turma;
    return [
        ...new Set([
            bruta,
            `${serie}${letra}`,
            `${serie}º${letra}`,
            `${serie}º ${letra}`,
            `${serie} ${letra}`,
            `${serie}º Ano ${letra}`,
        ]),
    ].filter(Boolean);
}

function ordenarTurmas(turmas) {
    return turmas.sort((a, b) => a.serie - b.serie || a.letra.localeCompare(b.letra));
}

/** Canoniza uma lista de textos, descartando o que não é turma e repetições. */
function canonizarLista(textos) {
    const porId = new Map();
    for (const texto of textos || []) {
        const turma = canonizarTurma(texto);
        if (turma && !porId.has(turma.id)) porId.set(turma.id, turma);
    }
    return ordenarTurmas([...porId.values()]);
}

function filtroProfessoresDaEscola(escolaId) {
    const filtro = { ativo: { $ne: false } };
    if (escolaId && escolaId !== 'default') filtro['vinculos.escolaId'] = String(escolaId);
    return filtro;
}

/**
 * Todas as turmas reais da escola, sem repetição e em ordem de série e letra.
 *
 * Turma desativada na coleção `turmas` não volta pela porta dos fundos: se
 * ainda houver aluno ou professor apontando para ela, continua fora.
 *
 * @param {string} [escolaId] `req.escolaId`
 */
async function turmasDaEscola(escolaId) {
    const escopo = escolaMatch(escolaId);
    const [ativas, inativas, turmasDeAlunos, turmaIdsDeAlunos, professores] = await Promise.all([
        Turma.find({ ...escopo, ativo: { $ne: false } })
            .select('id nome')
            .lean(),
        Turma.find({ ...escopo, ativo: false })
            .select('id nome')
            .lean(),
        Aluno.distinct('turma', { ...escopo, ativo: { $ne: false } }),
        Aluno.distinct('turmaId', { ...escopo, ativo: { $ne: false } }),
        Professor.find(filtroProfessoresDaEscola(escolaId))
            .select('salaPrincipal salasAdicionais turmas')
            .lean(),
    ]);

    const idDoCadastro = (t) => (canonizarTurma(t.nome) || canonizarTurma(t.id))?.id;
    const cadastradas = new Set(ativas.map(idDoCadastro).filter(Boolean));
    const desativadas = new Set(
        inativas
            .map(idDoCadastro)
            .filter(Boolean)
            .filter((id) => !cadastradas.has(id))
    );

    const textos = [
        ...ativas.flatMap((t) => [t.nome, t.id]),
        ...turmasDeAlunos,
        ...turmaIdsDeAlunos,
        ...professores.flatMap((p) => [
            p.salaPrincipal,
            ...(Array.isArray(p.salasAdicionais) ? p.salasAdicionais : []),
            ...(Array.isArray(p.turmas) ? p.turmas : []),
        ]),
    ];
    return canonizarLista(textos).filter((t) => !desativadas.has(t.id));
}

/** `[{ serie, nome: '1º Ano', turmas: [...] }]`, na ordem das séries. */
function agruparPorSerie(turmas) {
    const grupos = new Map();
    for (const turma of turmas) {
        if (!grupos.has(turma.serie)) {
            grupos.set(turma.serie, { serie: turma.serie, nome: turma.serieNome, turmas: [] });
        }
        grupos.get(turma.serie).turmas.push(turma);
    }
    return [...grupos.values()].sort((a, b) => a.serie - b.serie);
}

// ─── Disciplinas ────────────────────────────────────────────────────────────

/** Componentes obrigatórios dos anos iniciais (LDB arts. 26 e 33), na ordem da BNCC. */
const COMPONENTES_OBRIGATORIOS = [
    { nome: 'Língua Portuguesa', sinonimos: ['portugues', 'port', 'lp', 'lingua materna'] },
    { nome: 'Matemática', sinonimos: ['mat'] },
    { nome: 'Ciências', sinonimos: ['ciencia', 'ciencias da natureza'] },
    { nome: 'História', sinonimos: [] },
    { nome: 'Geografia', sinonimos: ['geo'] },
    { nome: 'Arte', sinonimos: ['artes', 'artes visuais', 'educacao artistica'] },
    { nome: 'Educação Física', sinonimos: ['ed fisica', 'edfisica', 'educ fisica', 'ef'] },
    { nome: 'Ensino Religioso', sinonimos: [] },
];

/** Reconhecidos pelo nome, mas só oferecidos quando cadastrados na escola. */
const COMPONENTES_CONDICIONAIS = [{ nome: 'Inglês', sinonimos: ['lingua inglesa', 'ingles'] }];

/**
 * Textos que o cadastro usa no campo de disciplina e que NÃO são disciplina:
 * "Geral" e "PEB I" marcam o professor regente, "Sala Principal" é a chamada
 * do dia, "VARIADOS" é a sala do especialista.
 */
const NAO_DISCIPLINA = new Set([
    'geral',
    'sala principal',
    'peb',
    'peb i',
    'peb 1',
    'polivalente',
    'regente',
    'variados',
    'outro',
    'outros',
]);

/** "Ed. Física" → "ed fisica". Chave de comparação, nunca exibida. */
function chaveDe(texto) {
    return String(texto ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

const CATALOGO = new Map();
[...COMPONENTES_OBRIGATORIOS, ...COMPONENTES_CONDICIONAIS].forEach((componente, ordem) => {
    const entrada = {
        nome: componente.nome,
        obrigatorio: COMPONENTES_OBRIGATORIOS.includes(componente),
        ordem,
    };
    for (const texto of [componente.nome, ...componente.sinonimos]) {
        CATALOGO.set(chaveDe(texto), entrada);
    }
});

/**
 * Nome oficial de uma disciplina, ou `null` quando o texto não é disciplina.
 * Disciplina fora do catálogo (ex.: "Oficina de Leitura") é mantida com o
 * nome que a escola cadastrou.
 *
 * @returns {{chave: string, nome: string, grupo: 'base' | 'diversificada', ordem: number} | null}
 */
function canonizarDisciplina(texto) {
    const chave = chaveDe(texto);
    if (!chave || NAO_DISCIPLINA.has(chave)) return null;

    const doCatalogo = CATALOGO.get(chave);
    if (doCatalogo) {
        return {
            chave: chaveDe(doCatalogo.nome),
            nome: doCatalogo.nome,
            grupo: doCatalogo.obrigatorio ? 'base' : 'diversificada',
            ordem: doCatalogo.ordem,
        };
    }
    return { chave, nome: String(texto).trim(), grupo: 'diversificada', ordem: 100 };
}

async function configDaEscola() {
    return (await Config.findById('config001').lean()) || Config.findOne().lean();
}

/**
 * Disciplinas oferecidas no formulário, sem repetição.
 *
 * @param {string} [escolaId]
 * @returns {Promise<Array<{id: string, nome: string, icone: string, grupo: string}>>}
 */
async function disciplinasDaEscola(escolaId) {
    const [config, professores] = await Promise.all([
        configDaEscola(),
        Professor.find(filtroProfessoresDaEscola(escolaId)).select('materias disciplina').lean(),
    ]);

    const porChave = new Map();
    const registrar = (texto, { id, icone } = {}) => {
        const disciplina = canonizarDisciplina(texto);
        if (!disciplina) return;
        const atual = porChave.get(disciplina.chave);
        if (!atual) {
            porChave.set(disciplina.chave, {
                ...disciplina,
                id: id ? String(id) : disciplina.nome,
                idDaConfig: Boolean(id),
                icone: icone || '',
            });
            return;
        }
        // O id da `config` vence o nome: é ele que avaliações e notas antigas gravaram.
        if (id && !atual.idDaConfig) {
            atual.id = String(id);
            atual.idDaConfig = true;
        }
        if (icone && !atual.icone) atual.icone = icone;
    };

    for (const componente of COMPONENTES_OBRIGATORIOS) registrar(componente.nome);
    for (const materia of config?.materias || []) {
        registrar(materia.nome || materia.id, { id: materia.id, icone: materia.icone });
    }
    for (const professor of professores) {
        for (const texto of [...(professor.materias || []), professor.disciplina]) registrar(texto);
    }

    return [...porChave.values()]
        .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'))
        .map(({ id, nome, icone, grupo }) => ({ id, nome, icone, grupo }));
}

/** Acha a disciplina da lista pelo id gravado ou por qualquer grafia do nome. */
function resolverDisciplina(disciplinas, valor) {
    const bruto = String(valor ?? '').trim();
    if (!bruto) return null;
    const porId = disciplinas.find((d) => d.id === bruto);
    if (porId) return porId;
    const canonica = canonizarDisciplina(bruto);
    if (!canonica) return null;
    return disciplinas.find((d) => chaveDe(d.nome) === canonica.chave) || null;
}

// ─── Docentes ───────────────────────────────────────────────────────────────

/**
 * O que a página precisa saber de um professor — nome, salas e disciplinas.
 * Contato (e-mail, telefone) fica de fora de propósito.
 */
function resumoDocente(professor) {
    const salas = [
        professor.salaPrincipal,
        ...(Array.isArray(professor.salasAdicionais) ? professor.salasAdicionais : []),
        ...(Array.isArray(professor.turmas) ? professor.turmas : []),
    ];
    const disciplinas = [
        ...new Set(
            [...(professor.materias || []), professor.disciplina]
                .map((t) => canonizarDisciplina(t)?.nome)
                .filter(Boolean)
        ),
    ];
    return {
        id: String(professor.idUsuario),
        nome: professor.nome,
        turmas: canonizarLista(salas).map((t) => t.id),
        salaPrincipal: canonizarTurma(professor.salaPrincipal)?.id || null,
        disciplinas,
        especialista:
            professor.tipoEspecial === true ||
            String(professor.salaPrincipal || '').toUpperCase() === 'VARIADOS',
    };
}

const CAMPOS_DOCENTE =
    'idUsuario nome salaPrincipal salasAdicionais turmas materias disciplina tipoEspecial';

async function docentesDaEscola(escolaId) {
    const professores = await Professor.find(filtroProfessoresDaEscola(escolaId))
        .select(CAMPOS_DOCENTE)
        .sort({ nome: 1 })
        .lean();
    return professores.filter((p) => p.idUsuario).map(resumoDocente);
}

/** Cadastro pedagógico do usuário logado — mesma busca de `horizontalFilter`. */
async function docenteDoUsuario(usuarioId) {
    if (!usuarioId) return null;
    const professor = await Professor.findOne({ idUsuario: String(usuarioId) })
        .select(CAMPOS_DOCENTE)
        .lean();
    return professor ? resumoDocente(professor) : null;
}

/**
 * Disciplinas que o professor pode avaliar. O regente (PEB I) responde por
 * todas as da sala; o especialista (Inglês, Educação Física, Arte…), só
 * pelas que declarou no cadastro.
 */
function disciplinasDoDocente(docente, disciplinas) {
    if (!docente?.especialista || docente.disciplinas.length === 0) return disciplinas;
    return disciplinas.filter((d) => docente.disciplinas.includes(d.nome));
}

/**
 * Quem responde pela avaliação quando a gestão não escolheu: o especialista
 * da disciplina naquela turma; senão, o regente da sala; senão, ninguém.
 */
function professorResponsavel(docentes, turmaId, disciplinaNome) {
    const daTurma = docentes.filter((d) => d.turmas.includes(turmaId));
    return (
        daTurma.find((d) => d.especialista && d.disciplinas.includes(disciplinaNome)) ||
        daTurma.find((d) => !d.especialista && d.salaPrincipal === turmaId) ||
        null
    );
}

module.exports = {
    canonizarTurma,
    grafiasDaTurma,
    canonizarLista,
    turmasDaEscola,
    agruparPorSerie,
    canonizarDisciplina,
    disciplinasDaEscola,
    resolverDisciplina,
    docentesDaEscola,
    docenteDoUsuario,
    disciplinasDoDocente,
    professorResponsavel,
};
