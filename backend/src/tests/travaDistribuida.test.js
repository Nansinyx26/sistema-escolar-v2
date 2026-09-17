/**
 * travaDistribuida.test.js
 *
 * Garante o cumprimento da Issue #336 (Épico #334):
 * - Execução única de rotinas agendadas e de boot entre múltiplas instâncias
 * - Trava por janela de tempo (idempotência periódica com TTL)
 * - Arrendamento (lease com prazo) e retomada após expiração
 * - Resiliência a banco desconectado (sem unhandled exception)
 * - Integração com as 4 rotinas agendadas e initializeSecretCodes
 */

const TravaDistribuida = require('../models/TravaDistribuida');
const {
    executarComTravaJanela,
    executarComArrendamento,
    formatarJanelaDia,
    formatarJanelaMes,
    obterIdInstancia,
} = require('../utils/travaDistribuida');
const { enviarDigest } = require('../jobs/DailyDigestJob');
const { anunciarAtualizacao } = require('../jobs/SystemUpdateJob');
const { executarAnonimizacao } = require('../utils/anonimizacaoAutomatica');
const { initializeSecretCodes } = require('../utils/secretCodeHelper');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

beforeAll(async () => {
    await conectarBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();
});

describe('Trava Distribuída (Issue #336)', () => {
    describe('Formatação de janelas', () => {
        it('formata janela diária no padrão YYYY-MM-DD (fuso America/Sao_Paulo)', () => {
            const data = new Date('2026-09-17T15:30:00Z');
            const janela = formatarJanelaDia(data);
            expect(janela).toBe('2026-09-17');
        });

        it('formata janela mensal no padrão YYYY-MM', () => {
            const data = new Date('2026-10-01T06:00:00Z');
            const janela = formatarJanelaMes(data);
            expect(janela).toBe('2026-10');
        });

        it('fornece identificador de instância não vazio', () => {
            const id = obterIdInstancia();
            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
        });
    });

    describe('Trava por Janela (executarComTravaJanela)', () => {
        it('executa a ação na primeira tentativa e persiste o registro no banco', async () => {
            let executado = false;
            const res = await executarComTravaJanela('teste-rotina', '2026-09-17', async () => {
                executado = true;
                return 'sucesso';
            });

            expect(executado).toBe(true);
            expect(res).toEqual({ executou: true, resultado: 'sucesso' });

            const doc = await TravaDistribuida.findById('janela:teste-rotina:2026-09-17');
            expect(doc).not.toBeNull();
            expect(doc.tipo).toBe('janela');
            expect(doc.dono).toBe(obterIdInstancia());
            expect(doc.expiraEm.getTime()).toBeGreaterThan(Date.now());
        });

        it('duas chamadas simultâneas na mesma janela: apenas uma executa', async () => {
            let contadorExecucoes = 0;

            const chamada1 = executarComTravaJanela(
                'rotacao-codigo',
                '2026-09-17',
                async () => {
                    await new Promise((r) => setTimeout(r, 20));
                    contadorExecucoes += 1;
                    return 'instancia_1';
                },
                { dono: 'instancia_A' }
            );

            const chamada2 = executarComTravaJanela(
                'rotacao-codigo',
                '2026-09-17',
                async () => {
                    await new Promise((r) => setTimeout(r, 20));
                    contadorExecucoes += 1;
                    return 'instancia_2';
                },
                { dono: 'instancia_B' }
            );

            const [res1, res2] = await Promise.all([chamada1, chamada2]);

            expect(contadorExecucoes).toBe(1);
            const vencedores = [res1, res2].filter((r) => r.executou === true);
            const perdedores = [res1, res2].filter((r) => r.executou === false);

            expect(vencedores).toHaveLength(1);
            expect(perdedores).toHaveLength(1);
            expect(perdedores[0]).toEqual({ executou: false, motivo: 'ja_executada' });
        });

        it('janela seguinte executa novamente com sucesso', async () => {
            let contador = 0;
            const resHoje = await executarComTravaJanela(
                'resumo-diario',
                '2026-09-17',
                async () => {
                    contador += 1;
                }
            );
            const resAmanha = await executarComTravaJanela(
                'resumo-diario',
                '2026-09-18',
                async () => {
                    contador += 1;
                }
            );

            expect(resHoje.executou).toBe(true);
            expect(resAmanha.executou).toBe(true);
            expect(contador).toBe(2);
        });

        it('não remove a chave após a conclusão da ação (garantida por TTL)', async () => {
            await executarComTravaJanela('aviso-atualizacao', '2026-09-17', async () => {});

            const doc = await TravaDistribuida.findById('janela:aviso-atualizacao:2026-09-17');
            expect(doc).not.toBeNull();

            // Segunda tentativa sequencial na mesma janela é barrada
            const segunda = await executarComTravaJanela(
                'aviso-atualizacao',
                '2026-09-17',
                async () => {}
            );
            expect(segunda).toEqual({ executou: false, motivo: 'ja_executada' });
        });

        it('banco fora do ar: rotina é pulada com log, sem estourar unhandled rejection', async () => {
            const fakeModel = {
                db: { readyState: 0 },
            };

            let tentouExecutar = false;
            const res = await executarComTravaJanela(
                'rotina-offline',
                '2026-09-17',
                async () => {
                    tentouExecutar = true;
                },
                { model: fakeModel }
            );

            expect(tentouExecutar).toBe(false);
            expect(res).toEqual({ executou: false, motivo: 'banco_indisponivel' });
        });
    });

    describe('Arrendamento com Prazo (executarComArrendamento)', () => {
        it('executa a ação e libera o arrendamento ao terminar', async () => {
            let executou = false;
            const res = await executarComArrendamento('boot-init', async () => {
                executou = true;
                return 42;
            });

            expect(executou).toBe(true);
            expect(res).toEqual({ executou: true, resultado: 42 });

            // Após conclusão, a trava de arrendamento deve ter sido liberada
            const doc = await TravaDistribuida.findById('arrendamento:boot-init');
            expect(doc).toBeNull();
        });

        it('libera o arrendamento mesmo se a ação lançar erro', async () => {
            await expect(
                executarComArrendamento('erro-critico', async () => {
                    throw new Error('Falha simulada');
                })
            ).rejects.toThrow('Falha simulada');

            const doc = await TravaDistribuida.findById('arrendamento:erro-critico');
            expect(doc).toBeNull();
        });

        it('arrendamento ativo não é adquirido por outra instância concorrente', async () => {
            let instancia1Rodando = false;
            let instancia2Tentou = false;

            const p1 = executarComArrendamento(
                'processo-longo',
                async () => {
                    instancia1Rodando = true;
                    await new Promise((r) => setTimeout(r, 60));
                    return 'i1';
                },
                { dono: 'instancia-1', duracaoMs: 5000 }
            );

            // Aguarda i1 pegar o lock
            await new Promise((r) => setTimeout(r, 15));

            const p2 = executarComArrendamento(
                'processo-longo',
                async () => {
                    instancia2Tentou = true;
                    return 'i2';
                },
                { dono: 'instancia-2', duracaoMs: 5000 }
            );

            const [r1, r2] = await Promise.all([p1, p2]);

            expect(instancia1Rodando).toBe(true);
            expect(instancia2Tentou).toBe(false);
            expect(r1.executou).toBe(true);
            expect(r2).toEqual({ executou: false, motivo: 'arrendamento_ocupado' });
        });

        it('arrendamento vencido pode ser retomado por outra instância', async () => {
            // Simula um arrendamento gravado por uma instância que travou no passado
            const passado = new Date(Date.now() - 10000);
            await TravaDistribuida.create({
                _id: 'arrendamento:processo-abandonado',
                tipo: 'arrendamento',
                dono: 'instancia-morta',
                adquiridaEm: passado,
                expiraEm: passado, // Já expirou
            });

            let recuperou = false;
            const res = await executarComArrendamento(
                'processo-abandonado',
                async () => {
                    recuperou = true;
                    return 'recuperado';
                },
                { dono: 'instancia-viva' }
            );

            expect(recuperou).toBe(true);
            expect(res).toEqual({ executou: true, resultado: 'recuperado' });
        });

        it('banco fora do ar: arrendamento é pulado com log sem estourar unhandled rejection', async () => {
            const fakeModel = {
                db: { readyState: 0 },
            };

            let executou = false;
            const res = await executarComArrendamento(
                'teste-boot-offline',
                async () => {
                    executou = true;
                },
                { model: fakeModel }
            );

            expect(executou).toBe(false);
            expect(res).toEqual({ executou: false, motivo: 'banco_indisponivel' });
        });
    });

    describe('Integração das Rotinas Agendadas e Boot com a Trava', () => {
        it('enviarDigest é protegido por trava de janela diária', async () => {
            const r1 = await enviarDigest();
            expect(r1.executou).toBe(true);

            // Segunda chamada no mesmo dia é interceptada
            const r2 = await enviarDigest();
            expect(r2).toEqual({ executou: false, motivo: 'ja_executada' });
        });

        it('anunciarAtualizacao é protegido por trava de janela diária', async () => {
            const r1 = await anunciarAtualizacao();
            expect(r1.executou).toBe(true);

            // Segunda chamada no mesmo dia é interceptada
            const r2 = await anunciarAtualizacao();
            expect(r2).toEqual({ executou: false, motivo: 'ja_executada' });
        });

        it('executarAnonimizacao é protegido por trava de janela mensal', async () => {
            const r1 = await executarAnonimizacao();
            expect(r1.executou).toBe(true);

            // Segunda chamada no mesmo mês é interceptada
            const r2 = await executarAnonimizacao();
            expect(r2).toEqual({ executou: false, motivo: 'ja_executada' });
        });

        it('initializeSecretCodes é protegido por trava de arrendamento', async () => {
            const r1 = await initializeSecretCodes();
            expect(r1.executou).toBe(true);

            // O arrendamento é liberado ao término, então nova chamada após finalizar funciona
            const r2 = await initializeSecretCodes();
            expect(r2.executou).toBe(true);
        });
    });
});
