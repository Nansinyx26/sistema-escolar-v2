/**
 * FaltaFuncionarioController — Planilha de Faltas FUNCIONÁRIOS.
 *
 * Regras de negócio que valem para todos os endpoints daqui:
 *
 *  - VIGÊNCIA: a planilha passa a valer a partir de julho do ano de implantação
 *    ("a partir do mês de julho, todos os funcionários podem programar e
 *    acompanhar suas faltas"). Meses anteriores não abrem — nem para leitura,
 *    nem para escrita. Configurável por env para o ano seguinte não travar.
 *
 *  - ESCOPO: professor enxerga e edita APENAS a própria planilha. Direção,
 *    secretaria e admin operam a planilha de qualquer funcionário da escola
 *    ativa da sessão (req.escolaId, resolvido por filtrarPorEscola).
 *
 *  - CALENDÁRIO: a coluna não é gravada. É derivada do dia da semana e dos
 *    eventos do CalendarioEscolar da escola, e por isso acompanha mudanças de
 *    feriado/recesso feitas pela direção depois do lançamento.
 */
const FaltaFuncionario = require('../models/FaltaFuncionario');
const CalendarioEscolar = require('../models/CalendarioEscolar');
const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const { escolaMatch } = require('../middleware/filtrarPorEscola');
const { logAction } = require('../utils/auditHelper');

const MESES = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];
const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const DIAS_SEMANA_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const PERFIS_FUNCIONARIO = ['professor', 'diretor', 'secretaria'];
const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

/**
 * Início da vigência da planilha. O padrão (julho/2026) é a implantação;
 * PLANILHA_FALTAS_ANO_INICIO / _MES_INICIO permitem mover sem alterar código.
 */
const VIGENCIA = {
    ano: Number(process.env.PLANILHA_FALTAS_ANO_INICIO) || 2026,
    mes: Number(process.env.PLANILHA_FALTAS_MES_INICIO) || 7
};

function ehGestao(perfil) {
    return PERFIS_GESTAO.includes(String(perfil || '').toLowerCase());
}

function mesDisponivel(ano, mes) {
    if (ano > VIGENCIA.ano) return true;
    if (ano < VIGENCIA.ano) return false;
    return mes >= VIGENCIA.mes;
}

function rotuloMes(ano, mes) {
    return `${MESES[mes - 1]}/${ano}`;
}

/** Valida e normaliza ?ano=&mes= — devolve null quando o par é inválido. */
function lerCompetencia(query) {
    const ano = Number(query.ano);
    const mes = Number(query.mes);
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return null;
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
    return { ano, mes };
}

/** Anos que a UI pode navegar: da vigência até o ano seguinte ao atual. */
function anosDisponiveis() {
    const atual = new Date().getFullYear();
    const fim = Math.max(atual, VIGENCIA.ano) + 1;
    const anos = [];
    for (let a = VIGENCIA.ano; a <= fim; a++) anos.push(a);
    return anos;
}

// ─────────────────────────────────────────────────────────
// Funcionários da escola
// ─────────────────────────────────────────────────────────

/**
 * Funcionários (professor/diretor/secretaria) da escola ativa.
 *
 * A união com as coleções de cargo existe porque o vínculo multi-escola vive em
 * `vinculos[].escolaId` (Professor/Diretor) enquanto o Usuario carrega
 * `escolaId`. Filtrar só por um dos dois deixaria de fora contas migradas pela
 * metade — e a planilha da direção apareceria vazia.
 */
async function buscarFuncionarios(escolaId) {
    const filtro = { perfil: { $in: PERFIS_FUNCIONARIO }, ativo: { $ne: false } };

    if (escolaId) {
        const alvo = String(escolaId);
        const [profs, dirs, secs] = await Promise.all([
            Professor.find({ 'vinculos.escolaId': alvo }).select('idUsuario').lean(),
            Diretor.find({ 'vinculos.escolaId': alvo }).select('idUsuario').lean(),
            Secretaria.find({ $or: [{ 'vinculos.escolaId': alvo }, { escolaId: alvo }] }).select('idUsuario').lean()
        ]);

        const idsPorVinculo = [];
        for (const doc of [...profs, ...dirs, ...secs]) {
            if (doc.idUsuario) idsPorVinculo.push(String(doc.idUsuario));
        }

        filtro.$or = [{ escolaId: alvo }];
        if (idsPorVinculo.length) filtro.$or.push({ _id: { $in: idsPorVinculo } });
    }

    const usuarios = await Usuario.find(filtro)
        .select('nome email perfil')
        .sort({ nome: 1 })
        .lean();

    return usuarios.map(u => ({
        id: String(u._id),
        nome: u.nome,
        email: u.email,
        cargo: u.perfil
    }));
}

