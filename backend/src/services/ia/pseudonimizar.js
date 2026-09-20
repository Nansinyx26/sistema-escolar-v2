/**
 * pseudonimizar.js — o que sai daqui para o provedor de IA (Issue #401).
 *
 * REGRA: nenhum dado que identifique a criança atravessa a fronteira do
 * servidor. O nome vira um rótulo ("Aluno A"), o identificador e a data de
 * nascimento não vão, e um conjunto de campos nunca sai — motivo de falta,
 * saúde, deficiência, transtornos e texto livre de observação, que é onde a
 * escola escreve o que ninguém autorizou a mandar para fora.
 *
 * O mapa rótulo ↔ dado real vive na MEMÓRIA do processo, por conversa, e serve
 * para duas coisas: traduzir de volta o que o modelo responde ("Aluno A tirou
 * 7" → "João tirou 7") e entender o rótulo quando o modelo pede uma ferramenta
 * ("consulte as notas de Aluno A").
 *
 * Nada do mapa é gravado: ele morre com a requisição (ou com a conversa em
 * memória), e nunca é enviado a lugar nenhum.
 */

/**
 * Campos que NUNCA saem, em qualquer nível do objeto. A lista é fechada por
 * nome de campo porque é assim que os dados chegam das ferramentas e do banco.
 */
const CAMPOS_BLOQUEADOS = new Set([
    'motivo',
    'motivoRecusa',
    'justificativa',
    'observacoes',
    'observacoesBimestre',
    'observacao',
    'descricao',
    'alergiasAlimentos',
    'alergiasRemedio',
    'planoSaude',
    'deficiencia',
    'transtornos',
    'pcd',
    'necessitaApoio',
    'condicao',
    'condicaoOutro',
    'religiao',
    'etnia',
    'nacionalidade',
    'cpf',
    'cpfAluno',
    'rg',
    'endereco',
    'telefone',
    'whatsapp',
    'email',
    'responsavel',
    'responsaveis',
    'responsavelDados',
    'guardaLegal',
    'pessoasAutorizadasRetirada',
    'autorizacoesEscolares',
    'documentos',
    'lgpdConsentimento',
    'codigoSecreto',
    'codigoInep',
    'nascimento',
    'dataNascimento',
    'foto',
]);

/** Campos cujo VALOR é o nome da criança. */
const CAMPOS_DE_NOME = new Set(['nome', 'nomeAluno', 'alunoNome', 'sobrenome', 'nomeCompleto']);

/** Campos cujo VALOR identifica a criança e vira o mesmo rótulo do nome. */
const CAMPOS_DE_ID = new Set(['id', '_id', 'alunoId', 'matricula', 'ra', 'matriculaId']);

const PREFIXO = 'Aluno';

