/**
 * formatarPresenca.test.js — "visto por último" em texto (Issue #70).
 *
 * ONDE ESTÁ O VALOR DESTES TESTES
 * -------------------------------
 * Formatar hora é trivial; acertar QUAL DIA é que não é. O servidor roda em
 * UTC e a escola vive em São Paulo, três horas atrás, então todo instante
 * entre 21h e meia-noite pertence a um dia em São Paulo e a outro em UTC. Uma
 * implementação que ignore o fuso passa o dia inteiro certa e erra à noite —
 * inclusive na máquina de quem desenvolve, que está no fuso certo e nunca vê.
 *
 * Por isso os horários abaixo são escritos como instantes UTC explícitos, com
 * o horário de São Paulo no comentário ao lado. Escrever `new Date('...T23:30')`
 * sem o Z deixaria o teste dependente do fuso de quem o roda, que é exatamente
 * o defeito sob teste.
 *
 * São Paulo é UTC-3 e não observa horário de verão desde 2019.
 */
const { formatarPresenca, textoUltimoAcesso, FUSO } = require('../utils/formatarPresenca');

/** Instante UTC a partir do horário de parede em São Paulo (UTC-3). */
function emSaoPaulo(iso) {
    return new Date(`${iso}:00-03:00`);
}

describe('status que não mostram último acesso', () => {
    it('online é só "online"', () => {
        expect(formatarPresenca({ status: 'online' })).toBe('online');
    });

    it('ausente tem rótulo próprio, não vira "online"', () => {
        // Agrupar ausente em online prometeria uma resposta imediata que a
        // pessoa, com todas as abas ociosas, provavelmente não vai dar.
        expect(formatarPresenca({ status: 'ausente' })).toBe('ausente');
    });

    it('quem está online NÃO expõe o último acesso', () => {
        // Presença revela rotina. Repetir a última atividade de alguém que está
        // ali na hora entrega horário sem informar nada.
        const texto = formatarPresenca({
            status: 'online',
            ultimoAcesso: emSaoPaulo('2026-08-19T07:03'),
        });
        expect(texto).toBe('online');
        expect(texto).not.toMatch(/07:03|visto/);
    });
});

describe('offline sem informação utilizável', () => {
    it.each([
        ['sem último acesso', { status: 'offline' }],
        ['último acesso nulo', { status: 'offline', ultimoAcesso: null }],
        ['data inválida', { status: 'offline', ultimoAcesso: 'não é data' }],
        ['objeto vazio', {}],
        ['undefined', undefined],
    ])('%s → "offline", sem inventar horário', (_rotulo, entrada) => {
        expect(formatarPresenca(entrada)).toBe('offline');
    });
});

describe('o dia é do calendário de São Paulo, não do relógio do servidor', () => {
    it('23:30 em São Paulo é HOJE, mesmo já sendo o dia seguinte em UTC', () => {
        // 19/08 23:30 em São Paulo = 20/08 02:30 em UTC.
        const acesso = emSaoPaulo('2026-08-19T23:30');
        const agora = emSaoPaulo('2026-08-19T23:45');

        // Confirma que a armadilha existe: em UTC este instante já é dia 20.
        expect(acesso.toISOString()).toBe('2026-08-20T02:30:00.000Z');

        expect(formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora)).toBe(
            'visto por último hoje às 23:30'
        );
    });

    it('40 minutos atrás pode ser ONTEM, se cruzou a meia-noite', () => {
        // A implementação ingênua (agora - data < 24h → "hoje") erra aqui.
        const acesso = emSaoPaulo('2026-08-19T23:50');
        const agora = emSaoPaulo('2026-08-20T00:30');

        expect(agora - acesso).toBe(40 * 60 * 1000);
        expect(formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora)).toBe(
            'visto por último ontem às 23:50'
        );
    });

    it('quase 24 horas atrás ainda é HOJE, se não cruzou a meia-noite', () => {
        // O espelho do caso anterior: a mesma implementação ingênua erra aqui
        // para o outro lado.
        const acesso = emSaoPaulo('2026-08-19T00:30');
        const agora = emSaoPaulo('2026-08-19T23:50');

        expect(agora - acesso).toBe((23 * 60 + 20) * 60 * 1000);
        expect(formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora)).toBe(
            'visto por último hoje às 00:30'
        );
    });
});

