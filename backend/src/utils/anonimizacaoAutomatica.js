/**
 * anonimizacaoAutomatica.js
 * ============================================
 * IMPLEMENTAÇÍO: Anonimização Automática — Roadmap #14
 * Sprint: Setembro–Outubro 2026
 * ============================================
 * Cron job mensal que detecta usuários inativos há mais de 12 meses
 * e os anonimiza automaticamente, cumprindo a política de retenção LGPD.
 *
 * Fluxo:
 *   1. Todo dia 1 às 03:00, busca usuários com ultimoLogin > 12 meses atrás
 *   2. Envia e-mail de aviso 30 dias antes (quando ultimoLogin > 11 meses)
 *   3. Anonimiza efetivamente na marca dos 12 meses
 *
 * USO: Chamar startAnonimizacaoAutomatica() no index.js após o servidor iniciar.
 */

const cron = require('node-cron');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const escapeRegex = require('./escapeRegex');
const { logAction } = require('./auditHelper');
const { enviarEmail } = require('../services/EnvioEmail');
const { executarComTravaJanela, formatarJanelaMes } = require('./travaDistribuida');

// Threshold padrão: 12 meses = 365 dias (o aviso sai 30 dias antes)
const THRESHOLD_ANONIMIZACAO_DIAS = 365;

/**
 * QUEM A ROTINA NÍO ANONIMIZA (Issue #409)
 * ----------------------------------------
 * A inatividade de 12 meses era o único critério, e isso alcançava gente que
 * a escola ainda precisa identificar:
 *
 *  - **Responsável de aluno com vínculo ativo.** O pai que não entra no portal
 *    continua sendo o responsável legal da criança matriculada; anonimizar a
 *    conta dele apaga o contato de emergência e quebra a autorização de
 *    retirada. A escola tem dever de guarda e de contato enquanto durar a
 *    matrícula — o prazo de inatividade não vale contra isso.
 *  - **Conta de equipe.** Nota, chamada e ocorrência ficam amarradas a quem as
 *    lançou; trocar o nome por "Usuário Anonimizado" apaga a autoria de um
 *    registro escolar que tem guarda obrigatória. A conta é **desativada** —
 *    perde o acesso, mantém a autoria.
 *
 * Tudo configurável, com o padrão mais protetivo:
 *   ANONIMIZACAO_INATIVIDADE_DIAS=365   prazo de inatividade
 *   ANONIMIZACAO_EQUIPE=desativar       'anonimizar' só por decisão da escola
 */
const PERFIS_DE_EQUIPE = ['admin', 'diretor', 'professor', 'secretaria'];

/**
 * Requisição fictícia para o `logAction` — a rotina roda no cron, sem HTTP.
 *
 * O objeto anterior tinha só `ip` e `user`, e `logAction` lê `req.headers`:
 * a leitura estourava TypeError dentro do try/catch do helper e **todo** o
 * registro de anonimização automática era perdido em silêncio. `id` fica de
 * fora de propósito — o helper cai no `recursoId`, que é um ObjectId de
 * verdade, em vez de tentar gravar a string 'SISTEMA' num campo ObjectId.
 */
function requisicaoDoSistema() {
    return {
        ip: '0.0.0.0',
        headers: {},
        socket: {},
        user: { email: 'cron@sistema', perfil: 'sistema' },
    };
}

function prazoDeInatividade() {
    const bruto = Number.parseInt(process.env.ANONIMIZACAO_INATIVIDADE_DIAS || '', 10);
    return Number.isFinite(bruto) && bruto > 0 ? bruto : THRESHOLD_ANONIMIZACAO_DIAS;
}

function equipeEhAnonimizada() {
    return String(process.env.ANONIMIZACAO_EQUIPE || '').toLowerCase() === 'anonimizar';
}

/**
 * Conta com aluno ativo apontando para ela — por qualquer um dos três campos
 * em que a ficha guarda o e-mail do responsável.
 */
async function temVinculoAtivoComAluno(email) {
    const alvo = String(email || '').trim();
    if (!alvo) return false;
    const exato = new RegExp(`^${escapeRegex(alvo)}$`, 'i');
    const achado = await Aluno.exists({
        ativo: { $ne: false },
        anonimizadoEm: null,
        $or: [
            { responsavel: exato },
            { 'responsavelDados.email': exato },
            { 'responsaveis.email': exato },
        ],
    });
    return Boolean(achado);
}