/** Rótulos em sequência: Aluno A, Aluno B, … Aluno Z, Aluno AA. */
function rotuloDoIndice(i) {
    let n = i;
    let s = '';
    do {
        s = String.fromCharCode(65 + (n % 26)) + s;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return `${PREFIXO} ${s}`;
}

function escaparRegex(v) {
    return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mapa de uma conversa. Guarda, para cada rótulo, o nome e o identificador
 * reais — e só isso.
 */
function criarMapa() {
    const porChave = new Map(); // chave real (nome ou id) → rótulo
    const porRotulo = new Map(); // rótulo → { nome, id }

    function rotuloPara(chave, tipo) {
        const valor = String(chave ?? '').trim();
        if (!valor) return valor;
        const jaTem = porChave.get(valor.toLowerCase());
        if (jaTem) {
            const registro = porRotulo.get(jaTem);
            if (tipo === 'nome' && !registro.nome) registro.nome = valor;
            if (tipo === 'id' && !registro.id) registro.id = valor;
            return jaTem;
        }
        const rotulo = rotuloDoIndice(porRotulo.size);
        porChave.set(valor.toLowerCase(), rotulo);
        porRotulo.set(rotulo, {
            nome: tipo === 'nome' ? valor : null,
            id: tipo === 'id' ? valor : null,
        });
        return rotulo;
    }

    /** Liga nome e identificador do MESMO aluno ao mesmo rótulo. */
    function registrarAluno({ id, nome }) {
        const rotulo = id ? rotuloPara(id, 'id') : nome ? rotuloPara(nome, 'nome') : null;
        if (!rotulo) return null;
        const registro = porRotulo.get(rotulo);
        if (nome) {
            registro.nome = registro.nome || String(nome);
            porChave.set(String(nome).toLowerCase(), rotulo);
        }
        if (id) {
            registro.id = registro.id || String(id);
            porChave.set(String(id).toLowerCase(), rotulo);
        }
        return rotulo;
    }

    /** Identificador real por trás de um rótulo (para executar ferramenta). */
    function idDoRotulo(rotulo) {
        return porRotulo.get(String(rotulo).trim())?.id || null;
    }

    /**
     * Limpa e pseudonimiza qualquer estrutura antes do envio ao provedor.
     * Objeto que tenha nome e id juntos (o caso de um aluno) recebe um rótulo
     * só, e é por isso que o registro acontece antes de percorrer as chaves.
     */
    function mascarar(valor, profundidade = 0) {
        if (profundidade > 8) return null;
        if (Array.isArray(valor)) return valor.map((v) => mascarar(v, profundidade + 1));
        if (valor instanceof Date) return valor.toISOString().slice(0, 10);
        if (!valor || typeof valor !== 'object') return valor;

        const temNome = Object.keys(valor).some((k) => CAMPOS_DE_NOME.has(k));
        const temId = Object.keys(valor).some((k) => CAMPOS_DE_ID.has(k));
        let rotuloDoObjeto = null;
        if (temNome || temId) {
            rotuloDoObjeto = registrarAluno({
                id: valor.alunoId || valor._id || valor.id || valor.matricula,
                nome: valor.nome || valor.nomeAluno || valor.alunoNome,
            });
        }

        const saida = {};
        for (const [chave, v] of Object.entries(valor)) {
            if (CAMPOS_BLOQUEADOS.has(chave)) continue;
            if (CAMPOS_DE_NOME.has(chave)) {
                if (chave === 'sobrenome') continue;
                saida[chave] = rotuloDoObjeto || rotuloPara(v, 'nome');
                continue;
            }
            if (CAMPOS_DE_ID.has(chave)) {
                saida[chave] = rotuloDoObjeto || rotuloPara(v, 'id');
                continue;
            }
            saida[chave] = mascarar(v, profundidade + 1);
        }
        return saida;
    }

    /** Troca rótulos pelo nome real no texto que volta ao usuário. */
    function reidentificar(texto) {
        let saida = String(texto ?? '');
        for (const [rotulo, { nome }] of porRotulo.entries()) {
            if (!nome) continue;
            saida = saida.replace(new RegExp(escaparRegex(rotulo), 'g'), nome);
        }
        return saida;
    }

    /**
     * Versão de fluxo: o rótulo pode chegar partido entre dois pedaços do
     * stream ("Alu" + "no A"), então o fim do pedaço fica no buffer até a
     * próxima chamada. `finalizar()` devolve o que sobrou.
     */
    function criarTradutorDeFluxo() {
        let pendente = '';
        const MAX_ROTULO = 12; // "Aluno AA" com folga

        /**
         * Até onde dá para emitir sem partir um rótulo ao meio. Cortar por
         * tamanho fixo não basta: o pedaço pode terminar em "Alu", e aí a
         * primeira metade já teria ido para a tela sem tradução.
         */
        function pontoDeCorte(texto) {
            const inicio = texto.lastIndexOf(PREFIXO);
            if (inicio !== -1 && texto.length - inicio <= MAX_ROTULO) return inicio;
            for (let p = Math.min(PREFIXO.length, texto.length); p > 0; p--) {
                if (texto.endsWith(PREFIXO.slice(0, p))) return texto.length - p;
            }
            return texto.length;
        }

        return {
            traduzir(pedaco) {
                const texto = pendente + String(pedaco ?? '');
                const corte = pontoDeCorte(texto);
                const pronto = texto.slice(0, corte);
                pendente = texto.slice(corte);
                return reidentificar(pronto);
            },
            finalizar() {
                const resto = reidentificar(pendente);
                pendente = '';
                return resto;
            },
        };
    }

    return {
        registrarAluno,
        rotuloPara,
        idDoRotulo,
        mascarar,
        reidentificar,
        criarTradutorDeFluxo,
        get tamanho() {
            return porRotulo.size;
        },
    };
}

module.exports = {
    criarMapa,
    CAMPOS_BLOQUEADOS,
    CAMPOS_DE_NOME,
    CAMPOS_DE_ID,
};