/**
 * Decide de QUEM é a planilha da requisição.
 * Professor sempre cai na própria; gestão pode apontar para outro funcionário
 * da mesma escola (nunca de fora dela).
 */
async function resolverFuncionarioAlvo(req, funcionarioIdSolicitado) {
    const meuId = String(req.user.id || req.user._id || '');
    const solicitado = funcionarioIdSolicitado ? String(funcionarioIdSolicitado) : '';

    if (!solicitado || solicitado === meuId) {
        const eu = await Usuario.findById(meuId).select('nome email perfil').lean();
        if (!eu) return { erro: { status: 401, mensagem: 'Usuário da sessão não encontrado.' } };
        return { funcionario: { id: meuId, nome: eu.nome, email: eu.email, cargo: eu.perfil }, proprio: true };
    }

    if (!ehGestao(req.user.perfil)) {
        return { erro: { status: 403, mensagem: 'Você só pode acessar a sua própria planilha de faltas.' } };
    }

    const funcionarios = await buscarFuncionarios(req.escolaId);
    const alvo = funcionarios.find(f => f.id === solicitado);
    if (!alvo) {
        return { erro: { status: 404, mensagem: 'Funcionário não encontrado nesta escola.' } };
    }
    return { funcionario: alvo, proprio: false };
}

// ─────────────────────────────────────────────────────────
// Coluna CALENDÁRIO
// ─────────────────────────────────────────────────────────

const TIPO_CALENDARIO = {
    feriado: { rotulo: 'Feriado', letivo: false, prioridade: 1 },
    recesso: { rotulo: 'Recesso', letivo: false, prioridade: 2 },
    formacao: { rotulo: 'Formação', letivo: true, prioridade: 3 },
    conselho_classe: { rotulo: 'Conselho de Classe', letivo: true, prioridade: 4 },
    reuniao_pais: { rotulo: 'Reunião de Pais', letivo: true, prioridade: 5 },
    prova: { rotulo: 'Avaliações', letivo: true, prioridade: 6 },
    evento: { rotulo: 'Evento', letivo: true, prioridade: 7 },
    matricula: { rotulo: 'Matrícula', letivo: true, prioridade: 8 },
    aula: { rotulo: 'Dia letivo', letivo: true, prioridade: 9 },
    outro: { rotulo: 'Outro', letivo: true, prioridade: 10 }
};

/** Eventos da escola que tocam qualquer dia do mês (abrangência de escola). */
async function eventosDoMes(escolaId, ano, mes) {
    const inicioMes = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
    const fimMes = new Date(ano, mes, 0, 23, 59, 59, 999);

    return CalendarioEscolar.find({
        ativo: { $ne: false },
        abrangencia: { $ne: 'turma' }, // planilha é de funcionário, não de turma
        dataInicio: { $lte: fimMes },
        dataFim: { $gte: inicioMes },
        ...escolaMatch(escolaId)
    }).select('titulo tipo dataInicio dataFim').lean();
}

/**
 * Monta as colunas DIA + CALENDÁRIO do mês inteiro (1..N), já mescladas com o
 * que foi lançado. Dias sem lançamento vêm zerados — a planilha na tela é
 * sempre o mês completo, mesmo que o banco guarde só os dias marcados.
 */
