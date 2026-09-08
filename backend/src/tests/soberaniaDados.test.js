/**
 * soberaniaDados.test.js — onde os dados desta rede estão hospedados.
 *
 * O QUE ESTE TESTE PROTEGE
 * ------------------------
 * A Portaria SGD/MGI 5.950/2023 e os editais municipais pedem que dado da
 * administração pública fique em infraestrutura com requisitos de soberania.
 * Nenhuma linha de código muda onde o cluster está — o que o código pode fazer
 * é impedir que a resposta numa auditoria seja "acho que sim".
 *
 * O caso que mais importa aqui é o CONFLITO: alguém declara Brasil e a conexão
 * aponta para a Virgínia. É o único cenário em que o sistema tem informação
 * melhor que a declaração, e calar seria pior do que não checar nada — a rede
 * assinaria um termo de conformidade sobre uma afirmação falsa.
 */
const { avaliarSoberania } = require('../utils/soberaniaDados');

const URI_BR = 'mongodb+srv://usuario:senha@cluster0.sa-east-1.mongodb.net/escola';
const URI_EUA = 'mongodb+srv://usuario:senha@cluster0.us-east-1.mongodb.net/escola';

describe('declaração ausente', () => {
    it('não é conforme, e a mensagem diz o que fazer', () => {
        const resultado = avaliarSoberania({ mongoUri: URI_BR });
        expect(resultado.situacao).toBe('nao_declarada');
        expect(resultado.conforme).toBe(false);
        expect(resultado.mensagem).toContain('DATA_REGION');
    });

    it('pista brasileira na URI NÃO dispensa a declaração', () => {
        // Ausência de pista não é prova de nada, e presença também não é
        // documento: o que a auditoria pede é a informação por escrito.
        expect(avaliarSoberania({ mongoUri: URI_BR }).conforme).toBe(false);
    });
});

describe('declaração brasileira', () => {
    it('aceita país BR', () => {
        const resultado = avaliarSoberania({ pais: 'BR', mongoUri: URI_BR });
        expect(resultado).toMatchObject({ situacao: 'declarada_br', conforme: true });
    });

    it('aceita a região do provedor sem o país', () => {
        expect(avaliarSoberania({ regiao: 'sa-east-1' }).conforme).toBe(true);
        expect(avaliarSoberania({ regiao: 'southamerica-east1' }).conforme).toBe(true);
    });
});

describe('conflito entre o que foi declarado e a infraestrutura', () => {
    it('declarar BR com cluster nos EUA não passa', () => {
        const resultado = avaliarSoberania({ pais: 'BR', mongoUri: URI_EUA });
        expect(resultado.situacao).toBe('conflito');
        expect(resultado.conforme).toBe(false);
        expect(resultado.mensagem).toContain('us-east');
    });

    it('região declarada fora do Brasil é sinalizada como tal', () => {
        const resultado = avaliarSoberania({ regiao: 'eu-west-1' });
        expect(resultado.situacao).toBe('declarada_estrangeira');
        expect(resultado.conforme).toBe(false);
    });
});

describe('a URI nunca vaza credencial no diagnóstico', () => {
    it('nem a senha nem o usuário aparecem no resultado', () => {
        // O diagnóstico vai para log e para uma rota HTTP. Uma URI de Mongo
        // carrega usuário e senha; deixar qualquer pedaço dela escapar aqui
        // seria trocar um problema de conformidade por um vazamento.
        const resultado = avaliarSoberania({ pais: 'BR', mongoUri: URI_EUA });
        const serializado = JSON.stringify(resultado);
        expect(serializado).not.toContain('senha');
        expect(serializado).not.toContain('usuario');
    });
});
