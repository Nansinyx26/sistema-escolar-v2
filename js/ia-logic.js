/**
 * ia-logic.js
 * Motor de Inteligência Local para o Assistente Escolar.
 * Contém respostas hardcoded para Diretores, Professores e Responsáveis.
 */

const IaEngine = (function() {
    'use strict';

    // Base de conhecimento categorizada
    const knowledgeBase = {
        direcao: [
            {
                keywords: ['desempenho', 'notas', 'geral', 'médias', 'escola'],
                response: "O desempenho geral da escola está em 7.8 este bimestre. Notamos uma melhora de 1.2% em relação ao período anterior, especialmente em Matemática e Ciências."
            },
            {
                keywords: ['frequência', 'presença', 'faltas', 'evasão'],
                response: "A frequência global está em 88.5%. Temos 3 turmas que exigem atenção imediata devido ao aumento de faltas na última semana. Recomendo verificar o relatório de 'Turmas em Alerta'."
            },
            {
                keywords: ['alerta', 'crítico', 'atenção'],
                response: "No momento, as turmas 9º Ano A, 2º Ano B do Ensino Médio e 7º Ano C estão sinalizadas em alerta pedagógico por baixo rendimento ou baixa frequência."
            }
        ],
        professor: [
            {
                keywords: ['lançar', 'notas', 'registro', 'avaliação'],
                response: "Para lançar as notas, acesse o menu 'Diário de Classe', selecione a turma e a disciplina, e clique no ícone de 'Lançar Notas' ao lado da atividade desejada."
            },
            {
                keywords: ['chamada', 'presença', 'diário'],
                response: "A chamada deve ser realizada diariamente pelo aplicativo ou pelo portal web. Basta selecionar a aula atual e marcar os alunos ausentes. Não esqueça de salvar ao final!"
            },
            {
                keywords: ['planejamento', 'aula', 'conteúdo'],
                response: "Seu planejamento de aula pode ser enviado pelo módulo 'Plano de Ensino'. Lá você pode anexar arquivos e definir os objetivos pedagógicos para o bimestre."
            }
        ],
        responsavel: [
            {
                keywords: ['nota', 'boletim', 'rendimento', 'filho', 'filha'],
                response: "Você pode ver o boletim completo clicando em 'Desempenho' no seu portal. As notas são atualizadas assim que os professores finalizam o lançamento."
            },
            {
                keywords: ['falta', 'presença', 'freqüência'],
                response: "A frequência do seu filho é atualizada em tempo real. Você receberá uma notificação caso ele não compareça a alguma aula programada."
            },
            {
                keywords: ['comunicado', 'aviso', 'mural', 'escola'],
                response: "Fique atento ao 'Mural de Avisos' no portal. Lá postamos todas as informações sobre reuniões, feriados e eventos escolares."
            }
        ],
        common: [
            {
                keywords: ['ajuda', 'suporte', 'como funciona', 'opções'],
                response: "Eu posso ajudar com informações sobre o sistema. Você pode me perguntar sobre notas, frequência, localização de ferramentas ou comunicados importantes. O que você gostaria de saber?"
            },
            {
                keywords: ['obrigado', 'vlw', 'entendi'],
                response: "De nada! Estou aqui para ajudar. Se tiver mais alguma dúvida, é só perguntar!"
            },
            {
                keywords: ['oi', 'olá', 'bom dia', 'boa tarde', 'boa noite'],
                response: "Olá! Sou o Assistente IA da sua escola. Como posso ajudar você hoje?"
            }
        ]
    };

    // Respostas padrão para quando não há correspondência
    const defaultResponses = [
        "Desculpe, não entendi sua pergunta. Você poderia reformular?",
        "Ainda estou aprendendo sobre esse assunto. Você gostaria de perguntar sobre notas, frequência ou funcionamento do portal?",
        "Pode me dar mais detalhes? Assim consigo te ajudar melhor.",
        "Não encontrei informações específicas sobre isso. Tente palavras-chave como 'notas', 'chamada' ou 'comunicados'."
    ];

    /**
     * Tenta encontrar uma resposta baseada no texto do usuário e papel
     */
    function getResponse(text, role = 'direcao') {
        const input = text.toLowerCase();
        
        // 1. Procurar na base específica do papel
        const roleData = knowledgeBase[role] || [];
        for (const item of roleData) {
            if (item.keywords.some(kw => input.includes(kw))) {
                return item.response;
            }
        }

        // 2. Procurar na base comum
        for (const item of knowledgeBase.common) {
            if (item.keywords.some(kw => input.includes(kw))) {
                return item.response;
            }
        }

        // 3. Resposta aleatória se não encontrar nada
        return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
    }

    return {
        getResponse
    };

})();

// Exportar para uso no navegador
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IaEngine;
} else {
    window.IaEngine = IaEngine;
}