function montarDias(ano, mes, eventos, lancamentos) {
    const diasNoMes = new Date(ano, mes, 0).getDate();
    const porDia = new Map((lancamentos || []).map(d => [Number(d.dia), d]));
    const linhas = [];

    for (let dia = 1; dia <= diasNoMes; dia++) {
        const data = new Date(ano, mes - 1, dia);
        const dow = data.getDay();
        const fimDeSemana = dow === 0 || dow === 6;

        // Evento de maior prioridade que cobre este dia (feriado ganha de evento)
        let calendario = null;
        for (const ev of eventos) {
            const inicio = new Date(ev.dataInicio); inicio.setHours(0, 0, 0, 0);
            const fim = new Date(ev.dataFim); fim.setHours(23, 59, 59, 999);
            if (data < inicio || data > fim) continue;

            const meta = TIPO_CALENDARIO[ev.tipo] || TIPO_CALENDARIO.outro;
            if (!calendario || meta.prioridade < calendario.prioridade) {
                calendario = {
                    tipo: ev.tipo,
                    rotulo: ev.titulo || meta.rotulo,
                    letivo: meta.letivo && !fimDeSemana,
                    prioridade: meta.prioridade
                };
            }
        }

        if (!calendario) {
            calendario = fimDeSemana
                ? { tipo: 'fim_de_semana', rotulo: DIAS_SEMANA[dow], letivo: false, prioridade: 99 }
                : { tipo: 'aula', rotulo: 'Dia letivo', letivo: true, prioridade: 99 };
        }
        delete calendario.prioridade;

        const registro = porDia.get(dia) || {};
        linhas.push({
            dia,
            diaSemana: DIAS_SEMANA_CURTO[dow],
            diaSemanaLongo: DIAS_SEMANA[dow],
            fimDeSemana,
            calendario,
            abonadas: !!registro.abonadas,
            atestado: !!registro.atestado,
            descontoHoras: Number(registro.descontoHoras) || 0,
            tre: !!registro.tre,
            injustificadas: !!registro.injustificadas,
            observacoes: registro.observacoes || ''
        });
    }

    return linhas;
}

// ─────────────────────────────────────────────────────────
// Normalização e totais
// ─────────────────────────────────────────────────────────

function linhaVazia(d) {
    return !d.abonadas && !d.atestado && !d.tre && !d.injustificadas
        && d.descontoHoras === 0 && !d.observacoes;
}

/** Aceita o mês inteiro vindo da tela e devolve só os dias com marcação. */
function sanitizarDias(dias, diasNoMes) {
    if (!Array.isArray(dias)) return [];

    const porDia = new Map();
    for (const bruto of dias) {
        const dia = Number(bruto?.dia);
        if (!Number.isInteger(dia) || dia < 1 || dia > diasNoMes) continue;

        const horas = Number(bruto?.descontoHoras);
        const registro = {
            dia,
            abonadas: !!bruto?.abonadas,
            atestado: !!bruto?.atestado,
            descontoHoras: Number.isFinite(horas) ? Math.round(Math.min(24, Math.max(0, horas)) * 100) / 100 : 0,
            tre: !!bruto?.tre,
            injustificadas: !!bruto?.injustificadas,
            observacoes: String(bruto?.observacoes ?? '').trim().slice(0, 300)
        };

        if (linhaVazia(registro)) continue;
        porDia.set(dia, registro); // dia repetido no payload: o último vence
    }

    return [...porDia.values()].sort((a, b) => a.dia - b.dia);
}

function calcularTotais(dias) {
    const totais = (dias || []).reduce((acc, d) => ({
        abonadas: acc.abonadas + (d.abonadas ? 1 : 0),
        atestado: acc.atestado + (d.atestado ? 1 : 0),
        descontoHoras: acc.descontoHoras + (Number(d.descontoHoras) || 0),
        tre: acc.tre + (d.tre ? 1 : 0),
        injustificadas: acc.injustificadas + (d.injustificadas ? 1 : 0),
        diasComRegistro: acc.diasComRegistro + (linhaVazia({
            abonadas: !!d.abonadas, atestado: !!d.atestado, tre: !!d.tre,
            injustificadas: !!d.injustificadas,
            descontoHoras: Number(d.descontoHoras) || 0,
            observacoes: d.observacoes || ''
        }) ? 0 : 1)
    }), { abonadas: 0, atestado: 0, descontoHoras: 0, tre: 0, injustificadas: 0, diasComRegistro: 0 });

    totais.descontoHoras = Math.round(totais.descontoHoras * 100) / 100;
    return totais;
}

