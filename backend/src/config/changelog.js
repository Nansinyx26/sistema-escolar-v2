'use strict';

/**
 * changelog.js — fonte única das "novidades" do sistema.
 *
 * COMO USAR: sempre que houver uma atualização no sistema, adicione uma nova
 * entrada NO TOPO do array `releases`. O SystemUpdateJob roda todos os dias às
 * 16h (horário de Brasília) e, se a versão do topo ainda não tiver sido
 * anunciada, envia uma notificação automática para todos os usuários de todas
 * as escolas. Cada versão é anunciada UMA única vez — rodar de novo no dia
 * seguinte não reenvia.
 *
 * Campos de cada release:
 *   versao  — identificador único da versão (ex.: '1.1.0'). Muda a cada update.
 *   data    — data de referência da atualização (apenas informativa).
 *   titulo  — título curto exibido na notificação.
 *   itens   — lista de mudanças (uma linha por novidade).
 */

const releases = [
    {
        versao: '1.1.0',
        data: '2026-07-23',
        titulo: 'Sistema por escola e IA escopada',
        itens: [
            'IA/chatbot agora responde considerando apenas os dados da sua escola.',
            'Boletim, BI e notificações passam a respeitar o contexto de cada escola.',
            'Correções no dashboard do professor e na navegação das turmas.',
        ],
    },
];

/** Release mais recente (topo do array). */
function releaseAtual() {
    return releases[0] || null;
}

/** Monta o texto da notificação a partir de uma release. */
function montarNotificacao(release) {
    if (!release) return null;
    const lista = (release.itens || []).map((i) => `• ${i}`).join('\n');
    return {
        versao: release.versao,
        titulo: `Atualização do sistema — v${release.versao}`,
        mensagem: `${release.titulo}\n\n${lista}`.trim(),
    };
}

module.exports = { releases, releaseAtual, montarNotificacao };
