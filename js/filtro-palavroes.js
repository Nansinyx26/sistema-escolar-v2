/**
 * js/filtro-palavroes.js — MÓDULO CANÔNICO do filtro de linguagem imprópria.
 *
 * Este arquivo é ISOMÓRFICO (UMD): roda no navegador (window.FiltroPalavroes) e
 * no Node (`require`). O backend NÃO tem uma cópia do léxico — ele reexporta
 * este mesmo arquivo em `backend/src/utils/filtroPalavroes.js`. Um único
 * dicionário evita o problema clássico de o front bloquear uma palavra que o
 * back aceita (ou o contrário).
 *
 * O QUE ELE RESOLVE
 * -----------------
 * Comparar o texto com uma lista de palavrões não funciona: o usuário troca
 * letra por número/símbolo, repete letras, ou separa os caracteres. Todas as
 * formas abaixo têm de cair no mesmo termo `caralho`:
 *
 *     caralho   c4ralho   c@r@lh0   cara1ho   caaaaralho
 *     c.a.r.a.l.h.o       c-a-r-a-l-h-o       c a r a l h o
 *     CARALHO   Cárálhõ   c a  r  a  l  h  o
 *
 * ESTRATÉGIA
 * ----------
 * Em vez de "normalizar o texto e comparar" (que destrói os índices e cria
 * falso-positivo com números legítimos — "10 alunos" viraria "lo alunos"),
 * cada termo do léxico é compilado UMA VEZ para uma regex tolerante:
 *
 *   1. cada letra vira uma CLASSE com seus equivalentes visuais/leet
 *      (a → [a4@áàâãäª], i → [i1!íìîï|y], s → [sz5$§], o → [o0óòôõö°]…);
 *   2. cada classe ganha `+`, cobrindo letra repetida (caaaralho, porrra);
 *   3. entre as letras é aceito um punhado de SEPARADORES (espaço, ponto,
 *      hífen, underline…), o que cobre `c.a.r.a.l.h.o` e `c a r a l h o`;
 *   4. o casamento exige fronteira de palavra dos dois lados, para que `cu`
 *      não dispare em "cuidado" nem `puta` em "disputa";
 *   5. uma segunda varredura ("aglutinada") junta sequências de letras
 *      isoladas — `c   a   r   a   l   h   o` com qualquer espaçamento.
 *
 * A classe de SEPARADORES é calculada por diferença: nenhum caractere usado
 * como equivalente de letra pode ser separador. Isso mantém as classes
 * disjuntas e elimina a ambiguidade que geraria backtracking exponencial
 * (ReDoS) nas regexes com `+` seguido de grupo opcional.
 *
 * NÍVEIS
 * ------
 * `grave` (vulgar/sexual/discriminatório) e `moderado` (xingamento) bloqueiam
 * o envio; `leve` apenas sinaliza. Configurável por `configurar()`.
 *
 * FALSOS POSITIVOS CONHECIDOS (decisão consciente — ver `adicionarExcecao`)
 * ------------------------------------------------------------------------
 * `veado` (o animal), `bicha` (fila, em pt-PT), `escroto` (termo anatômico) e
 * `cacete` (pão / porrete) existem em uso legítimo, mas o uso ofensivo é
 * dominante no contexto escolar. Uma escola que precise liberar algum deles
 * usa `FiltroPalavroes.adicionarExcecao('veado')`.
 */
