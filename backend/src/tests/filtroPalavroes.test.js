/**
 * Filtro de linguagem imprópria — rede de segurança contra regressão.
 *
 * Dois riscos opostos são testados aqui, e os dois quebram o produto:
 *
 *   1. FURO   — o palavrão disfarçado (número no lugar de letra, letra
 *               repetida, caractere no meio) passa e é publicado no mural
 *               ou entregue na conversa.
 *   2. EXCESSO — o filtro barra uma mensagem legítima da escola. Isso é pior
 *               na prática: a professora não consegue avisar sobre a reunião
 *               e ninguém entende o porquê.
 *
 * Por isso a suíte de frases legítimas é tão grande quanto a de palavrões.
 */

const filtro = require('../utils/filtroPalavroes');
const bloquearPalavroes = require('../middleware/bloquearPalavroes');

/** Express falso: captura status e corpo da resposta. */
function criarResposta() {
    const resposta = { statusCode: null, corpo: null };
    resposta.status = (codigo) => { resposta.statusCode = codigo; return resposta; };
    resposta.json = (corpo) => { resposta.corpo = corpo; return resposta; };
    return resposta;
}

describe('filtroPalavroes — detecção direta', () => {
    it('pega o palavrão escrito normalmente', () => {
        expect(filtro.contemPalavrao('seu caralho')).toBe(true);
        expect(filtro.contemPalavrao('que merda de aula')).toBe(true);
        expect(filtro.contemPalavrao('você é um idiota')).toBe(true);
    });

    it('ignora maiúsculas e acentos', () => {
        expect(filtro.contemPalavrao('CARALHO')).toBe(true);
        expect(filtro.contemPalavrao('Otário')).toBe(true);
        expect(filtro.contemPalavrao('desgraçado')).toBe(true);
        expect(filtro.contemPalavrao('cárálhõ')).toBe(true);
    });
});

describe('filtroPalavroes — número e símbolo no lugar da letra (leetspeak)', () => {
    // Este é o cenário que motivou o filtro: trocar caractere para driblar.
    const disfarces = [
        'c4ralho', 'c@r@lh0', 'cara1ho', 'c4r4lh0',
        'p0rra', 'p0rr4', 'm3rda', 'm3rd@',
        'b0sta', 'b0st4', '0tario', 'v14d0',
        'pu74', 'put4', 'f0der', 'sh1t', 'fu(k'
    ];

    disfarces.forEach(texto => {
        it(`bloqueia "${texto}"`, () => {
            expect(filtro.contemPalavrao(texto)).toBe(true);
        });
    });
});

describe('filtroPalavroes — letra repetida e caractere intercalado', () => {
    const disfarces = [
        'caaaaralho', 'carrralho', 'poooorra',
        'c.a.r.a.l.h.o', 'c-a-r-a-l-h-o', 'c_a_r_a_l_h_o',
        'c a r a l h o', 'c   a   r   a   l   h   o',
        'm.e.r.d.a', 'p u t a', 'b*o*s*t*a',
        'c4 r4 lh0'
    ];

    disfarces.forEach(texto => {
        it(`bloqueia "${texto}"`, () => {
            expect(filtro.contemPalavrao(texto)).toBe(true);
        });
    });
});

describe('filtroPalavroes — expressões e abreviações', () => {
    it('pega a expressão mesmo escrita com espaços', () => {
        expect(filtro.contemPalavrao('vai tomar no cu')).toBe(true);
        expect(filtro.contemPalavrao('filho da puta')).toBe(true);
        expect(filtro.contemPalavrao('vai se foder')).toBe(true);
    });

    it('pega as abreviações usadas para escapar do filtro', () => {
        ['fdp', 'pqp', 'vtnc', 'vsf', 'krl', 'wtf'].forEach(abreviacao => {
            expect(filtro.contemPalavrao(abreviacao)).toBe(true);
        });
    });
});