describe('datas mais antigas', () => {
    it('dentro do ano corrente mostra dia/mês, sem o ano', () => {
        const acesso = emSaoPaulo('2026-08-12T08:00');
        const agora = emSaoPaulo('2026-08-19T10:00');

        expect(formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora)).toBe(
            'visto por último em 12/08 às 08:00'
        );
    });

    it('de outro ano mostra o ano — senão "em 12/08" seria ambíguo', () => {
        const acesso = emSaoPaulo('2025-08-12T08:00');
        const agora = emSaoPaulo('2026-08-19T10:00');

        expect(formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora)).toBe(
            'visto por último em 12/08/2025 às 08:00'
        );
    });

    it('"ontem" vence a regra de ano na virada do ano-novo', () => {
        // 31/12 é de outro ano que 01/01, mas ainda é ontem. Dizer
        // "em 31/12/2026" para o dia anterior seria tecnicamente certo e
        // estranho de ler.
        const acesso = emSaoPaulo('2026-12-31T22:00');
        const agora = emSaoPaulo('2027-01-01T09:00');

        expect(formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora)).toBe(
            'visto por último ontem às 22:00'
        );
    });
});

describe('a véspera é calculada pelo calendário', () => {
    it('1º de março cai no dia 29 em ano bissexto', () => {
        const acesso = emSaoPaulo('2028-02-29T22:00');
        const agora = emSaoPaulo('2028-03-01T10:00');

        expect(textoUltimoAcesso(acesso, agora)).toBe('ontem às 22:00');
    });

    it('1º de março cai no dia 28 em ano comum', () => {
        const acesso = emSaoPaulo('2027-02-28T22:00');
        const agora = emSaoPaulo('2027-03-01T10:00');

        expect(textoUltimoAcesso(acesso, agora)).toBe('ontem às 22:00');
    });
});

describe('entradas que o mundo real produz', () => {
    it('aceita string ISO, que é como a presença chega serializada', () => {
        const acesso = emSaoPaulo('2026-08-19T14:32');
        const agora = emSaoPaulo('2026-08-19T18:00');

        expect(
            formatarPresenca({ status: 'offline', ultimoAcesso: acesso.toISOString() }, agora)
        ).toBe('visto por último hoje às 14:32');
    });

    it('status ausente do objeto é tratado como offline', () => {
        const acesso = emSaoPaulo('2026-08-19T14:32');
        const agora = emSaoPaulo('2026-08-19T18:00');

        expect(formatarPresenca({ ultimoAcesso: acesso }, agora)).toBe(
            'visto por último hoje às 14:32'
        );
    });

    it('status em caixa alta funciona', () => {
        expect(formatarPresenca({ status: 'ONLINE' })).toBe('online');
    });

    it('acesso no futuro (relógio adiantado) vira "hoje", não "amanhã"', () => {
        const acesso = emSaoPaulo('2026-08-20T10:00');
        const agora = emSaoPaulo('2026-08-19T18:00');

        const texto = formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora);
        expect(texto).toBe('visto por último hoje às 18:00');
        expect(texto).not.toMatch(/amanhã|20\/08/);
    });

    it('textoUltimoAcesso devolve vazio para entrada imprestável', () => {
        expect(textoUltimoAcesso(null)).toBe('');
        expect(textoUltimoAcesso(new Date('lixo'))).toBe('');
        expect(textoUltimoAcesso(new Date(), new Date('lixo'))).toBe('');
    });
});

describe('o fuso é fixo, não herdado do processo', () => {
    it('expõe America/Sao_Paulo', () => {
        // Se um dia alguém trocar por process.env.TZ, este teste cai junto —
        // que é o aviso desejado: em UTC o texto erra toda noite.
        expect(FUSO).toBe('America/Sao_Paulo');
    });

    it('o resultado não muda quando o processo está em UTC', () => {
        const tzOriginal = process.env.TZ;
        process.env.TZ = 'UTC';
        try {
            const acesso = emSaoPaulo('2026-08-19T23:30');
            const agora = emSaoPaulo('2026-08-19T23:45');
            expect(formatarPresenca({ status: 'offline', ultimoAcesso: acesso }, agora)).toBe(
                'visto por último hoje às 23:30'
            );
        } finally {
            if (tzOriginal === undefined) delete process.env.TZ;
            else process.env.TZ = tzOriginal;
        }
    });
});