/** Decide o que fazer com uma conta inativa. */
async function destinoDaConta(usuario) {
    if (PERFIS_DE_EQUIPE.includes(String(usuario.perfil || '').toLowerCase())) {
        return equipeEhAnonimizada() ? 'anonimizar' : 'desativar';
    }
    if (await temVinculoAtivoComAluno(usuario.email)) return 'preservar';
    return 'anonimizar';
}

// --------------------------------------------------
// Utilitário: Calcula a data X dias atrás
// --------------------------------------------------
function diasAtras(dias) {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d;
}

// --------------------------------------------------
// Envia e-mail de aviso de anonimização iminente
// --------------------------------------------------
/**
 * BUG CORRIGIDO: este aviso nunca chegou a ninguém.
 *
 * O `transporter` era um PARÂMETRO, e a cadeia inteira de chamadas o recebia
 * como `undefined` — `startAnonimizacaoAutomatica()` é invocada sem argumento
 * no index.js. A primeira linha da função (`if (!transporter) return`) então
 * saía sempre, em silêncio: o aviso de 30 dias exigido antes da anonimização
 * LGPD jamais foi disparado, e nada no log indicava isso.
 *
 * O parâmetro sumiu. O envio vai por services/EnvioEmail.js, como todo o resto.
 */
async function enviarAvisoAnonimizacao(usuario) {
    if (!usuario.email || usuario.email.includes('@escola.anon')) return;

    try {
        await enviarEmail(
            usuario.email,
            'Aviso LGPD: Seus dados serão anonimizados em 30 dias',
            `
                <div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;border:1px solid #f59e0b;border-radius:8px;">
                    <h2 style="color:#b45309;">Aviso de Privacidade — LGPD</h2>
                    <p>Olá, <strong>${usuario.nome}</strong>.</p>
                    <p>Identificamos que sua conta no Sistema Escolar está <strong>inativa há 11 meses</strong>.</p>
                    <p>De acordo com nossa Política de Privacidade (LGPD), contas inativas por mais de 12 meses
                    têm seus dados pessoais anonimizados automaticamente.</p>
                    <p><strong>Você tem 30 dias</strong> para fazer login e manter sua conta ativa antes da anonimização.</p>
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3001'}/index.html"
                       style="display:inline-block;padding:10px 20px;background:#1a56db;color:white;text-decoration:none;border-radius:5px;margin:12px 0;">
                        Acessar o Sistema
                    </a>
                    <p style="color:#666;font-size:13px;">
                        Se você não quiser mais usar o sistema, pode ignorar este e-mail.
                        Seus dados serão anonimizados e a conta desativada.
                    </p>
                    <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
                    <p style="color:#aaa;font-size:12px;">E-mail automático — Sistema Escolar | LGPD Art. 18</p>
                </div>
            `
        );
    } catch (err) {
        console.error(`[LGPD] Erro ao enviar aviso para ${usuario.email}:`, err.message);
    }
}

