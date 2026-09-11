/**
 * detalhes/autorizacoes-pais-dados.js
 *
 * Regras de exibição da tela "Autorizações dos Pais", separadas da tela para
 * poderem ser testadas (Issue #270).
 *
 * A REGRA QUE ESTE ARQUIVO GUARDA
 * -------------------------------
 * A tela só mostra o que o responsável de fato respondeu ou enviou. Resposta
 * ausente é "Sem resposta" — nunca "Aceita". Documento ausente é lista vazia —
 * nunca documento de exemplo. Dado de cadastro ausente é "—" — nunca um valor
 * padrão inventado. Consentimento de responsável sobre criança é dever de LGPD
 * (art. 14) e ECA: a escola decide excursão, antitérmico e atendimento médico
 * olhando para esta tela.
 *
 * As respostas vêm de `GET /api/secretaria/autorizacoes` (resumo por aluno) e
 * `GET /api/secretaria/autorizacoes/aluno/:id` (as sete autorizações), que
 * devolvem `aceita` como `true`, `false` ou `null`.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.AutorizacoesPaisDados = factory();
    }
})(typeof self !== 'undefined' ? self : this, () => {
    const AUSENTE = '—';

    /** Escapa texto para interpolar em HTML. Nome de aluno e responsável vêm do banco. */
    function esc(valor) {
        return String(valor ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Texto do banco ou "—". Nunca um valor de exemplo. */
    function ouAusente(valor) {
        const texto = typeof valor === 'string' ? valor.trim() : valor;
        return texto === undefined || texto === null || texto === '' ? AUSENTE : String(texto);
    }

    /** Data em pt-BR, ou "—" quando não há data válida. */
    function formatarData(valor) {
        if (!valor) return AUSENTE;
        const data = new Date(valor);
        return Number.isNaN(data.getTime()) ? AUSENTE : data.toLocaleDateString('pt-BR');
    }

    /**
     * Status de UMA autorização.
     * `true` → Aceita · `false` → Não aceita · qualquer outra coisa → Sem resposta.
     */
    function statusDaAutorizacao(aceita) {
        if (aceita === true) {
            return { status: 'aceita', rotulo: 'Aceita', tipo: 'success', icone: 'bi-check-circle-fill' };
        }
        if (aceita === false) {
            return { status: 'nao_aceita', rotulo: 'Não aceita', tipo: 'danger', icone: 'bi-x-circle-fill' };
        }
        return { status: 'sem_resposta', rotulo: 'Sem resposta', tipo: 'neutral', icone: 'bi-dash-circle' };
    }

    /** Observação real da autorização: dados de condução ou de medicamento, quando enviados. */
    function observacaoDaAutorizacao(item) {
        const d = item?.detalhes;
        if (!d || typeof d !== 'object') return AUSENTE;
        const partes = [];
        if (d.motoristaNome) partes.push(`Motorista: ${d.motoristaNome}`);
        if (d.motoristaTelefone) partes.push(`Tel.: ${d.motoristaTelefone}`);
        if (d.medicamentoNome) partes.push(`Medicamento: ${d.medicamentoNome}`);
        if (d.medicamentoDose) partes.push(`Dose: ${d.medicamentoDose}`);
        return partes.length ? partes.join(' · ') : AUSENTE;
    }

    /**
     * Linha da tabela "Autorizações enviadas pelo responsável".
     * A data só aparece quando houve resposta: pendente não tem data de resposta.
     */
    function linhaDaAutorizacao(item, nomeResponsavel) {
        const st = statusDaAutorizacao(item?.aceita);
        const respondeu = st.status !== 'sem_resposta';
        return {
            titulo: ouAusente(item?.titulo || item?.tipo),
            descricao: ouAusente(item?.descricao),
            status: st.status,
            statusLabel: st.rotulo,
            statusTipo: st.tipo,
            icone: st.icone,
            dataResposta: respondeu ? formatarData(item?.dataResposta) : AUSENTE,
            responsavel: respondeu ? ouAusente(nomeResponsavel) : AUSENTE,
            observacoes: respondeu ? observacaoDaAutorizacao(item) : AUSENTE,
        };
    }

    /**
     * Resumo de um aluno na lista, a partir das contagens reais do backend.
     * `grupo` casa com as opções do filtro de status da tela.
     */
    function resumoDoAluno({ aceitas = 0, naoAceitas = 0, pendentes = 0 } = {}) {
        if (naoAceitas > 0) {
            return {
                grupo: 'nao_aceita',
                texto: naoAceitas === 1 ? '1 não aceita' : `${naoAceitas} não aceitas`,
                tipo: 'danger',
                icone: 'bi-x-circle-fill',
            };
        }
        if (pendentes === 0 && aceitas > 0) {
            return { grupo: 'todas_aceitas', texto: 'Todas aceitas', tipo: 'success', icone: 'bi-check-circle-fill' };
        }
        if (aceitas === 0) {
            return { grupo: 'pendente', texto: 'Sem resposta', tipo: 'neutral', icone: 'bi-dash-circle' };
        }
        return {
            grupo: 'pendente',
            texto: pendentes === 1 ? '1 sem resposta' : `${pendentes} sem resposta`,
            tipo: 'warning',
            icone: 'bi-exclamation-circle-fill',
        };
    }

    /**
     * Documento como a tela exibe, a partir do registro real de DocumentoResponsavel.
     * Devolve `null` para registro sem arquivo: sem arquivo não há o que abrir.
     */
    function normalizarDocumento(doc) {
        if (!doc || !doc._id || !doc.arquivo) return null;
        const mime = String(doc.arquivo.mimeType || '');
        let ext = (mime.split('/')[1] || String(doc.arquivo.nomeOriginal || '').split('.').pop() || '').toUpperCase();
        if (ext === 'JPEG') ext = 'JPG';
        const id = encodeURIComponent(String(doc._id));
        return {
            id: String(doc._id),
            nome: ouAusente(doc.nomeDocumento || doc.tipoDocumento || doc.arquivo.nomeOriginal),
            tipo: ouAusente(doc.tipoDocumento),
            ext: ext || AUSENTE,
            extClass: ext === 'JPG' ? 'jpg' : ext === 'PNG' ? 'png' : 'pdf',
            status: ouAusente(doc.status),
            dataEnvio: formatarData(doc.dataEnvio),
            urlPreview: `/api/documentos-responsaveis/${id}/visualizar`,
            urlDownload: `/api/documentos-responsaveis/${id}/download`,
        };
    }

    function normalizarDocumentos(lista) {
        return (Array.isArray(lista) ? lista : []).map(normalizarDocumento).filter(Boolean);
    }

    return {
        AUSENTE,
        esc,
        ouAusente,
        formatarData,
        statusDaAutorizacao,
        observacaoDaAutorizacao,
        linhaDaAutorizacao,
        resumoDoAluno,
        normalizarDocumento,
        normalizarDocumentos,
    };
});
