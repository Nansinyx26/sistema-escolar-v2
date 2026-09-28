/**
 * changelog.js — fonte única das "novidades" do sistema.
 *
 * COMO USAR: sempre que houver uma atualização (inclusive hotfix), adicione uma
 * nova entrada NO TOPO do array `releases`, com a `data` em que ela entrou em
 * produção. O SystemUpdateJob roda UMA vez por mês — dia 1, às 7h (horário de
 * Brasília) — e envia um único resumo com tudo o que mudou no mês anterior.
 * Mês sem mudança relevante para o usuário não gera e-mail nenhum.
 *
 * Campos de cada release:
 *   versao  — identificador da versão (ex.: '1.1.1').
 *   data    — 'AAAA-MM-DD' em que foi para produção. Decide em qual resumo
 *             mensal a release entra.
 *   itens   — lista de mudanças. Cada item:
 *       tipo    — 'novidade' | 'melhoria' | 'correcao'
 *       texto   — frase curta, do ponto de vista de quem USA o sistema
 *                 ("Agora você pode…", "O boletim passou a…"). Vira o título
 *                 do card no e-mail.
 *       detalhe — (opcional) uma ou duas frases explicando o que muda no dia
 *                 a dia. Aparece abaixo do título.
 *       icone   — (opcional) ícone do card: estrela, tendencia, chave, pdf,
 *                 robo, raio, celular, sino, grafico, calendario. Sem ele,
 *                 vale o padrão do tipo (estrela / tendencia / chave).
 *       interno — true quando a mudança não muda nada para o usuário
 *                 (refatoração, teste, infraestrutura, CI). Fica registrada
 *                 aqui, mas NÃO entra no e-mail.
 */

const releases = [
    {
        versao: '1.1.0',
        data: '2026-07-23',
        itens: [
            {
                tipo: 'novidade',
                icone: 'robo',
                texto: 'A IA/chatbot agora responde considerando apenas os dados da sua escola.',
                detalhe:
                    'O assistente virtual usa somente as informações da sua escola para responder, com mais segurança e precisão.',
            },
            {
                tipo: 'melhoria',
                icone: 'grafico',
                texto: 'Boletim, BI e notificações passam a respeitar o contexto de cada escola.',
                detalhe: 'Cada escola vê apenas os próprios dados nos relatórios e avisos.',
            },
            {
                tipo: 'correcao',
                texto: 'Corrigidos o dashboard do professor e a navegação entre as turmas.',
                detalhe:
                    'O painel volta a carregar normalmente e a troca de turma funciona como esperado.',
            },
        ],
    },
];

const TIPOS = ['novidade', 'melhoria', 'correcao'];

const MESES = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
];

/** 'AAAA-MM' do mês anterior a `janelaMes` ('AAAA-MM'). */
function mesAnterior(janelaMes) {
    const [ano, mes] = janelaMes.split('-').map(Number);
    return mes === 1 ? `${ano - 1}-12` : `${ano}-${String(mes - 1).padStart(2, '0')}`;
}

/** 'AAAA-MM' → 'setembro de 2026'. */
function nomeDoMes(mesRef) {
    const [ano, mes] = mesRef.split('-').map(Number);
    return `${MESES[mes - 1]} de ${ano}`;
}

/** Itens que importam para quem usa o sistema, de todas as releases do mês. */
function itensDoMes(mesRef, lista = releases) {
    const itens = [];
    for (const release of lista) {
        if (!String(release.data || '').startsWith(mesRef)) continue;
        for (const item of release.itens || []) {
            if (!item || item.interno || !item.texto) continue;
            itens.push({
                tipo: TIPOS.includes(item.tipo) ? item.tipo : 'melhoria',
                texto: item.texto,
                detalhe: item.detalhe || '',
                icone: item.icone || '',
            });
        }
    }
    // Novidades primeiro, depois melhorias, depois correções.
    return itens.sort((a, b) => TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo));
}

/**
 * Monta o resumo mensal de `mesRef` ('AAAA-MM'). Retorna null quando não há
 * nada relevante para o usuário — nesse caso não se envia nada.
 */
function montarResumoMensal(mesRef, lista = releases) {
    const itens = itensDoMes(mesRef, lista);
    if (itens.length === 0) return null;
    const mesNome = nomeDoMes(mesRef);
    const rotulo = { novidade: 'Novidade', melhoria: 'Melhoria', correcao: 'Correção' };
    return {
        mesRef,
        mesNome,
        itens,
        titulo: `Novidades do sistema — ${mesNome}`,
        mensagem: [
            `O que mudou no Sistema Escolar em ${mesNome}:`,
            '',
            ...itens.map((i) => `• ${rotulo[i.tipo]}: ${i.texto}`),
        ].join('\n'),
    };
}

module.exports = { releases, mesAnterior, nomeDoMes, itensDoMes, montarResumoMensal };
