/**
 * permissaoFerramenta.js — quem pode usar cada ferramenta do catálogo, e a
 * decisão da direção sobre isso (Issue #720).
 *
 * REGRAS
 * ------
 *   - Só o perfil `professor` é verificado. Diretor e admin decidem e usam;
 *     secretaria e responsável seguem as regras de cada rota, como antes.
 *   - A escola é SEMPRE a da sessão (`req.escolaId`, resolvida e conferida
 *     contra os vínculos por `filtrarPorEscola`) — nunca uma que venha no
 *     corpo ou na URL. Uma autorização dada na escola A não vale na B.
 *   - Sem escola resolvida, ou ferramenta fora do catálogo, a resposta é
 *     "não": falha fechada.
 *   - Nada aqui tem cache: a decisão da direção vale na próxima requisição do
 *     professor, em qualquer instância, sem depender de sair e entrar.
 */
const PermissaoFerramenta = require('../../models/PermissaoFerramenta');
const SolicitacaoFerramenta = require('../../models/SolicitacaoFerramenta');
const Usuario = require('../../models/Usuario');
const Professor = require('../../models/Professor');
const { turmasDoProfessorNaEscola } = require('../turmasDoProfessor');
const { ferramentaPorId, FERRAMENTAS } = require('./catalogo');

const PERFIS_CONTROLADOS = new Set(['professor']);

// Teto de alterações num "Salvar autorizações". Uma escola com 80 professores
// e o catálogo inteiro marcado cabe com folga; acima disso é abuso ou defeito.
const MAX_ALTERACOES = 1000;

function perfilDe(usuario) {
    return String(usuario?.perfil || '').toLowerCase();
}

function idDe(usuario) {
    return String(usuario?.id || usuario?._id || '');
}

function erroDeEntrada(mensagem, status = 400, codigo = 'ENTRADA_INVALIDA') {
    const e = new Error(mensagem);
    e.status = status;
    e.codigo = codigo;
    return e;
}

/**
 * A verificação central: este usuário pode usar esta ferramenta nesta escola?
 *
 * @param {object} usuario  `req.user` (precisa de `id`/`_id` e `perfil`)
 * @param {string|null} escolaId  `req.escolaId`
 * @param {string} ferramentaId  chave do catálogo
 * @returns {Promise<{liberado: boolean, motivo?: string}>}
 */
async function checkToolPermission(usuario, escolaId, ferramentaId) {
    if (!ferramentaPorId(ferramentaId)) {
        return { liberado: false, motivo: 'FERRAMENTA_DESCONHECIDA' };
    }
    if (!PERFIS_CONTROLADOS.has(perfilDe(usuario))) return { liberado: true };
    if (!escolaId) return { liberado: false, motivo: 'ESCOLA_NAO_RESOLVIDA' };

    const autorizado = await PermissaoFerramenta.exists({
        escolaId: String(escolaId),
        professorId: idDe(usuario),
        ferramentaId: String(ferramentaId),
        autorizado: true,
    });
    return autorizado ? { liberado: true } : { liberado: false, motivo: 'NAO_AUTORIZADO' };
}

/** Há pedido pendente deste professor para esta ferramenta nesta escola? */
async function temSolicitacaoPendente(professorId, escolaId, ferramentaId) {
    if (!escolaId) return false;
    return Boolean(
        await SolicitacaoFerramenta.exists({
            escolaId: String(escolaId),
            professorId: String(professorId),
            ferramentaId: String(ferramentaId),
            status: 'pendente',
        })
    );
}

/**
 * Professores da escola: contas de professor ativas cuja escola é esta, mais
 * os cadastros de professor com vínculo nesta escola. As turmas são as que o
 * professor tem NESTA escola (Issue #707).
 *
 * @returns {Promise<Array<{id: string, nome: string, turmas: string[], disciplinas: string[]}>>}
 */