describe('filtroPalavroes — termos que dependem de contexto', () => {
    // `macaco`, `piranha`, `pau`, `pinto`, `pica`, `rola` e `droga` só ofendem
    // com o marcador na frente. Bloquear na marra derrubaria o trabalho de
    // biologia e o comunicado da campanha antidrogas.

    const ofensivos = [
        'seu macaco', 'seus macacos', 'bando de macacos',
        'sua piranha', 'sua galinha', 'seu jegue',
        'chupa meu pau', 'meu pinto', 'sua pica', 'minha rola',
        's3u m4c4c0', 'seu   macaco', 'seu.macaco'
    ];

    ofensivos.forEach(texto => {
        it(`detecta o uso ofensivo: "${texto}"`, () => {
            expect(filtro.analisar(texto).limpo).toBe(false);
        });
    });

    const legitimos = [
        'O macaco do zoológico é do tipo bugio.',
        'Trabalho sobre macacos-prego da Amazônia.',
        'Usei o macaco para trocar o pneu do ônibus.',
        'A piranha é um peixe da bacia amazônica.',
        'Prendi o cabelo com a piranha.',
        'Palestra sobre drogas e prevenção ao uso.',
        'A droga foi receitada pelo médico.',
        'Campanha de combate às drogas na escola.',
        'A cadeira do refeitório é de pau maciço.',
        'Estudo do pau-brasil na aula de história.',
        'O pica-pau faz ninho no tronco da árvore.',
        'O mosquito pica e transmite a dengue.',
        'A bola rola pelo campo até a trave.',
        'Rola uma conversa sobre o projeto de leitura.',
        'O pinto nasceu na chocadeira da fazenda-escola.',
        'A galinha choca os ovos em 21 dias.'
    ];

    legitimos.forEach(texto => {
        it(`aceita o uso legítimo: "${texto.slice(0, 40)}…"`, () => {
            expect(filtro.analisar(texto).ocorrencias).toEqual([]);
        });
    });

    it('"Seu Pinto" é tratamento respeitoso, não xingamento', () => {
        // Pinto é um dos sobrenomes mais comuns do Brasil. Por isso `pinto`
        // aceita "meu"/"teu" como marcador, mas nunca "seu".
        expect(filtro.analisar('Seu Pinto chegou na secretaria agora.').limpo).toBe(true);
        expect(filtro.analisar('Seu João trouxe o documento do aluno.').limpo).toBe(true);
    });

    it('"que droga" é nível leve — sinaliza, não bloqueia', () => {
        const resultado = filtro.analisar('que droga de sistema');
        expect(resultado.limpo).toBe(false);
        expect(resultado.bloquear).toBe(false);
    });
});

describe('filtroPalavroes — mensagens legítimas da escola NÃO podem ser barradas', () => {
    const legitimas = [
        'Bom dia! A reunião de pais será quinta-feira às 19h.',
        'O aluno assumiu a responsabilidade pela disputa do campeonato.',
        'Tenha cuidado com a escada molhada, por favor.',
        'Precisamos discutir o custo do material escolar.',
        'A prova foi adiada por razão de força maior.',
        'A reputação da escola é excelente na comunidade.',
        'Concha acústica, corneta e computador estão na lista.',
        'Turma 3C, unidade 2, sala 105 — 25 alunos.',
        'Cuiabá e Curitiba sediam a olimpíada de matemática.',
        'Aula de culinária: cuscuz, cuca e pão de queijo.',
        'O cueiro do bebê ficou na mochila da creche.',
        'Análise de 10 alunos, sala 5, turma 3B.',
        'Nota 8,5 em matemática. Parabéns pelo esforço!',
        'Segue o link: https://escola.com.br/portal?id=123&v=2',
        'Contato: secretaria@escola.com.br — (11) 90000-0000',
        'Estudo do meio sobre a fauna: onça, tamanduá e arara.',
        'Puxa vida, que bom que deu tudo certo!',
        'O veículo escolar chegou por volta das 14h.',
        'Assunto: assembleia de pais e mestres.',
        'A conta de luz da escola veio alta neste mês.'
    ];

    legitimas.forEach(texto => {
        it(`aceita: "${texto.slice(0, 45)}…"`, () => {
            const resultado = filtro.analisar(texto);
            expect(resultado.ocorrencias).toEqual([]);
            expect(resultado.limpo).toBe(true);
        });
    });
});

describe('filtroPalavroes — níveis', () => {
    it('nível leve sinaliza mas não impede o envio', () => {
        const resultado = filtro.analisar('Não seja burro nesse exercício.');
        expect(resultado.limpo).toBe(false);
        expect(resultado.nivel).toBe('leve');
        expect(resultado.bloquear).toBe(false);
    });

    it('nível grave impede o envio', () => {
        const resultado = filtro.analisar('seu c4ralho');
        expect(resultado.nivel).toBe('grave');
        expect(resultado.bloquear).toBe(true);
    });
});

