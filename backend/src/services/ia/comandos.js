'use strict';

/**
 * comandos.js — catálogo da paleta de comandos rápidos (`/`).
 *
 * POR QUE A LISTA VEM DO SERVIDOR
 * -------------------------------
 * A regra do produto é "a paleta só lista comandos permitidos ao cargo". Se a
 * lista morasse no JavaScript da página, ela seria um enfeite: qualquer um
 * abriria o DevTools e veria (ou dispararia) `/logs`. Montando no servidor, o
 * que o front recebe já é o que aquele cargo pode ver.
 *
 * Isso NÃO substitui a autorização real. Cada comando termina numa ferramenta
 * (que passa pelo ToolRegistry + PermissionGuard) ou numa página (que tem o
 * próprio `authorize` na rota). A paleta é conveniência, não controle.
 *
 * TIPOS
 *   prompt     → preenche a caixa com uma pergunta que aciona a ferramenta
 *   navegacao  → leva a pessoa ao módulo correspondente
 *   interface  → resolvido no próprio front (nova conversa, exportar, ajuda)
 */

const GESTAO = ['admin', 'diretor', 'secretaria'];
const TODOS = ['admin', 'diretor', 'secretaria', 'professor', 'responsavel'];

const COMANDOS = [
    {
        nome: 'ajuda',
        descricao: 'O que o assistente sabe fazer',
        tipo: 'interface',
        cargos: TODOS
    },
    {
        nome: 'nova',
        descricao: 'Começar uma conversa nova',
        tipo: 'interface',
        cargos: TODOS
    },
    {
        nome: 'exportar',
        descricao: 'Baixar esta conversa (PDF, TXT ou DOCX)',
        tipo: 'interface',
        cargos: TODOS
    },
    {
        nome: 'dashboard',
        descricao: 'Panorama geral da escola',
        tipo: 'prompt',
        prompt: 'Me dê um panorama geral da escola.',
        cargos: GESTAO
    },
    {
        nome: 'alunos',
        descricao: 'Quantos alunos e em quais turmas',
        tipo: 'prompt',
        prompt: 'Quantos alunos temos e como estão distribuídos por turma?',
        cargos: ['admin', 'diretor', 'secretaria', 'professor']
    },
    {
        nome: 'professores',
        descricao: 'Quadro docente da escola',
        tipo: 'prompt',
        prompt: 'Liste os professores da escola com suas disciplinas.',
        cargos: GESTAO
    },
    {
        nome: 'turmas',
        descricao: 'Turmas e número de alunos',
        tipo: 'prompt',
        prompt: 'Liste as turmas da escola com a quantidade de alunos.',
        cargos: ['admin', 'diretor', 'secretaria', 'professor']
    },
    {
        nome: 'eventos',
        descricao: 'Próximos eventos do calendário',
        tipo: 'prompt',
        prompt: 'Quais são os próximos eventos do calendário escolar?',
        cargos: TODOS
    },
    {
        nome: 'comunicados',
        descricao: 'Últimos avisos recebidos',
        tipo: 'prompt',
        prompt: 'Quais são os últimos comunicados?',
        cargos: TODOS
    },
    {
        nome: 'relatorios',
        descricao: 'Gerar um relatório em PDF',
        tipo: 'prompt',
        prompt: 'Gere um relatório de desempenho em PDF.',
        cargos: ['admin', 'diretor', 'secretaria']
    },
    {
        nome: 'logs',
        descricao: 'Abrir a trilha de auditoria',
        tipo: 'navegacao',
        destino: '/direcao/auditoria.html',
        // Auditoria é registro de quem fez o quê — só direção.
        cargos: ['admin', 'diretor']
    },
    {
        nome: 'configuracoes',
        descricao: 'Configurações do sistema',
        tipo: 'navegacao',
        destino: '/html/direcao/index.html',
        cargos: ['admin', 'diretor']
    }
];

/**
 * Comandos visíveis a um cargo.
 * @param {string} perfil
 * @returns {Array<Object>} sem o campo `cargos` — o cliente não precisa dele
 */
function comandosPara(perfil) {
    const p = String(perfil || '').toLowerCase();
    return COMANDOS
        .filter(c => p === 'admin' || c.cargos.includes(p))
        .map(({ cargos, ...resto }) => resto);
}

module.exports = { comandosPara, COMANDOS };