(function (raiz, fabrica) {
    'use strict';
    if (typeof module === 'object' && module.exports) {
        module.exports = fabrica();
    } else {
        raiz.FiltroPalavroes = fabrica();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────
    // 1. EQUIVALÊNCIAS DE CARACTERE (leetspeak, acentos e homoglifos)
    //    Chave = letra canônica do léxico. Valor = tudo que o usuário pode
    //    digitar no lugar dela. Repare que `1` aparece em `i` E em `l`, e `s`
    //    em `z`: uma mesma tecla pode representar letras diferentes, e isso
    //    não causa ambiguidade porque cada posição da regex é independente.
    // ─────────────────────────────────────────────────────────────────────
    const EQUIVALENCIAS = {
        a: 'a4@áàâãäåª',
        b: 'b8ß',
        c: 'cç¢(',
        d: 'd',
        e: 'e3€éèêë',
        f: 'f',
        g: 'g9',
        h: 'h',
        i: 'i1!íìîï|',
        j: 'j',
        k: 'k',
        l: 'l1|£',
        m: 'm',
        n: 'nñ',
        o: 'o0óòôõö°',
        p: 'p',
        q: 'q',
        r: 'r',
        s: 'sz5$§',
        t: 't7+',
        u: 'uúùûü',
        v: 'v',
        w: 'w',
        x: 'x',
        y: 'yi',
        z: 'z2s'
    };

    /** Caracteres candidatos a "lixo entre as letras" — os que o usuário
     *  intercala para driblar o filtro. Os que já servem de equivalente de
     *  alguma letra (`!`, `|`, `(`, `+`, `$`…) são removidos logo abaixo. */
    const CANDIDATOS_SEPARADOR = ' \t\n\r.,;:!?…-–—_*~^\'"`\\/#%&=+[]{}<>()|$§°·•·¨´';

    const LETRAS_FRONTEIRA = 'a-zà-ÿ';

    /** Escapa os caracteres com significado especial DENTRO de `[...]`. */
    function escaparClasse(texto) {
        return texto.replace(/[\\\]^-]/g, '\\$&');
    }

    const CARACTERES_DE_LETRA = new Set(
        Object.keys(EQUIVALENCIAS).flatMap(letra => EQUIVALENCIAS[letra].split(''))
    );

    /** Separadores = candidatos MENOS tudo que já representa alguma letra.
     *  Classes disjuntas ⇒ regex sem ambiguidade ⇒ sem backtracking explosivo. */
    const SEPARADORES = Array.from(new Set(CANDIDATOS_SEPARADOR.split('')))
        .filter(ch => !CARACTERES_DE_LETRA.has(ch))
        .join('');

    const CLASSE_SEPARADOR = '[' + escaparClasse(SEPARADORES) + ']';

    /** Classe regex de uma letra do léxico (fallback: o próprio caractere). */
    function classeDaLetra(letra) {
        const equivalentes = EQUIVALENCIAS[letra] || letra;
        return '[' + escaparClasse(equivalentes) + ']';
    }

    /** `porra` → `pora`: com `r+` na regex, a letra dobrada é redundante — e
     *  duas classes idênticas em sequência é justamente o padrão que causaria
     *  backtracking quadrático. */
    function colapsarRepetidas(termo) {
        return termo.replace(/(.)\1+/g, '$1');
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. LÉXICO
    //    Os termos são escritos SEM acento e SEM cedilha: as classes já
    //    cobrem `otário`, `desgraçado`, `cuzão`. Flexões que mudam o radical
    //    (viadinho, putaria, cuzinho) entram como entradas próprias — sufixo
    //    automático além de `s`/`es` geraria falso-positivo (`cu` + `eiro` =
    //    "cueiro", que é palavra de verdade).
    // ─────────────────────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────
    // 2a. TERMOS QUE DEPENDEM DE CONTEXTO
    //
    // Estas palavras NÃO são palavrão sozinhas — e o uso legítimo delas é
    // justamente o escolar:
    //
    //     pica     "o mosquito pica", "pica o alho", pica-pau
    //     rola     "a bola rola", "rola uma conversa", rola (a ave)
    //     pau      "cadeira de pau", pau-brasil (história e biologia)
    //     pinto    filhote de galinha — e Pinto é sobrenome comuníssimo
    //     macaco   aula de fauna, visita ao zoológico, macaco do carro
    //     piranha  fauna amazônica, presilha de cabelo
    //     droga    "palestra sobre drogas", campanha de prevenção
    //
    // Bloquear na marra derrubaria o comunicado da campanha antidrogas e o
    // trabalho sobre primatas. Então elas só disparam quando vêm precedidas do
    // marcador que as transforma em xingamento: "seu macaco", "sua piranha",
    // "meu pau", "que droga". "O macaco do zoológico" continua passando.
    // ─────────────────────────────────────────────────────────────────────

    /** Marcadores de xingamento dirigido a alguém ("seu babaca"). */
    const VOCATIVO = ['seu', 'sua', 'seus', 'suas', 'bando de', 'uns', 'umas'];

    /** Possessivos que denunciam o sentido sexual ("meu pau", "sua pica"). */
    const POSSESSIVO = ['meu', 'minha', 'seu', 'sua', 'teu', 'tua', 'o meu', 'a minha', 'o seu', 'a sua', 'o teu', 'a tua'];

    /**
     * `pinto` não aceita "seu": em português "seu + sobrenome" é tratamento
     * respeitoso, e Pinto é um dos sobrenomes mais comuns do Brasil. "Seu
     * Pinto chegou na secretaria" não pode virar palavrão.
     */
    const POSSESSIVO_SEM_SEU = ['meu', 'teu', 'o meu', 'o teu'];

    const TERMOS_DE_CONTEXTO = [
        ['pau',      'grave', 'sexual',          { contexto: POSSESSIVO }],
        ['pica',     'grave', 'sexual',          { contexto: POSSESSIVO }],
        ['rola',     'grave', 'sexual',          { contexto: POSSESSIVO }],
        ['pinto',    'grave', 'sexual',          { contexto: POSSESSIVO_SEM_SEU }],
        ['macaco',   'grave', 'discriminatorio', { contexto: VOCATIVO }],
        ['macaca',   'grave', 'discriminatorio', { contexto: VOCATIVO }],
        ['piranha',  'grave', 'insulto',         { contexto: VOCATIVO }],
        ['galinha',  'moderado', 'insulto',      { contexto: VOCATIVO }],
        ['jegue',    'leve',  'insulto',         { contexto: VOCATIVO }],
        ['droga',    'leve',  'vulgar',          { contexto: ['que'] }]
    ];

    const LEXICO = [
        // ── Vulgar / sexual ────────────────────────────────────────────────
        ['caralho',        'grave',     'vulgar'],
        ['karalho',        'grave',     'vulgar'],
        ['kralho',         'grave',     'vulgar'],
        ['caraio',         'grave',     'vulgar'],
        ['krl',            'grave',     'vulgar',        { curto: true }],
        ['crl',            'grave',     'vulgar',        { curto: true }],
        ['porra',          'grave',     'vulgar'],
        ['buceta',         'grave',     'sexual'],
        ['boceta',         'grave',     'sexual'],
        ['bucetinha',      'grave',     'sexual'],
        ['xoxota',         'grave',     'sexual'],
        ['xereca',         'grave',     'sexual'],
        ['piroca',         'grave',     'sexual'],
        ['punheta',        'grave',     'sexual'],
        ['punheteiro',     'grave',     'sexual'],
        ['boquete',        'grave',     'sexual'],
        ['siririca',       'grave',     'sexual'],
        ['foder',          'grave',     'vulgar'],
        ['fode',           'grave',     'vulgar'],
        ['fodeu',          'grave',     'vulgar'],
        ['fodendo',        'grave',     'vulgar'],
        ['fodido',         'grave',     'vulgar'],
        ['fodida',         'grave',     'vulgar'],
        ['foda',           'grave',     'vulgar'],
        ['fodase',         'grave',     'vulgar'],
        ['fodasse',        'grave',     'vulgar'],
        ['fuder',          'grave',     'vulgar'],
        ['fudeu',          'grave',     'vulgar'],
        ['fudido',         'grave',     'vulgar'],
        ['puta',           'grave',     'vulgar'],
        ['putinha',        'grave',     'vulgar'],
        ['putaria',        'grave',     'vulgar'],
        ['putona',         'grave',     'vulgar'],
        ['cuzao',          'grave',     'vulgar'],
        ['cuzinho',        'grave',     'vulgar'],
        ['cusao',          'grave',     'vulgar'],
        ['arrombado',      'grave',     'insulto'],
        ['arrombada',      'grave',     'insulto'],

        // ── Expressões e abreviações ──────────────────────────────────────
        // Escritas sem espaço: os separadores da regex já cobrem a versão
        // espaçada ("vai tomar no cu", "filha da puta").
        ['filhadaputa',    'grave',     'insulto'],
        ['filhadeputa',    'grave',     'insulto'],
        ['filhodaputa',    'grave',     'insulto'],
        ['filhodeputa',    'grave',     'insulto'],
        ['putaqueopariu',  'grave',     'vulgar'],
        ['putaquepariu',   'grave',     'vulgar'],
        ['vaitomarnocu',   'grave',     'vulgar'],
        ['vaisefoder',     'grave',     'vulgar'],
        ['vaisefude',      'grave',     'vulgar'],
        ['fdp',            'grave',     'insulto',       { curto: true }],
        ['pqp',            'grave',     'vulgar',        { curto: true }],
        ['vtnc',           'grave',     'vulgar',        { curto: true }],
        ['vsf',            'grave',     'vulgar',        { curto: true }],

        // ── Discriminatório (LGBTfobia, racismo, capacitismo) ─────────────
        ['viado',          'grave',     'discriminatorio'],
        ['viadinho',       'grave',     'discriminatorio'],
        ['viadao',         'grave',     'discriminatorio'],
        ['viadagem',       'grave',     'discriminatorio'],
        ['veado',          'grave',     'discriminatorio'],
        ['veadinho',       'grave',     'discriminatorio'],
        ['boiola',         'grave',     'discriminatorio'],
        ['baitola',        'grave',     'discriminatorio'],
        ['traveco',        'grave',     'discriminatorio'],
        ['sapatao',        'grave',     'discriminatorio'],
        ['bicha',          'moderado',  'discriminatorio'],
        ['bichinha',       'grave',     'discriminatorio'],
        ['crioulo',        'grave',     'discriminatorio'],
        ['retardado',      'grave',     'discriminatorio'],
        ['retardada',      'grave',     'discriminatorio'],
        ['mongoloide',     'grave',     'discriminatorio'],
        ['debiloide',      'grave',     'discriminatorio'],
        ['aleijado',       'grave',     'discriminatorio'],

        // ── Xingamentos de intensidade média ──────────────────────────────
        ['merda',          'moderado',  'insulto'],
        ['merdinha',       'moderado',  'insulto'],
        ['bosta',          'moderado',  'insulto'],
        ['bostinha',       'moderado',  'insulto'],
        ['cu',             'moderado',  'vulgar',        { curto: true }],
        ['cacete',         'moderado',  'vulgar'],
        ['otario',         'moderado',  'insulto'],
        ['otaria',         'moderado',  'insulto'],
        ['babaca',         'moderado',  'insulto'],
        ['escroto',        'moderado',  'insulto'],
        ['escrota',        'moderado',  'insulto'],
        ['imbecil',        'moderado',  'insulto'],
        ['idiota',         'moderado',  'insulto'],
        ['cretino',        'moderado',  'insulto'],
        ['cretina',        'moderado',  'insulto'],
        ['panaca',         'moderado',  'insulto'],
        ['corno',          'moderado',  'insulto'],
        ['cornudo',        'moderado',  'insulto'],
        ['vagabundo',      'moderado',  'insulto'],
        ['vagabunda',      'moderado',  'insulto'],
        ['safado',         'moderado',  'insulto'],
        ['safada',         'moderado',  'insulto'],
        ['puto',           'moderado',  'vulgar'],
        ['desgracado',     'moderado',  'insulto'],
        ['desgracada',     'moderado',  'insulto'],
        ['estupido',       'moderado',  'insulto'],
        ['estupida',       'moderado',  'insulto'],

        // ── Inglês (comum entre estudantes) ───────────────────────────────
        ['fuck',           'grave',     'vulgar'],
        ['fucking',        'grave',     'vulgar'],
        ['fucker',         'grave',     'vulgar'],
        ['motherfucker',   'grave',     'vulgar'],
        ['fck',            'grave',     'vulgar',        { curto: true }],
        ['fuk',            'grave',     'vulgar',        { curto: true }],
        ['cunt',           'grave',     'sexual'],
        ['pussy',          'grave',     'sexual'],
        ['bitch',          'grave',     'insulto'],
        ['whore',          'grave',     'insulto'],
        ['slut',           'grave',     'insulto'],
        ['asshole',        'grave',     'insulto'],
        ['dickhead',       'grave',     'insulto'],
        ['nigger',         'grave',     'discriminatorio'],
        ['nigga',          'grave',     'discriminatorio'],
        ['faggot',         'grave',     'discriminatorio'],
        ['retard',         'grave',     'discriminatorio'],
        ['shit',           'moderado',  'vulgar'],
        ['bullshit',       'moderado',  'vulgar'],
        ['bastard',        'moderado',  'insulto'],
        ['dumbass',        'moderado',  'insulto'],
        ['wtf',            'moderado',  'vulgar',        { curto: true }],
        ['stfu',           'moderado',  'vulgar',        { curto: true }],

        // ── Leve: sinaliza, mas NÃO bloqueia por padrão ───────────────────
        ['burro',          'leve',      'insulto'],
        ['burra',          'leve',      'insulto'],
        ['jumento',        'leve',      'insulto'],
        ['palhaco',        'leve',      'insulto'],
        ['peido',          'leve',      'vulgar'],
        ['porcaria',       'leve',      'insulto'],
        ['nojento',        'leve',      'insulto'],
        ['nojenta',        'leve',      'insulto'],
        ['damn',           'leve',      'vulgar'],
        ['crap',           'leve',      'vulgar'],

        // ── Só ofendem COM MARCADOR na frente (ver TERMOS_DE_CONTEXTO) ─────
        ...TERMOS_DE_CONTEXTO
    ];

    /** Sufixos aceitos por padrão. Deliberadamente curto: qualquer coisa além
     *  de plural cria falso-positivo (ver comentário do léxico). */
    const SUFIXOS_PADRAO = ['s', 'es'];

    const NIVEIS_ORDEM = { leve: 1, moderado: 2, grave: 3 };

    const ROTULO_NIVEL = {
        leve: 'linguagem inadequada',
        moderado: 'xingamento',
        grave: 'linguagem ofensiva grave'
    };

    // ─────────────────────────────────────────────────────────────────────
    // 3. COMPILAÇÃO DAS REGEXES
    // ─────────────────────────────────────────────────────────────────────

    /** Termos com menos de 4 letras aceitam no máximo 1 separador entre as
     *  letras. `cu` com 3 separadores casaria em "vitamina C. Uva"; com 1,
     *  só na forma "c u", que já é tentativa deliberada de driblar. */
    const SEPARADORES_MAX = 3;
    const SEPARADORES_MAX_CURTO = 1;

    /** Tamanho mínimo para a varredura aglutinada. Termos curtos aglutinados
     *  colidem com texto legítimo. */
    const MINIMO_AGLUTINADO = 4;

    function corpoDoTermo(termo, maxSeparadores) {
        const letras = colapsarRepetidas(termo)
            .split('')
            .map(letra => classeDaLetra(letra) + '+');
        const cola = maxSeparadores > 0
            ? CLASSE_SEPARADOR + '{0,' + maxSeparadores + '}'
            : '';
        return letras.join(cola);
    }

    /**
     * Prefixo obrigatório dos termos contextuais: o marcador que transforma a
     * palavra em xingamento, mais pelo menos um separador ("seu macaco").
     * Os marcadores passam pelas mesmas classes de caractere do termo, então
     * "s3u m4c4c0" também cai. O espaço dentro de marcador de duas palavras
     * ("bando de") vira grupo de separadores.
     */
    function prefixoDeContexto(marcadores) {
        const alternativas = marcadores.map(marcador => marcador
            .split('')
            .map(ch => (ch === ' '
                ? CLASSE_SEPARADOR + '{1,2}'
                : classeDaLetra(ch) + '+'))
            .join(''))
            .sort((a, b) => b.length - a.length); // mais específico primeiro
        return '(?:' + alternativas.join('|') + ')' + CLASSE_SEPARADOR + '{1,3}';
    }

    function grupoDeSufixos(sufixos) {
        if (!sufixos || sufixos.length === 0) return '';
        const alternativas = sufixos
            .slice()
            .sort((a, b) => b.length - a.length) // maior primeiro: "es" antes de "s"
            .map(sufixo => sufixo.split('').map(classeDaLetra).join(''));
        return '(?:' + alternativas.join('|') + ')?';
    }

    /**
     * Fronteira sem lookbehind: `(^|[^letras])` é capturado no grupo 1 e
     * descontado do índice. Lookbehind quebraria em Safari antigo, que ainda
     * aparece nos tablets das escolas.
     */
    function compilar(termo, opcoes) {
        const curto = !!(opcoes && opcoes.curto) || termo.length < 4;
        const maxSeparadores = curto ? SEPARADORES_MAX_CURTO : SEPARADORES_MAX;
        const sufixos = (opcoes && opcoes.sufixos) || SUFIXOS_PADRAO;
        const contexto = opcoes && Array.isArray(opcoes.contexto) && opcoes.contexto.length > 0
            ? prefixoDeContexto(opcoes.contexto)
            : '';

        const padraoFlexivel = '(^|[^' + LETRAS_FRONTEIRA + '])('
            + contexto
            + corpoDoTermo(termo, maxSeparadores)
            + grupoDeSufixos(sufixos)
            + ')(?![' + LETRAS_FRONTEIRA + '])';

        const padraoColado = '(^|[^' + LETRAS_FRONTEIRA + '])('
            + contexto
            + corpoDoTermo(termo, 0)
            + grupoDeSufixos(sufixos)
            + ')(?![' + LETRAS_FRONTEIRA + '])';

        return {
            flexivel: new RegExp(padraoFlexivel, 'gi'),
            colado: new RegExp(padraoColado, 'gi')
        };
    }

    function montarEntrada(definicao) {
        const [termo, nivel, categoria, opcoes] = definicao;
        const regexes = compilar(termo, opcoes);
        return {
            termo,
            nivel,
            categoria,
            // A varredura aglutinada cola letras isoladas ("m a c a c o"), o
            // que apaga justamente o marcador que dá sentido ao termo
            // contextual. Deixá-la agir aqui traria de volta o falso-positivo
            // que o contexto existe para evitar.
            aceitaAglutinado: !(opcoes && Array.isArray(opcoes.contexto) && opcoes.contexto.length > 0),
            regexFlexivel: regexes.flexivel,
            regexColada: regexes.colado
        };
    }

    let entradas = LEXICO.map(montarEntrada);

    // ─────────────────────────────────────────────────────────────────────
    // 4. CONFIGURAÇÃO
    // ─────────────────────────────────────────────────────────────────────
    const configuracao = {
        /** Níveis que impedem o envio. `leve` fica de fora: sinaliza só. */
        bloquearNiveis: ['grave', 'moderado'],
        /** Teto de caracteres analisados — protege contra texto gigante. */
        limiteCaracteres: 20000
    };

    /** Palavras liberadas explicitamente (comparação sobre o trecho casado,
     *  já sem separadores e em minúsculas). */
    const excecoes = new Set();

    /**
     * @param {Object} opcoes
     * @param {string[]} [opcoes.bloquearNiveis] níveis que bloqueiam o envio
     * @param {Array}    [opcoes.termosExtras]   `['termo']` ou `['termo','nivel','categoria']`
     * @param {string[]} [opcoes.excecoes]       palavras a liberar
     */
    function configurar(opcoes) {
        if (!opcoes) return obterConfiguracao();
        if (Array.isArray(opcoes.bloquearNiveis)) {
            configuracao.bloquearNiveis = opcoes.bloquearNiveis.slice();
        }
        if (typeof opcoes.limiteCaracteres === 'number' && opcoes.limiteCaracteres > 0) {
            configuracao.limiteCaracteres = opcoes.limiteCaracteres;
        }
        if (Array.isArray(opcoes.termosExtras)) {
            opcoes.termosExtras.forEach(adicionarTermo);
        }
        if (Array.isArray(opcoes.excecoes)) {
            opcoes.excecoes.forEach(adicionarExcecao);
        }
        return obterConfiguracao();
    }

    function obterConfiguracao() {
        return {
            bloquearNiveis: configuracao.bloquearNiveis.slice(),
            limiteCaracteres: configuracao.limiteCaracteres,
            totalTermos: entradas.length,
            excecoes: Array.from(excecoes)
        };
    }

    /** Acrescenta um termo em tempo de execução (lista da escola, por ex.). */
    function adicionarTermo(definicao) {
        const bruto = Array.isArray(definicao) ? definicao : [definicao];
        const termo = String(bruto[0] || '').trim().toLowerCase();
        if (!termo) return false;
        if (entradas.some(e => e.termo === termo)) return false;
        entradas = entradas.concat(
            montarEntrada([termo, bruto[1] || 'moderado', bruto[2] || 'personalizado', bruto[3]])
        );
        return true;
    }

    function adicionarExcecao(palavra) {
        const normalizada = String(palavra || '').trim().toLowerCase();
        if (normalizada) excecoes.add(normalizada);
        return excecoes.size;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 5. ANÁLISE
    // ─────────────────────────────────────────────────────────────────────

    const REGEX_SEPARADOR_GLOBAL = new RegExp(CLASSE_SEPARADOR, 'g');

    function semSeparadores(trecho) {
        return trecho.replace(REGEX_SEPARADOR_GLOBAL, '').toLowerCase();
    }

    /**
     * Varredura 2 — letras isoladas.
     *
     * Cobre `c   a   r   a   l   h   o`, em que o espaçamento passa do teto de
     * separadores da regex flexível. Só aglutina blocos de caracteres ÚNICOS
     * (3 ou mais em sequência): colar tokens maiores criaria falso-positivo
     * grosseiro — "por razão" viraria "porrazao", que contém "porra".
     */
    function blocosAglutinados(texto) {
        const tokens = [];
        const regexToken = new RegExp('[^' + escaparClasse(SEPARADORES) + ']+', 'g');
        let achado;
        while ((achado = regexToken.exec(texto)) !== null) {
            tokens.push({ valor: achado[0], inicio: achado.index });
        }

        const blocos = [];
        let atual = null;
        const fechar = () => {
            if (atual && atual.tokens >= 3) {
                blocos.push({
                    texto: atual.texto,
                    inicio: atual.inicio,
                    fim: atual.fim
                });
            }
            atual = null;
        };

        tokens.forEach(token => {
            if (token.valor.length === 1) {
                if (!atual) {
                    atual = { texto: '', inicio: token.inicio, fim: token.inicio, tokens: 0 };
                }
                atual.texto += token.valor;
                atual.fim = token.inicio + 1;
                atual.tokens += 1;
            } else {
                fechar();
            }
        });
        fechar();

        return blocos;
    }

    function registrar(ocorrencias, vistos, dados) {
        const chave = dados.inicio + ':' + dados.fim + ':' + dados.termo;
        if (vistos.has(chave)) return;
        vistos.add(chave);
        ocorrencias.push(dados);
    }

    /**
     * Analisa um texto.
     *
     * @param {string} texto
     * @returns {{limpo: boolean, bloquear: boolean, nivel: (string|null),
     *            termos: string[], ocorrencias: Array, mensagem: (string|null),
     *            censurado: string}}
     */
    function analisar(texto) {
        const resultadoLimpo = {
            limpo: true,
            bloquear: false,
            nivel: null,
            termos: [],
            ocorrencias: [],
            mensagem: null,
            censurado: typeof texto === 'string' ? texto : ''
        };

        if (typeof texto !== 'string' || texto.trim() === '') return resultadoLimpo;

        const alvo = texto.length > configuracao.limiteCaracteres
            ? texto.slice(0, configuracao.limiteCaracteres)
            : texto;

        const ocorrencias = [];
        const vistos = new Set();

        // Varredura 1 — regex tolerante sobre o texto original.
        entradas.forEach(entrada => {
            entrada.regexFlexivel.lastIndex = 0;
            let achado;
            while ((achado = entrada.regexFlexivel.exec(alvo)) !== null) {
                const prefixo = achado[1] || '';
                const trecho = achado[2];
                const inicio = achado.index + prefixo.length;

                // `lastIndex` precisa avançar mesmo em casamento vazio —
                // impossível aqui (todo termo tem ≥1 letra), mas barato.
                if (achado[0].length === 0) entrada.regexFlexivel.lastIndex += 1;

                if (excecoes.has(semSeparadores(trecho))) continue;

                registrar(ocorrencias, vistos, {
                    termo: entrada.termo,
                    nivel: entrada.nivel,
                    categoria: entrada.categoria,
                    trecho,
                    inicio,
                    fim: inicio + trecho.length
                });
            }
        });

        // Varredura 2 — blocos de letras isoladas ("c a r a l h o").
        const blocos = blocosAglutinados(alvo);
        if (blocos.length > 0) {
            entradas.forEach(entrada => {
                if (!entrada.aceitaAglutinado) return;
                if (entrada.termo.length < MINIMO_AGLUTINADO) return;
                blocos.forEach(bloco => {
                    entrada.regexColada.lastIndex = 0;
                    if (!entrada.regexColada.test(bloco.texto)) return;
                    const trecho = alvo.slice(bloco.inicio, bloco.fim);
                    if (excecoes.has(semSeparadores(trecho))) return;
                    registrar(ocorrencias, vistos, {
                        termo: entrada.termo,
                        nivel: entrada.nivel,
                        categoria: entrada.categoria,
                        trecho,
                        inicio: bloco.inicio,
                        fim: bloco.fim
                    });
                });
            });
        }

        if (ocorrencias.length === 0) return resultadoLimpo;

        ocorrencias.sort((a, b) => a.inicio - b.inicio);

        const nivel = ocorrencias.reduce((maior, o) => (
            NIVEIS_ORDEM[o.nivel] > NIVEIS_ORDEM[maior] ? o.nivel : maior
        ), 'leve');

        const bloquear = ocorrencias.some(o => configuracao.bloquearNiveis.includes(o.nivel));
        const termos = Array.from(new Set(ocorrencias.map(o => o.termo)));

        return {
            limpo: false,
            bloquear,
            nivel,
            termos,
            ocorrencias,
            mensagem: montarMensagem(termos, nivel, bloquear),
            censurado: censurarOcorrencias(texto, ocorrencias)
        };
    }

    /** Atalho booleano: o texto tem palavrão de nível bloqueável? */
    function contemPalavrao(texto) {
        return analisar(texto).bloquear;
    }

    function censurarOcorrencias(texto, ocorrencias) {
        let saida = texto;
        // De trás para frente: substituir do fim preserva os índices seguintes.
        ocorrencias
            .slice()
            .sort((a, b) => b.inicio - a.inicio)
            .forEach(o => {
                saida = saida.slice(0, o.inicio)
                    + '*'.repeat(Math.max(1, o.fim - o.inicio))
                    + saida.slice(o.fim);
            });
        return saida;
    }

    /** Substitui os palavrões por asteriscos, preservando o resto do texto. */
    function censurar(texto) {
        const resultado = analisar(texto);
        return resultado.limpo ? (typeof texto === 'string' ? texto : '') : resultado.censurado;
    }

    function montarMensagem(termos, nivel, bloquear) {
        const plural = termos.length > 1;
        const rotulo = ROTULO_NIVEL[nivel] || 'linguagem inadequada';
        if (!bloquear) {
            return 'Atenção: sua mensagem contém ' + rotulo + '. Reveja antes de enviar.';
        }
        return plural
            ? 'Sua mensagem contém palavras impróprias (' + rotulo + ') e não pode ser enviada. Reescreva sem elas.'
            : 'Sua mensagem contém uma palavra imprópria (' + rotulo + ') e não pode ser enviada. Reescreva sem ela.';
    }

    /**
     * Analisa vários campos de uma vez (ex.: título + corpo de um comunicado).
     *
     * @param {Object} objeto
     * @param {string[]} campos
     * @returns {{limpo: boolean, bloquear: boolean, porCampo: Object, termos: string[], nivel: (string|null), mensagem: (string|null)}}
     */
    function analisarCampos(objeto, campos) {
        const porCampo = {};
        let bloquear = false;
        let limpo = true;
        let nivel = null;
        let mensagem = null;
        const termos = [];

        (campos || []).forEach(campo => {
            const valor = objeto ? objeto[campo] : null;
            if (typeof valor !== 'string' || valor.trim() === '') return;
            const resultado = analisar(valor);
            if (resultado.limpo) return;

            limpo = false;
            porCampo[campo] = resultado;
            resultado.termos.forEach(t => { if (!termos.includes(t)) termos.push(t); });
            if (!nivel || NIVEIS_ORDEM[resultado.nivel] > NIVEIS_ORDEM[nivel]) {
                nivel = resultado.nivel;
            }
            if (resultado.bloquear) {
                bloquear = true;
                mensagem = mensagem || resultado.mensagem;
            }
        });

        if (!mensagem && !limpo) {
            mensagem = montarMensagem(termos, nivel, false);
        }

        return { limpo, bloquear, porCampo, termos, nivel, mensagem };
    }

    return {
        analisar,
        analisarCampos,
        contemPalavrao,
        censurar,
        configurar,
        obterConfiguracao,
        adicionarTermo,
        adicionarExcecao,
        NIVEIS: Object.keys(NIVEIS_ORDEM),
        // Expostos para teste/diagnóstico — não fazem parte da API de uso.
        _internos: { SEPARADORES, EQUIVALENCIAS, LEXICO }
    };
}));
