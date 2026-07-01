'use strict';

/**
 * offlineResponseService.js
 *
 * Gera respostas offline COERENTES com o sistema quando o Gemini está
 * indisponível (sem GOOGLE_TTS_API_KEY, falha de rede ou quota excedida).
 *
 * Princípios:
 * - Usa a mesma persona/tom definida em assistantPersona.js.
 * - Sorteia entre 3 a 5 variações de template por tipo, para não repetir
 *   sempre a mesma frase.
 * - Só usa os dados REAIS já calculados pelo backend (nome, turma, média,
 *   frequência, predição, tema/matéria). NUNCA inventa valores.
 */

const { ASSISTANT_NAME } = require('./assistantPersona');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sorteia um item de um array (uniforme).
 * @param {Array<T>} arr
 * @returns {T}
 * @template T
 */
function pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Substitui placeholders {chave} pelo valor real do contexto.
 * Se um valor não existir no contexto, o placeholder é trocado por um
 * texto neutro de "informação não disponível" — nunca por um valor inventado.
 *
 * @param {string} template
 * @param {Object} ctx
 * @returns {string}
 */
function render(template, ctx) {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
        const val = ctx[key];
        if (val === null || val === undefined || val === '') {
            return 'informação não disponível';
        }
        return String(val);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bancos de templates por tipo (3 a 5 variações cada)
// Placeholders só referenciam dados que o backend efetivamente calcula.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATES = {
    // ── Chatbot ────────────────────────────────────────────────────────────
    chatbot_saudacao: [
        'Olá! 😊 Sou o assistente da escola. Posso ajudar com notas, faltas, horários, professores e comunicados. O que deseja saber?',
        'Oi! Que bom te ver por aqui. Posso consultar notas, faltas, horários, professores e comunicados. Como posso ajudar?',
        'Olá! Estou à disposição para ajudar com notas, faltas, horários, professores e comunicados. Por onde começamos?',
        'Oi, tudo bem? 😊 Sou o assistente da escola e posso te ajudar com notas, faltas, horários, professores e comunicados.',
    ],
    chatbot_indefinida: [
        'Não encontrei uma resposta exata para isso, mas posso ajudar com informações relacionadas. Tente reformular ou escolha um dos temas abaixo:',
        'Ainda não consegui entender bem sua pergunta, mas posso ajudar com os temas da escola. Que tal um destes?',
        'Não tenho uma resposta direta para isso agora, porém posso ajudar com notas, faltas, horários, professores e comunicados. Escolha abaixo:',
        'Hmm, não peguei exatamente o que você precisa. Posso ajudar com informações da escola — dá uma olhada nas opções abaixo:',
    ],

    // ── IA Assistant / BI Insights ───────────────────────────────────────────
    plano_aula: [
        'Preparei uma base para o plano de aula de {materia} ({ano}) sobre "{tema}". Comece pelos objetivos, siga com a metodologia, os recursos e a avaliação. Quando quiser, gero uma versão mais detalhada.',
        'Aqui vai um ponto de partida para a aula de {materia} ({ano}) com o tema "{tema}": defina os objetivos, escolha a metodologia, liste os recursos e planeje a avaliação. É só pedir para eu aprofundar.',
        'Montei um esqueleto para o plano de {materia} ({ano}) — tema "{tema}". Estruture em objetivos, metodologia, recursos e avaliação. Posso enriquecer assim que possível.',
        'Segue uma estrutura inicial para "{tema}" em {materia} ({ano}): objetivos claros, metodologia ativa, recursos de apoio e uma avaliação alinhada ao conteúdo.',
    ],
    plano_estudo: [
        'Preparei um plano de estudos inicial para {aluno} ({turma}). A predição de desempenho atual é {predicao}. Foque em revisão dirigida e acompanhamento próximo. Posso detalhar quando quiser.',
        'Aqui está uma base do plano de estudos de {aluno} ({turma}). Considerando a predição de {predicao}, organize metas semanais e reforço nas maiores dificuldades.',
        'Montei um ponto de partida para o plano de {aluno} ({turma}). Predição de nota: {predicao}. Recomendo rotina de estudos guiada e checkpoints regulares.',
        'Segue um plano de estudos para {aluno} ({turma}). Com a predição de {predicao}, priorize os conteúdos com menor domínio e revisões espaçadas.',
    ],
    analise_turma: [
        'Analisei a turma {turma}: média geral {media} e frequência {frequencia}. No geral, mantenha o acompanhamento e reforce os pontos mais frágeis.',
        'Aqui vai um resumo da turma {turma} — média {media} e frequência {frequencia}. Vale focar em quem está abaixo da média e monitorar a assiduidade.',
        'Sobre a turma {turma}: a média está em {media} e a frequência em {frequencia}. Recomendo atenção aos alunos com maior defasagem.',
        'Panorama da turma {turma}: média geral {media}, frequência {frequencia}. Um reforço direcionado pode ajudar a elevar o rendimento.',
    ],
    insight_global: [
        'Resumo da escola: {totalAlunos} alunos ativos, média geral {mediaEscola}. Continue acompanhando as turmas com maior necessidade de reforço.',
        'Panorama atual: {totalAlunos} alunos ativos e média geral {mediaEscola}. Vale priorizar as disciplinas e turmas mais críticas.',
        'Visão geral da escola: {totalAlunos} alunos e média {mediaEscola}. Recomendo foco em reforço onde a média está mais baixa.',
        'Situação global: {totalAlunos} alunos ativos, média geral {mediaEscola}. Mantenha o monitoramento das turmas em alerta.',
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constrói uma resposta offline coerente com o sistema.
 *
 * @param {Object} params
 * @param {string} [params.persona]  Prefixo/nome de persona (informativo; o tom
 *                                    já está embutido nos templates). Aceito para
 *                                    compatibilidade com a assinatura do prompt.
 * @param {string} params.tipo       Tipo de resposta (chave de TEMPLATES).
 * @param {Object} [params.contexto] Dados REAIS já calculados pelo backend.
 * @returns {string} Texto offline pronto para o front.
 */
function buildOfflineResponse({ tipo, contexto = {} } = {}) {
    const banco = TEMPLATES[tipo];
    if (!banco) {
        // Tipo desconhecido → resposta neutra na voz do assistente, sem inventar dados.
        return `No momento não consegui gerar essa resposta, mas ${ASSISTANT_NAME} continua à disposição para ajudar.`;
    }
    return render(pick(banco), contexto);
}

/**
 * Lista os tipos suportados (útil para testes).
 * @returns {string[]}
 */
function listTipos() {
    return Object.keys(TEMPLATES);
}

module.exports = {
    buildOfflineResponse,
    listTipos,
    // Exportado para testes de variação
    TEMPLATES,
};