describe('filtroPalavroes — saída', () => {
    it('censura só o palavrão e preserva o resto da frase', () => {
        expect(filtro.censurar('que merda de dia')).toBe('que ***** de dia');
    });

    it('devolve o texto intacto quando não há nada a censurar', () => {
        expect(filtro.censurar('Reunião confirmada!')).toBe('Reunião confirmada!');
    });

    it('aponta o trecho exato encontrado, para o front destacar', () => {
        const resultado = filtro.analisar('isso é uma m3rda enorme');
        expect(resultado.ocorrencias).toHaveLength(1);
        expect(resultado.ocorrencias[0].termo).toBe('merda');
        expect(resultado.ocorrencias[0].trecho).toBe('m3rda');
    });

    it('não quebra com entrada que não é texto', () => {
        [null, undefined, 42, {}, [], ''].forEach(valor => {
            expect(filtro.analisar(valor).limpo).toBe(true);
        });
    });

    it('analisa vários campos de uma vez', () => {
        const resultado = filtro.analisarCampos(
            { titulo: 'Aviso de reunião', conteudo: 'que p0rra é essa' },
            ['titulo', 'conteudo']
        );
        expect(resultado.bloquear).toBe(true);
        expect(resultado.porCampo.conteudo).toBeDefined();
        expect(resultado.porCampo.titulo).toBeUndefined();
    });
});

describe('filtroPalavroes — desempenho', () => {
    it('não trava com texto longo e adversarial (proteção contra ReDoS)', () => {
        // Repetições e símbolos são justamente o que faria uma regex ingênua
        // com classes ambíguas entrar em backtracking exponencial.
        const texto = ('t'.repeat(300) + '+'.repeat(300) + ' ').repeat(40)
            + 'texto comum da escola '.repeat(400);
        const inicio = Date.now();
        filtro.analisar(texto);
        expect(Date.now() - inicio).toBeLessThan(2000);
    });
});

describe('bloquearPalavroes — middleware', () => {
    it('deixa passar comentário limpo', () => {
        const req = { body: { texto: 'Parabéns pelo trabalho, professora!' } };
        const res = criarResposta();
        const proximo = jest.fn();

        bloquearPalavroes('texto')(req, res, proximo);

        expect(proximo).toHaveBeenCalled();
        expect(res.statusCode).toBeNull();
    });

    it('responde 400 com código próprio quando há palavrão', () => {
        const req = { body: { texto: 'que p0rr4 é essa' }, user: { id: 'u1' } };
        const res = criarResposta();
        const proximo = jest.fn();

        bloquearPalavroes('texto', { recurso: 'comentario' })(req, res, proximo);

        expect(proximo).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.corpo.success).toBe(false);
        expect(res.corpo.codigo).toBe('CONTEUDO_IMPROPRIO');
        expect(res.corpo.error).toEqual(expect.any(String));
        expect(res.corpo.detalhes.campo).toBe('texto');
        expect(res.corpo.detalhes.termos).toContain('porra');
    });

    it('inspeciona todos os campos declarados', () => {
        const req = { body: { titulo: 'Aviso', conteudo: 'seu idiota' }, user: { id: 'u1' } };
        const res = criarResposta();
        const proximo = jest.fn();

        bloquearPalavroes(['titulo', 'conteudo'])(req, res, proximo);

        expect(res.statusCode).toBe(400);
        expect(res.corpo.detalhes.campo).toBe('conteudo');
    });

    it('ignora campo ausente — comentário só de áudio continua válido', () => {
        const req = { body: { audioUrl: 'gridfs:123' } };
        const res = criarResposta();
        const proximo = jest.fn();

        bloquearPalavroes('texto')(req, res, proximo);

        expect(proximo).toHaveBeenCalled();
    });

    it('ignora requisição sem corpo', () => {
        const req = {};
        const res = criarResposta();
        const proximo = jest.fn();

        bloquearPalavroes('texto')(req, res, proximo);

        expect(proximo).toHaveBeenCalled();
    });

    it('nível leve não bloqueia o envio pela rota', () => {
        const req = { body: { texto: 'que porcaria de tempo hoje' } };
        const res = criarResposta();
        const proximo = jest.fn();

        bloquearPalavroes('texto')(req, res, proximo);

        expect(proximo).toHaveBeenCalled();
    });
});
