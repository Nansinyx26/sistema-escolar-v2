/**
 * soberaniaDados.js — onde os dados desta escola estão fisicamente.
 *
 * POR QUE UM ARQUIVO DE CÓDIGO PARA UMA QUESTÃO DE CONTRATO
 * --------------------------------------------------------
 * A Portaria SGD/MGI nº 5.950/2023 e os editais de licitação municipais pedem
 * que dado da administração pública fique em infraestrutura que atenda a
 * requisitos de soberania — na prática, região no Brasil. Isso é escolha de
 * hospedagem, não de código: nenhuma linha aqui muda onde o cluster está.
 *
 * O que o código pode fazer, e é o que este arquivo faz, é impedir que a
 * resposta seja "acho que sim". Numa auditoria a pergunta vem com data e a
 * resposta precisa ser verificável. Sem um registro explícito, ela depende de
 * alguém lembrar em qual região criou o cluster há dois anos.
 *
 * COMO SE DECLARA
 * ---------------
 *     DATA_REGION=br-se1            # região do provedor (ex.: São Paulo)
 *     DATA_REGION_PAIS=BR           # país, em ISO 3166-1 alfa-2
 *
 * O boot registra o resultado. Sem declaração, o log sai em nível de alerta:
 * não é falha de execução — o sistema sobe e funciona —, é uma pendência de
 * conformidade que precisa ficar visível em vez de silenciosa.
 *
 * A HEURÍSTICA DA URI É PISTA, NÃO PROVA
 * --------------------------------------
 * O host do MongoDB Atlas às vezes carrega a região no nome. Quando carrega,
 * serve para CONTRADIZER uma declaração errada — que é o caso perigoso: alguém
 * declara BR e o cluster está na Virgínia. Nunca serve para dispensar a
 * declaração: ausência de pista não é prova de nada.
 */

/** Nomes de região que denunciam infraestrutura fora do Brasil. */
const REGIOES_ESTRANGEIRAS = [
    'us-east',
    'us-west',
    'useast',
    'uswest',
    'eu-west',
    'eu-central',
    'euwest',
    'ap-south',
    'ap-southeast',
    'ap-northeast',
    'ca-central',
    'sa-east-2',
];

/** O que caracteriza região brasileira nos provedores usados pelo projeto. */
const REGIOES_BRASILEIRAS = ['sa-east-1', 'br-se1', 'brazilsouth', 'southamerica-east1'];

function contem(texto, lista) {
    const alvo = String(texto || '').toLowerCase();
    return lista.find((item) => alvo.includes(item)) || null;
}

/**
 * Avalia a situação de soberania a partir do que foi declarado e da URI.
 *
 * Função pura: recebe strings, devolve o diagnóstico. É assim que os casos de
 * borda (declaração ausente, declaração contradita pela URI) ficam testáveis
 * sem subir servidor nem conectar em banco.
 *
 * @param {object} entrada
 * @param {string} [entrada.regiao]   valor de `DATA_REGION`.
 * @param {string} [entrada.pais]     valor de `DATA_REGION_PAIS`.
 * @param {string} [entrada.mongoUri] URI de conexão (só o host é usado).
 * @returns {{situacao: 'declarada_br'|'declarada_estrangeira'|'nao_declarada'|'conflito',
 *           conforme: boolean, mensagem: string, pistaNaUri: string|null}}
 */
function avaliarSoberania({ regiao, pais, mongoUri } = {}) {
    // Só o host interessa: a URI carrega usuário e senha, e nada aqui pode
    // acabar num log.
    const host = String(mongoUri || '').replace(/^[^@]*@/, '');
    const pistaEstrangeira = contem(host, REGIOES_ESTRANGEIRAS);
    const pistaBrasileira = contem(host, REGIOES_BRASILEIRAS);
    const pistaNaUri = pistaEstrangeira || pistaBrasileira;

    const declarouBr =
        String(pais || '').toUpperCase() === 'BR' || Boolean(contem(regiao, REGIOES_BRASILEIRAS));
    const declarouEstrangeira = Boolean(contem(regiao, REGIOES_ESTRANGEIRAS));

    if (!regiao && !pais) {
        return {
            situacao: 'nao_declarada',
            conforme: false,
            pistaNaUri,
            mensagem:
                'Região dos dados não declarada. Defina DATA_REGION e DATA_REGION_PAIS — ' +
                'a Portaria SGD/MGI 5.950/2023 e os editais municipais pedem a informação ' +
                'por escrito, e ela não pode depender da memória de quem criou o cluster.',
        };
    }

    if (declarouBr && pistaEstrangeira) {
        // O caso perigoso: a declaração diz uma coisa e a infraestrutura diz
        // outra. Melhor gritar aqui do que descobrir na auditoria.
        return {
            situacao: 'conflito',
            conforme: false,
            pistaNaUri,
            mensagem:
                `Região declarada como brasileira, mas a conexão aponta para "${pistaEstrangeira}". ` +
                'Confira onde o cluster está de fato antes de assinar qualquer termo de conformidade.',
        };
    }

    if (declarouEstrangeira) {
        return {
            situacao: 'declarada_estrangeira',
            conforme: false,
            pistaNaUri,
            mensagem:
                `Região declarada (${regiao}) está fora do Brasil. Para dado da administração ` +
                'pública, verifique o enquadramento antes de operar em produção.',
        };
    }

    return {
        situacao: 'declarada_br',
        conforme: true,
        pistaNaUri,
        mensagem: `Dados hospedados em região declarada no Brasil (${regiao || pais}).`,
    };
}

/** Lê do ambiente e avalia — o que o boot e a rota de conformidade usam. */
function situacaoAtual(env = process.env) {
    return avaliarSoberania({
        regiao: env.DATA_REGION,
        pais: env.DATA_REGION_PAIS,
        mongoUri: env.MONGODB_URI,
    });
}

module.exports = { avaliarSoberania, situacaoAtual, REGIOES_BRASILEIRAS, REGIOES_ESTRANGEIRAS };
