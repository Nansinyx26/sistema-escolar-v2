/**
 * validacaoConsentimento.test.js — provar que foi o responsável que consentiu.
 *
 * A PERGUNTA QUE ESTES TESTES RESPONDEM
 * -------------------------------------
 * O art. 14, §1º da LGPD exige consentimento específico e em destaque de um dos
 * pais para tratar dado de criança. O sistema já registrava termo, versão, data
 * e IP; o que não conseguia responder é a pergunta que a ANPD faz quando há
 * reclamação: *como você sabe que foi o responsável legal, e não outra pessoa
 * no aparelho dele?*
 *
 * O que está sob teste aqui são as bordas do código de confirmação — expirado,
 * travado por tentativas, nunca solicitado — porque são elas que decidem se um
 * consentimento inválido entra no histórico como se fosse válido. Uma vez
 * gravado, esse registro é a prova que a escola vai apresentar.
 */
const {
    METODOS,
    MAX_TENTATIVAS,
    VALIDADE_MS,
    gerarCodigo,
    situacaoDoCodigo,
    registroDeConsentimento,
    emailDoCodigo,
} = require('../services/conformidade/validacaoConsentimento');

const agora = new Date('2026-09-03T12:00:00Z');
const daquiA = (ms) => new Date(agora.getTime() + ms);

describe('quando um código pode ser conferido', () => {
    it('vale enquanto estiver dentro do prazo', () => {
        expect(situacaoDoCodigo({ expiraEm: daquiA(60_000), tentativas: 0 }, agora)).toEqual({
            valido: true,
        });
    });

    it('não vale se nunca foi solicitado', () => {
        // Sem esta guarda, confirmar sem pedir código passaria pela conferência
        // com um hash vazio e o comportamento dependeria da função de hash.
        const { valido, motivo } = situacaoDoCodigo(undefined, agora);
        expect(valido).toBe(false);
        expect(motivo).toMatch(/nenhum código/i);
    });

    it('não vale depois de expirar', () => {
        const { valido, motivo } = situacaoDoCodigo({ expiraEm: daquiA(-1000) }, agora);
        expect(valido).toBe(false);
        expect(motivo).toMatch(/expirado/i);
    });

    it('trava depois do limite de tentativas', () => {
        // São 10^6 códigos possíveis: sem limite, a força bruta é questão de
        // minutos e o "segundo fator" vira enfeite.
        const pendente = { expiraEm: daquiA(60_000), tentativas: MAX_TENTATIVAS };
        expect(situacaoDoCodigo(pendente, agora).valido).toBe(false);
        expect(
            situacaoDoCodigo({ ...pendente, tentativas: MAX_TENTATIVAS - 1 }, agora).valido
        ).toBe(true);
    });

    it('a validade é a mesma do código de 2FA por e-mail: 5 minutos', () => {
        expect(VALIDADE_MS).toBe(5 * 60 * 1000);
    });
});

describe('o código gerado', () => {
    it('tem 6 dígitos, sempre — inclusive quando o sorteio dá um número pequeno', () => {
        for (let i = 0; i < 200; i += 1) {
            expect(gerarCodigo()).toMatch(/^\d{6}$/);
        }
    });
});

describe('o registro que vai para o histórico', () => {
    const req = {
        ip: '203.0.113.10, 10.0.0.1',
        headers: { 'user-agent': 'Mozilla/5.0', 'sec-ch-ua-platform': 'Android' },
    };

    it('guarda COMO o consentimento foi validado', () => {
        const registro = registroDeConsentimento({
            termoId: 'politica_privacidade',
            versao: '2.0',
            metodoValidacao: METODOS.EMAIL,
            req,
            aceitoEm: agora,
        });
        expect(registro).toMatchObject({
            termoId: 'politica_privacidade',
            versao: '2.0',
            metodoValidacao: 'EMAIL_VERIFICADO',
            aceitoEm: agora,
            browser: 'Mozilla/5.0',
            os: 'Android',
        });
    });

    it('guarda só o primeiro IP da cadeia de proxies', () => {
        // `x-forwarded-for` chega com a cadeia inteira; gravar a string toda
        // deixa o registro ilegível e mistura IP de infraestrutura com o da
        // pessoa, que é o que interessa na prova.
        expect(registroDeConsentimento({ req }).ip).toBe('203.0.113.10');
    });

    it('sem método informado, assume a validação mais fraca — nunca a mais forte', () => {
        // Assumir 'EMAIL_VERIFICADO' por omissão faria o histórico afirmar uma
        // prova que não existiu.
        expect(registroDeConsentimento({ req }).metodoValidacao).toBe(METODOS.SESSAO);
    });

    it('não quebra quando não há requisição (registro por script ou migração)', () => {
        const registro = registroDeConsentimento({ termoId: 'x', versao: '1' });
        expect(registro.ip).toBe('desconhecido');
        expect(registro.aceitoEm).toBeInstanceOf(Date);
    });
});

describe('e-mail do código', () => {
    it('mostra o código e diz o que fazer se a pessoa não pediu', () => {
        const { assunto, html } = emailDoCodigo('012345', 'Marta');
        expect(assunto).toMatch(/consentimento/i);
        expect(html).toContain('012345');
        expect(html).toContain('Marta');
        expect(html).toMatch(/não pediu/i);
    });
});