async function professoresDaEscola(escolaId) {
    if (!escolaId) return [];
    const escola = String(escolaId);
    const contaAtiva = { perfil: 'professor', ativo: { $ne: false }, anonimizadoEm: null };

    const [contasDaEscola, cadastrosComVinculo] = await Promise.all([
        Usuario.find({ ...contaAtiva, escolaId: escola })
            .select('_id nome')
            .lean(),
        Professor.find({ 'vinculos.escolaId': escola, ativo: { $ne: false } })
            .select(
                'idUsuario nome disciplina materias turmas salaPrincipal salasAdicionais vinculos'
            )
            .lean(),
    ]);

    const contas = new Map(contasDaEscola.map((u) => [String(u._id), u]));

    // Cadastro com vínculo aqui, mas conta registrada em outra escola: confere
    // que a conta existe, é de professor e está ativa.
    const faltantes = [
        ...new Set(
            cadastrosComVinculo
                .map((p) => p.idUsuario && String(p.idUsuario))
                .filter((id) => id && !contas.has(id))
        ),
    ];
    if (faltantes.length) {
        const extras = await Usuario.find({ ...contaAtiva, _id: { $in: faltantes } })
            .select('_id nome')
            .lean();
        for (const u of extras) contas.set(String(u._id), u);
    }

    // Conta da escola sem cadastro de professor entre os vínculos: busca o
    // cadastro dela para mostrar turmas e disciplinas.
    const cadastros = new Map(
        cadastrosComVinculo.filter((p) => p.idUsuario).map((p) => [String(p.idUsuario), p])
    );
    const semCadastro = [...contas.keys()].filter((id) => !cadastros.has(id));
    if (semCadastro.length) {
        const outros = await Professor.find({ idUsuario: { $in: semCadastro } })
            .select(
                'idUsuario nome disciplina materias turmas salaPrincipal salasAdicionais vinculos'
            )
            .lean();
        for (const p of outros) cadastros.set(String(p.idUsuario), p);
    }

    return [...contas.values()]
        .map((u) => {
            const id = String(u._id);
            const cadastro = cadastros.get(id) || null;
            return {
                id,
                nome: u.nome || cadastro?.nome || 'Professor sem nome',
                turmas: turmasDoProfessorNaEscola(cadastro, escola),
                disciplinas: [
                    ...new Set(
                        [...(cadastro?.materias || []), cadastro?.disciplina].filter(Boolean)
                    ),
                ],
            };
        })
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function statusDe(permissao, pendente) {
    if (permissao?.autorizado) return 'autorizado';
    return pendente ? 'pendente' : 'bloqueado';
}

/**
 * Quadro da direção: professores da escola × ferramentas do catálogo, com o
 * status, quem concedeu, a última alteração e o pedido pendente, se houver.
 */
async function quadroDaEscola(escolaId) {
    const escola = String(escolaId);
    const [professores, permissoes, pendentes] = await Promise.all([
        professoresDaEscola(escola),
        PermissaoFerramenta.find({ escolaId: escola }).lean(),
        SolicitacaoFerramenta.find({ escolaId: escola, status: 'pendente' }).lean(),
    ]);

    const chave = (professorId, ferramentaId) => `${professorId}|${ferramentaId}`;
    const porChave = new Map(permissoes.map((p) => [chave(p.professorId, p.ferramentaId), p]));
    const pedidoPorChave = new Map(pendentes.map((s) => [chave(s.professorId, s.ferramentaId), s]));

    // Nomes de quem decidiu, numa consulta só.
    const decisores = [
        ...new Set(permissoes.flatMap((p) => [p.autorizadoPor, p.alteradoPor]).filter(Boolean)),
    ];
    const nomes = new Map(
        (decisores.length
            ? await Usuario.find({ _id: { $in: decisores } })
                  .select('_id nome')
                  .lean()
            : []
        ).map((u) => [String(u._id), u.nome])
    );
    const pessoa = (id) => (id ? { id, nome: nomes.get(String(id)) || 'Conta removida' } : null);

    return {
        professores: professores.map((prof) => ({
            ...prof,
            ferramentas: Object.fromEntries(
                FERRAMENTAS.map((f) => {
                    const permissao = porChave.get(chave(prof.id, f.id)) || null;
                    const pedido = pedidoPorChave.get(chave(prof.id, f.id)) || null;
                    return [
                        f.id,
                        {
                            status: statusDe(permissao, pedido),
                            autorizadoPor: permissao?.autorizado
                                ? pessoa(permissao.autorizadoPor)
                                : null,
                            autorizadoEm: permissao?.autorizado ? permissao.autorizadoEm : null,
                            alteradoPor: pessoa(permissao?.alteradoPor),
                            atualizadoEm: permissao?.updatedAt || null,
                            solicitacao: pedido
                                ? {
                                      id: String(pedido._id),
                                      criadaEm: pedido.createdAt,
                                      mensagem: pedido.mensagem || '',
                                  }
                                : null,
                        },
                    ];
                })
            ),
        })),
    };
}

/**
 * Situação de cada ferramenta para quem está logado — o que a conta do
 * professor usa para mostrar cadeado e botão de pedido.
 */
async function situacaoDoUsuario(usuario, escolaId) {
    const controlado = PERFIS_CONTROLADOS.has(perfilDe(usuario));
    if (!controlado) {
        return FERRAMENTAS.map((f) => ({ id: f.id, status: 'livre' }));
    }
    if (!escolaId) return FERRAMENTAS.map((f) => ({ id: f.id, status: 'bloqueado' }));

    const professorId = idDe(usuario);
    const escola = String(escolaId);
    const [permissoes, pendentes] = await Promise.all([
        PermissaoFerramenta.find({ escolaId: escola, professorId, autorizado: true })
            .select('ferramentaId')
            .lean(),
        SolicitacaoFerramenta.find({ escolaId: escola, professorId, status: 'pendente' })
            .select('ferramentaId')
            .lean(),
    ]);
    const autorizadas = new Set(permissoes.map((p) => p.ferramentaId));
    const pedidas = new Set(pendentes.map((s) => s.ferramentaId));

    return FERRAMENTAS.map((f) => ({
        id: f.id,
        status: autorizadas.has(f.id) ? 'autorizado' : pedidas.has(f.id) ? 'pendente' : 'bloqueado',
    }));
}

/**
 * Valida o corpo do "Salvar autorizações". Duplicatas do mesmo par valem pela
 * última ocorrência — é o que a tela mostrava por último.
 *
 * @returns {Array<{professorId: string, ferramentaId: string, autorizado: boolean}>}
 */
function normalizarAlteracoes(alteracoes) {
    if (!Array.isArray(alteracoes) || alteracoes.length === 0) {
        throw erroDeEntrada('Envie a lista de alterações em "alteracoes".');
    }
    if (alteracoes.length > MAX_ALTERACOES) {
        throw erroDeEntrada(`No máximo ${MAX_ALTERACOES} alterações por vez.`);
    }

    const porPar = new Map();
    for (const item of alteracoes) {
        const professorId = typeof item?.professorId === 'string' ? item.professorId.trim() : '';
        const ferramentaId = typeof item?.ferramentaId === 'string' ? item.ferramentaId.trim() : '';
        if (!professorId || !ferramentaId || typeof item.autorizado !== 'boolean') {
            throw erroDeEntrada(
                'Cada alteração precisa de professorId, ferramentaId e autorizado (true ou false).'
            );
        }
        if (!ferramentaPorId(ferramentaId)) {
            throw erroDeEntrada(
                `Ferramenta desconhecida: "${ferramentaId}".`,
                400,
                'FERRAMENTA_DESCONHECIDA'
            );
        }
        porPar.set(`${professorId}|${ferramentaId}`, {
            professorId,
            ferramentaId,
            autorizado: item.autorizado,
        });
    }
    return [...porPar.values()];
}

/**
 * Grava a decisão de UM par. Devolve o estado anterior, lido do próprio
 * documento no momento da escrita (pré-imagem do findOneAndUpdate), para o
 * log de auditoria não registrar um "antes" desatualizado se duas pessoas da
 * direção salvarem ao mesmo tempo.
 */
async function gravarDecisao({ escolaId, professorId, ferramentaId, autorizado, diretorId }) {
    const agora = new Date();
    const filtro = { escolaId, professorId, ferramentaId };
    const atualizacao = {
        $set: autorizado
            ? {
                  autorizado: true,
                  autorizadoPor: diretorId,
                  autorizadoEm: agora,
                  alteradoPor: diretorId,
              }
            : {
                  autorizado: false,
                  autorizadoPor: null,
                  autorizadoEm: null,
                  alteradoPor: diretorId,
              },
    };
    // Na inserção, o upsert grava os campos de igualdade do filtro.
    const opcoes = { upsert: true, returnDocument: 'before' };

    let anterior;
    try {
        anterior = await PermissaoFerramenta.findOneAndUpdate(filtro, atualizacao, opcoes).lean();
    } catch (e) {
        // Duas inserções simultâneas do mesmo par: uma vence o índice único e a
        // outra repete como atualização.
        if (e?.code !== 11000) throw e;
        anterior = await PermissaoFerramenta.findOneAndUpdate(filtro, atualizacao, opcoes).lean();
    }
    return anterior?.autorizado === true;
}

/**
 * "Salvar autorizações" da direção.
 *
 * Valida TUDO antes de gravar qualquer coisa: um único professor de outra
 * escola recusa o lote inteiro. Pares sem mudança não geram escrita nem log.
 * O pedido pendente do par é encerrado com a decisão (autorizada/recusada).
 *
 * @param {object} p
 * @param {string} p.escolaId   escola da sessão do diretor
 * @param {string} p.diretorId  `req.user.id`
 * @param {Array}  p.alteracoes corpo da requisição
 * @param {Function} p.auditar  (acao, detalhes) => Promise — grava no AuditLog
 * @returns {Promise<{alteradas: Array, inalteradas: number}>}
 */
async function salvarAutorizacoes({ escolaId, diretorId, alteracoes, auditar }) {
    const escola = String(escolaId);
    const pedidas = normalizarAlteracoes(alteracoes);

    const professores = await professoresDaEscola(escola);
    const daEscola = new Map(professores.map((p) => [p.id, p]));
    const deFora = pedidas.filter((a) => !daEscola.has(a.professorId));
    if (deFora.length) {
        throw erroDeEntrada(
            'Há professor que não pertence a esta escola. Nenhuma autorização foi salva.',
            403,
            'PROFESSOR_FORA_DA_ESCOLA'
        );
    }

    const atuais = await PermissaoFerramenta.find({
        escolaId: escola,
        professorId: { $in: [...new Set(pedidas.map((a) => a.professorId))] },
    })
        .select('professorId ferramentaId autorizado')
        .lean();
    const autorizadoAgora = new Set(
        atuais.filter((p) => p.autorizado).map((p) => `${p.professorId}|${p.ferramentaId}`)
    );

    const alteradas = [];
    let inalteradas = 0;
    for (const alteracao of pedidas) {
        const { professorId, ferramentaId, autorizado } = alteracao;
        if (autorizadoAgora.has(`${professorId}|${ferramentaId}`) === autorizado) {
            inalteradas++;
            continue;
        }

        const antes = await gravarDecisao({
            escolaId: escola,
            professorId,
            ferramentaId,
            autorizado,
            diretorId,
        });
        if (antes === autorizado) {
            // Outra pessoa da direção gravou o mesmo entre a leitura e a escrita.
            inalteradas++;
            continue;
        }

        await SolicitacaoFerramenta.updateMany(
            { escolaId: escola, professorId, ferramentaId, status: 'pendente' },
            {
                $set: {
                    status: autorizado ? 'autorizada' : 'recusada',
                    decididaPor: diretorId,
                    decididaEm: new Date(),
                },
            }
        );

        const ferramenta = ferramentaPorId(ferramentaId);
        const professor = daEscola.get(professorId);
        await auditar(autorizado ? 'FERRAMENTA_AUTORIZADA' : 'FERRAMENTA_REVOGADA', {
            recursoId: `${professorId}:${ferramentaId}`,
            valorAnterior: { professorId, ferramentaId, autorizado: antes },
            valorNovo: { professorId, ferramentaId, autorizado },
            descricao: `${ferramenta.nome} ${autorizado ? 'autorizado' : 'revogado'} para ${professor.nome}.`,
        });

        alteradas.push({ professorId, ferramentaId, autorizado, antes });
    }

    return { alteradas, inalteradas };
}

module.exports = {
    checkToolPermission,
    temSolicitacaoPendente,
    professoresDaEscola,
    quadroDaEscola,
    situacaoDoUsuario,
    salvarAutorizacoes,
};
