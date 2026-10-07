/**
 * guiaDoSistema.js — onde fica cada coisa no sistema, por perfil (Issue #702).
 *
 * O copiloto também responde perguntas de USO ("onde lanço nota?", "como
 * publico um aviso?"). Sem um mapa, o modelo inventa nomes de menu que não
 * existem. Este guia diz, para cada perfil, os itens do menu lateral que a
 * pessoa realmente vê e o que há em cada um.
 *
 * `menu` é o rótulo EXATO do item no menu lateral. `guiaDoSistema.test.js`
 * confere cada rótulo contra o HTML do painel (`html/dashboard.html`, que mostra
 * e esconde itens por perfil) e contra as abas do portal do responsável:
 * renomear um menu sem atualizar este arquivo quebra o teste.
 */

const COMUNS = [
    { menu: 'Conversas', para: 'mensagens com a equipe da escola' },
    { menu: 'Notificações', para: 'central de notificações recebidas' },
];

const EQUIPE = [
    {
        menu: 'Turmas',
        para: 'escolher a turma e abrir a página dela, com os alunos, as notas e a chamada',
    },
    { menu: 'Avaliações', para: 'cadastrar avaliações e lançar as notas de cada uma' },
    { menu: 'Planilha de Faltas', para: 'controle mensal de faltas dos funcionários' },
    {
        menu: 'Assistente da Escola',
        para: 'página completa deste assistente, com o histórico das conversas',
    },
];

const TELAS_POR_PERFIL = {
    professor: [
        ...EQUIPE,
        {
            menu: 'Frequência',
            para: 'registrar os lançamentos de aulas dadas (turma, matéria e quantidade de aulas)',
        },
        { menu: 'Meu Horário', para: 'sua grade semanal de aulas' },
        ...COMUNS,
    ],
    diretor: [
        { menu: 'Alunos', para: 'lista de alunos e a ficha de cada um' },
        { menu: 'Professores', para: 'lista de professores da escola' },
        ...EQUIPE,
        { menu: 'Frequência', para: 'frequência das turmas, no próprio painel' },
        { menu: 'Relatórios', para: 'BI pedagógico, com os indicadores da escola' },
        { menu: 'Comunicados', para: 'publicar avisos no mural da escola' },
        { menu: 'Agenda', para: 'agenda da direção, no próprio painel' },
        { menu: 'Autorizações dos Pais', para: 'autorizações enviadas pelas famílias' },
        { menu: 'Gerenciar Salas', para: 'quais professores dão aula em cada sala' },
        { menu: 'Horários', para: 'horário geral da escola, com a grade de todas as turmas' },
        {
            menu: 'Códigos Secretos',
            para: 'códigos dos alunos que as famílias usam para vincular a conta',
        },
        { menu: 'Gerenciar Secretaria', para: 'contas da secretaria' },
        ...COMUNS,
    ],
    secretaria: [
        { menu: 'Painel Secretaria', para: 'painel da secretaria' },
        { menu: 'Alunos', para: 'lista de alunos e a ficha de cada um' },
        { menu: 'Matrículas', para: 'matrículas' },
        { menu: 'Documentos', para: 'declarações do aluno, como as de matrícula e de frequência' },
        { menu: 'Justificativas', para: 'justificativas de falta dos alunos' },
        { menu: 'Comunicados', para: 'publicar comunicados, com destinatários e prioridade' },
        { menu: 'Relatórios', para: 'relatórios por aluno ou por sala' },
        { menu: 'Autorizações dos Pais', para: 'autorizações enviadas pelas famílias' },
        ...EQUIPE,
        ...COMUNS,
    ],
    // Portal do responsável: as abas do painel de cada filho.
    responsavel: [
        { menu: 'Boletim', para: 'notas do filho por matéria e bimestre' },
        { menu: 'Frequência', para: 'faltas e presença do filho' },
        { menu: 'Comunicados', para: 'avisos da escola' },
    ],
};

/** O admin usa o painel com os itens da direção. */
function guiaPara(perfil) {
    const p = String(perfil || '').toLowerCase();
    return TELAS_POR_PERFIL[p === 'admin' ? 'diretor' : p] || [];
}

module.exports = { TELAS_POR_PERFIL, guiaPara };
