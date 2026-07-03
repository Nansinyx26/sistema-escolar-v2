/**
 * AiKnowledgeService: Centraliza a base de conhecimento e lógica de resposta da IA.
 * Unifica o comportamento entre Frontend e Backend.
 */
class AiKnowledgeService {
    
    static getKnowledgeBase() {
        return {
            direcao: [
                {
                    keywords: ['desempenho', 'notas', 'geral', 'médias', 'escola'],
                    response: "O desempenho geral da escola está em nível estável. Notamos uma evolução positiva nas disciplinas de exatas este bimestre."
                },
                {
                    keywords: ['frequência', 'presença', 'faltas', 'evasão'],
                    response: "A frequência global exige monitoramento. Temos algumas turmas com índice abaixo da meta de 90%. Verifique o painel BI para o detalhamento por turma."
                },
                {
                    keywords: ['alerta', 'crítico', 'atenção', 'risco'],
                    response: "Identifiquei turmas com alerta pedagógico por baixo rendimento ou baixa frequência. Recomendo uma análise no menu 'Insights AI'."
                }
            ],
            professor: [
                {
                    keywords: ['lançar', 'notas', 'registro', 'avaliação'],
                    response: "Para lançar notas, utilize o 'Diário de Classe'. Selecione a turma e clique no botão de lançamento da avaliação correspondente."
                },
                {
                    keywords: ['chamada', 'presença', 'diário'],
                    response: "A chamada pode ser feita via App ou Portal. Selecione a sala e marque as ausências. O sistema calcula a frequência automaticamente."
                },
                {
                    keywords: ['horário', 'agenda', 'aula'],
                    response: "Seu horário atual está disponível no módulo 'Meus Horários'. Lá você encontrará as salas e disciplinas alocadas para cada dia."
                }
            ],
            responsavel: [
                {
                    keywords: ['nota', 'boletim', 'rendimento', 'filho', 'filha'],
                    response: "O boletim do seu filho está disponível em 'Desempenho' no portal. Notas parciais são atualizadas semanalmente."
                },
                {
                    keywords: ['falta', 'presença', 'frequência'],
                    response: "A frequência é atualizada em tempo real. Você receberá alertas via Mural caso haja um padrão de ausências preocupante."
                },
                {
                    keywords: ['comunicado', 'aviso', 'mural', 'escola'],
                    response: "Consulte o 'Mural' para informações sobre reuniões, calendários de provas e avisos gerais da direção."
                }
            ],
            common: [
                {
                    keywords: ['ajuda', 'suporte', 'como funciona', 'opções'],
                    response: "Posso ajudar com informações sobre notas, frequência, horários e comunicados. O que você gostaria de consultar hoje?"
                },
                {
                    keywords: ['obrigado', 'vlw', 'entendi'],
                    response: "De nada! Se precisar de mais alguma coisa, conte comigo."
                },
                {
                    keywords: ['oi', 'olá', 'bom dia', 'boa tarde', 'boa noite'],
                    response: "Olá! Sou o Assistente IA. Como posso ser útil?"
                }
            ]
        };
    }

    static getResponse(message, role = 'common') {
        const msg = message.toLowerCase();
        const kb = this.getKnowledgeBase();
        
        // 1. Procura no papel específico
        const specific = kb[role] || [];
        for (const item of specific) {
            if (item.keywords.some(kw => msg.includes(kw))) return item.response;
        }

        // 2. Procura no comum
        for (const item of kb.common) {
            if (item.keywords.some(kw => msg.includes(kw))) return item.response;
        }

        return "Desculpe, não entendi sua dúvida. Poderia reformular? Posso ajudar com informações sobre desempenho, frequência e horários.";
    }
}

module.exports = AiKnowledgeService;