// --------------------------------------------------
// Executa a rotina de anonimização
// --------------------------------------------------
async function executarAnonimizacao(opcoesTrava = {}) {
    const janela = formatarJanelaMes();
    return executarComTravaJanela(
        'anonimizacao-lgpd',
        janela,
        async () => {
            console.log('🔄 [LGPD] Iniciando rotina de anonimização automática...');

            let anonimizados = 0;
            let desativados = 0;
            let preservados = 0;
            let avisoEnviados = 0;
            const prazo = prazoDeInatividade();

            try {
                // --- FASE 1: Enviar aviso para usuários próximos ao threshold ---
                const dataAviso = diasAtras(Math.max(prazo - 30, 1));
                const dataAnonimizacao = diasAtras(prazo);

                const usuariosParaAviso = await Usuario.find({
                    ativo: true,
                    anonimizadoEm: null,
                    ultimoLogin: {
                        $lte: dataAviso, // Inativo há mais de 11 meses
                        $gt: dataAnonimizacao, // Mas menos de 12 meses (ainda não será anonimizado)
                    },
                })
                    .select('_id email nome perfil ultimoLogin')
                    .lean();

                for (const usuario of usuariosParaAviso) {
                    // Avisar quem não será anonimizado é assustar a família à
                    // toa — e desmentir o próprio aviso 30 dias depois.
                    if ((await destinoDaConta(usuario)) !== 'anonimizar') continue;
                    await enviarAvisoAnonimizacao(usuario);
                    avisoEnviados++;
                }

                // --- FASE 2: Anonimizar os que ultrapassaram 12 meses ---
                const usuariosParaAnonimizar = await Usuario.find({
                    ativo: true,
                    anonimizadoEm: null,
                    ultimoLogin: { $lte: dataAnonimizacao },
                })
                    .select('_id email nome perfil ultimoLogin')
                    .lean();

                for (const usuario of usuariosParaAnonimizar) {
                    const destino = await destinoDaConta(usuario);

                    if (destino === 'preservar') {
                        preservados++;
                        continue;
                    }

                    if (destino === 'desativar') {
                        await Usuario.findByIdAndUpdate(usuario._id, {
                            $set: { ativo: false },
                        });
                        await logAction(
                            requisicaoDoSistema(),
                            'AUTO_DESATIVAR_EQUIPE',
                            'Usuarios',
                            {
                                recursoId: String(usuario._id),
                                valorAnterior: { ativo: true },
                                valorNovo: { ativo: false },
                                descricao: `Conta de equipe ${usuario._id} desativada por inatividade (>${prazo} dias). A autoria dos lançamentos é preservada.`,
                            }
                        );
                        desativados++;
                        continue;
                    }

                    const idAnonimo = `anon_${usuario._id}_${Date.now()}`;

                    await Usuario.findByIdAndUpdate(usuario._id, {
                        $set: {
                            nome: 'Usuário Anonimizado (LGPD)',
                            email: `${idAnonimo}@escola.anon`,
                            cpf: '000.000.000-00',
                            telefone: '(00) 00000-0000',
                            ativo: false,
                            senha: 'ANONIMIZADO_LGPD',
                            anonimizadoEm: new Date(),
                            foto: null,
                            resetToken: null,
                            resetTokenExpiry: null,
                        },
                    });

                    // Registra no audit log (sem req, é uma ação do sistema)
                    await logAction(requisicaoDoSistema(), 'AUTO_ANONYMIZE_USER', 'Usuarios', {
                        recursoId: String(usuario._id),
                        descricao: `Conta ${usuario._id} anonimizada por inatividade (>${prazo} dias). Último login: ${usuario.ultimoLogin?.toISOString() || 'nunca'}`,
                    });

                    console.log(
                        `✅ [LGPD] Conta ${usuario._id} anonimizada (último login: ${usuario.ultimoLogin?.toISOString() || 'nunca'})`
                    );
                    anonimizados++;
                }

                console.log(
                    `✅ [LGPD] Rotina concluída — Anonimizados: ${anonimizados} | Desativados: ${desativados} | Preservados: ${preservados} | Avisos enviados: ${avisoEnviados}`
                );
            } catch (err) {
                console.error('❌ [LGPD] Erro na rotina de anonimização:', err.message);
            }

            return { anonimizados, desativados, preservados, avisoEnviados };
        },
        { ttlSegundos: 35 * 24 * 3600, ...opcoesTrava }
    );
}

// --------------------------------------------------
// Inicia o cron job
// --------------------------------------------------
function startAnonimizacaoAutomatica() {
    if (process.env.NODE_ENV !== 'production') {
        console.log('ℹ️  [LGPD] Anonimização automática desativada em desenvolvimento.');
        return;
    }

    // Executa todo dia 1 do mês às 03:00
    // Cron: '0 3 1 * *'  →  minuto=0, hora=3, dia=1, mês=*, dia-semana=*
    cron.schedule(
        '0 3 1 * *',
        () => {
            executarAnonimizacao();
        },
        {
            timezone: 'America/Sao_Paulo',
        }
    );

    console.log(
        '🔒 [LGPD] Cron de anonimização automática ativo — Executa todo dia 1 do mês às 03:00.'
    );
}

module.exports = {
    startAnonimizacaoAutomatica,
    executarAnonimizacao,
    temVinculoAtivoComAluno,
    destinoDaConta,
    PERFIS_DE_EQUIPE,
};