async function resolverEscola(req) {
    if (!req.escolaId) {
        return { id: null, nome: 'Escola', tipo: null, municipio: null };
    }
    const escola = await Escola.findById(req.escolaId).select('nome tipo bairro municipio').lean();
    if (!escola) return { id: String(req.escolaId), nome: 'Escola', tipo: null, municipio: null };
    return {
        id: String(escola._id),
        nome: escola.nome,
        tipo: escola.tipo || null,
        bairro: escola.bairro || '',
        municipio: escola.municipio || ''
    };
}

// ─────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────

/**
 * GET /api/faltas-funcionarios/contexto
 * Cabeçalho da página: nome da escola (do banco), quem está logado, vigência e
 * a lista de meses/anos que a navegação pode abrir.
 */
exports.contexto = async (req, res) => {
    try {
        const escola = await resolverEscola(req);
        const gestao = ehGestao(req.user.perfil);
        const hoje = new Date();

        const anos = anosDisponiveis();
        const anoCorrente = Math.min(Math.max(hoje.getFullYear(), VIGENCIA.ano), anos[anos.length - 1]);
        const mesCorrente = hoje.getFullYear() === VIGENCIA.ano
            ? Math.max(hoje.getMonth() + 1, VIGENCIA.mes)
            : hoje.getMonth() + 1;

        res.json({
            success: true,
            data: {
                escola,
                usuario: {
                    id: String(req.user.id || req.user._id),
                    nome: req.user.nome,
                    cargo: req.user.perfil,
                    ehGestao: gestao
                },
                vigencia: {
                    ano: VIGENCIA.ano,
                    mes: VIGENCIA.mes,
                    rotulo: rotuloMes(VIGENCIA.ano, VIGENCIA.mes)
                },
                anos,
                meses: MESES.map((nome, i) => ({ mes: i + 1, nome })),
                // Mês que a tela deve abrir por padrão
                atual: { ano: anoCorrente, mes: mesCorrente }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/faltas-funcionarios/funcionarios
 * Alimenta o seletor de funcionário da direção/secretaria.
 */
exports.funcionarios = async (req, res) => {
    try {
        if (!ehGestao(req.user.perfil)) {
            return res.status(403).json({ success: false, error: 'Apenas a gestão pode listar funcionários.' });
        }
        const data = await buscarFuncionarios(req.escolaId);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/faltas-funcionarios/planilha?ano=&mes=&funcionarioId=
 * A planilha do mês, com o mês completo (dias 1..N) já mesclado.
 */
exports.getPlanilha = async (req, res) => {
    try {
        const competencia = lerCompetencia(req.query);
        if (!competencia) {
            return res.status(400).json({ success: false, error: 'Informe ano e mês válidos.' });
        }
        const { ano, mes } = competencia;

        if (!mesDisponivel(ano, mes)) {
            return res.status(400).json({
                success: false,
                error: `A planilha de faltas começa em ${rotuloMes(VIGENCIA.ano, VIGENCIA.mes)}.`
            });
        }

        const alvo = await resolverFuncionarioAlvo(req, req.query.funcionarioId);
        if (alvo.erro) return res.status(alvo.erro.status).json({ success: false, error: alvo.erro.mensagem });

        const [escola, doc, eventos] = await Promise.all([
            resolverEscola(req),
            FaltaFuncionario.findOne({
                funcionarioId: alvo.funcionario.id,
                ano, mes,
                ...escolaMatch(req.escolaId)
            }).lean(),
            eventosDoMes(req.escolaId, ano, mes)
        ]);

        const dias = montarDias(ano, mes, eventos, doc?.dias);

        res.json({
            success: true,
            data: {
                escola,
                funcionario: alvo.funcionario,
                ano,
                mes,
                mesNome: MESES[mes - 1],
                rotulo: rotuloMes(ano, mes),
                diasNoMes: dias.length,
                dias,
                totais: calcularTotais(dias),
                podeEditar: alvo.proprio || ehGestao(req.user.perfil),
                atualizadoEm: doc?.updatedAt || null,
                atualizadoPorNome: doc?.atualizadoPorNome || null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * PUT /api/faltas-funcionarios/planilha
 * Body: { ano, mes, funcionarioId?, dias: [{ dia, abonadas, atestado,
 *         descontoHoras, tre, injustificadas, observacoes }] }
 *
 * Substitui o mês inteiro (a tela envia o mês completo). Dias sem marcação são
 * descartados, então desmarcar tudo apaga o lançamento daquele dia.
 */
exports.salvarPlanilha = async (req, res) => {
    try {
        const competencia = lerCompetencia(req.body || {});
        if (!competencia) {
            return res.status(400).json({ success: false, error: 'Informe ano e mês válidos.' });
        }
        const { ano, mes } = competencia;

        if (!mesDisponivel(ano, mes)) {
            return res.status(400).json({
                success: false,
                error: `A planilha de faltas começa em ${rotuloMes(VIGENCIA.ano, VIGENCIA.mes)}.`
            });
        }

        const alvo = await resolverFuncionarioAlvo(req, req.body.funcionarioId);
        if (alvo.erro) return res.status(alvo.erro.status).json({ success: false, error: alvo.erro.mensagem });

        const diasNoMes = new Date(ano, mes, 0).getDate();
        const dias = sanitizarDias(req.body.dias, diasNoMes);

        const filtro = {
            funcionarioId: alvo.funcionario.id,
            ano, mes,
            escolaId: req.escolaId ? String(req.escolaId) : null
        };

        const doc = await FaltaFuncionario.findOneAndUpdate(
            filtro,
            {
                $set: {
                    ...filtro,
                    funcionarioNome: alvo.funcionario.nome,
                    funcionarioEmail: alvo.funcionario.email,
                    cargo: alvo.funcionario.cargo,
                    dias,
                    atualizadoPor: String(req.user.id || req.user._id),
                    atualizadoPorNome: req.user.nome
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        const totais = calcularTotais(dias);

        await logAction(req, 'UPDATE_FALTAS_FUNCIONARIO', 'FaltasFuncionarios', {
            recursoId: String(doc._id),
            descricao: `Planilha de faltas de ${alvo.funcionario.nome} — ${rotuloMes(ano, mes)}: `
                + `${totais.diasComRegistro} dia(s) com lançamento.`,
            valorNovo: totais
        });

        const eventos = await eventosDoMes(req.escolaId, ano, mes);

        res.json({
            success: true,
            message: `Planilha de ${rotuloMes(ano, mes)} salva com sucesso!`,
            data: {
                ano, mes,
                dias: montarDias(ano, mes, eventos, dias),
                totais,
                atualizadoEm: doc.updatedAt,
                atualizadoPorNome: doc.atualizadoPorNome
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/faltas-funcionarios/resumo?ano=&mes=
 * Consolidado do mês por funcionário — visão de gestão.
 */
exports.resumo = async (req, res) => {
    try {
        if (!ehGestao(req.user.perfil)) {
            return res.status(403).json({ success: false, error: 'Apenas a gestão pode ver o consolidado.' });
        }

        const competencia = lerCompetencia(req.query);
        if (!competencia) {
            return res.status(400).json({ success: false, error: 'Informe ano e mês válidos.' });
        }
        const { ano, mes } = competencia;

        if (!mesDisponivel(ano, mes)) {
            return res.status(400).json({
                success: false,
                error: `A planilha de faltas começa em ${rotuloMes(VIGENCIA.ano, VIGENCIA.mes)}.`
            });
        }

        const funcionarios = await buscarFuncionarios(req.escolaId);
        const planilhas = await FaltaFuncionario.find({
            ano, mes,
            funcionarioId: { $in: funcionarios.map(f => f.id) },
            ...escolaMatch(req.escolaId)
        }).lean();

        const porFuncionario = new Map(planilhas.map(p => [String(p.funcionarioId), p]));

        const data = funcionarios.map(f => {
            const doc = porFuncionario.get(f.id);
            return {
                ...f,
                totais: calcularTotais(doc?.dias || []),
                atualizadoEm: doc?.updatedAt || null
            };
        });

        res.json({
            success: true,
            data,
            ano, mes,
            rotulo: rotuloMes(ano, mes)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Exportados para os testes cobrirem as regras puras sem passar pelo HTTP
exports._internals = { sanitizarDias, calcularTotais, montarDias, mesDisponivel, VIGENCIA };
