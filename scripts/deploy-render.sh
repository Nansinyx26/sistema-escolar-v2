#!/usr/bin/env bash
# ============================================================================
# deploy-render.sh — dispara um deploy no Render e FALHA quando ele não acontece
# ============================================================================
#
# POR QUE ESTE ARQUIVO EXISTE (Issue #108)
# ----------------------------------------
# Os dois jobs de deploy usavam `johnbeynon/render-deploy-action@v0.0.8` assim:
#
#     with:
#       service-id: ${{ secrets.RENDER_SERVICE_ID_DEV }}
#       api-token:  ${{ secrets.RENDER_API_TOKEN }}
#
# O input daquela action se chama `api-key`, não `api-token`. O Actions apenas
# avisa e segue:
#
#     ##[warning]Unexpected input(s) 'api-token', valid inputs are ['service-id', 'api-key']
#     Response received: 401
#
# O token nunca chegava à action, a chamada saía sem autenticação, e o Render
# recusava. Como a action não trata erro de HTTP como falha, o passo terminava
# VERDE em menos de um segundo — em dev e em produção, por meses.
#
# Trocar o nome do input consertaria o 401 de hoje e deixaria a armadilha de pé:
# token revogado, serviço removido ou cota estourada voltariam a passar em
# silêncio. O que fecha a classe de falha é conferir o status da resposta, e é
# só isso que este script faz a mais.
#
# UM SCRIPT PARA OS DOIS AMBIENTES, DE PROPÓSITO
# ----------------------------------------------
# O mesmo erro de digitação vivia em dois lugares porque o bloco era copiado.
# Com a lógica em um arquivo só, dev e produção não têm como divergir.
#
# ENTRADA (variáveis de ambiente)
#   RENDER_SERVICE_ID  — id do serviço no Render (srv-...)
#   RENDER_API_TOKEN   — token da API do Render (rnd_...)
#   RENDER_AMBIENTE    — rótulo para as mensagens ("dev" | "produção")
#   RENDER_API_BASE    — opcional; só para teste apontar a um servidor local
#
# Espaço em branco em RENDER_SERVICE_ID e RENDER_API_TOKEN é removido antes do
# uso, com aviso no log (Issue #138).
# ============================================================================
set -euo pipefail

: "${RENDER_SERVICE_ID:?RENDER_SERVICE_ID não definido}"
: "${RENDER_API_TOKEN:?RENDER_API_TOKEN não definido}"
ambiente="${RENDER_AMBIENTE:-desconhecido}"
base="${RENDER_API_BASE:-https://api.render.com}"

# ── Espaço em branco no secret (Issue #138) ─────────────────────────────────
# Um Enter a mais na hora de colar o valor no GitHub derrubava o deploy de
# produção antes de sair da máquina:
#
#     curl: (3) URL rejected: Malformed input to a URL function
#
# O id entra no MEIO da URL, então uma quebra de linha ali a invalida inteira.
# Nem `srv-...` nem `rnd_...` contêm espaço legitimamente, então descartar
# qualquer um é seguro — e evita que o mesmo Enter derrube o próximo ambiente.
#
# Mas limpar em silêncio esconderia a configuração errada, que é o defeito de
# fundo das Issues #108 e #133. Por isso o aviso: o deploy passa E o secret
# continua aparecendo como algo a corrigir na origem.
limpar_espacos() {
    printf '%s' "${1:-}" | tr -d '[:space:]'
}

for var in RENDER_SERVICE_ID RENDER_API_TOKEN; do
    limpo="$(limpar_espacos "${!var}")"

    if [ "$limpo" != "${!var}" ]; then
        echo "::warning title=Secret com espaço em branco::${var} tem espaço ou quebra de linha no valor. O deploy segue com o valor limpo, mas corrija o secret na origem (GitHub → Settings → Secrets → Actions). Ver Issue #138."
    fi

    if [ -z "$limpo" ]; then
        echo "::error title=Secret vazio::${var} ficou vazio depois de remover espaço em branco. Nada foi publicado."
        exit 1
    fi

    printf -v "$var" '%s' "$limpo"
done

corpo="$(mktemp)"
trap 'rm -f "$corpo"' EXIT

# `-w %{http_code}` na saída padrão e o corpo no arquivo: preciso dos dois.
# Sem `--fail`, que esconde justamente o corpo que explica a recusa.
if ! status="$(curl -sS --max-time 60 -o "$corpo" -w '%{http_code}' \
        -X POST "${base}/v1/services/${RENDER_SERVICE_ID}/deploys" \
        -H "Authorization: Bearer ${RENDER_API_TOKEN}" \
        -H 'Accept: application/json' \
        -H 'Content-Type: application/json' \
        -d '{}')"; then
    echo "::error title=Deploy de ${ambiente} falhou::Não foi possível falar com a API do Render. Nada foi publicado."
    exit 1
fi

if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    echo "::error title=Deploy de ${ambiente} recusado::A API do Render respondeu HTTP ${status}. NADA foi publicado."
    echo "Resposta do Render:"
    cat "$corpo"
    echo
    # 401 é o sintoma histórico desta Issue; vale a dica direto no log.
    if [ "$status" = "401" ] || [ "$status" = "403" ]; then
        echo "Verifique o secret RENDER_API_TOKEN: expirado, revogado ou sem permissão neste serviço."
    fi
    exit 1
fi

deploy_id="$(jq -r '.id // empty' <"$corpo" 2>/dev/null || true)"
echo "✅ Deploy de ${ambiente} solicitado ao Render (HTTP ${status}), deploy id: ${deploy_id:-n/d}"

# ============================================================================
# SOLICITADO NÃO É PUBLICADO (Issue #108, item 3)
# ============================================================================
# Aceitar o 201 e encerrar deixaria de pé metade da armadilha original: o job
# ficaria verde ao ACIONAR o deploy, mesmo que o build falhasse no Render um
# minuto depois. "O job de deploy passou" continua sendo diferente de "o
# arquivo novo está no servidor".
#
# Por isso o passo acompanha o deploy até ele virar `live` — ou até o Render
# dizer que falhou, e aí o job fica vermelho, que é o desfecho certo.
#
# Estados terminais da API do Render:
#   live                                  -> publicado
#   build_failed | update_failed |
#   canceled | pre_deploy_failed          -> não publicado
#   created | queued | build_in_progress |
#   update_in_progress | pre_deploy_in_progress -> ainda andando
# ============================================================================
espera_max="${RENDER_ESPERA_MAX_S:-900}"   # 15 min; um build deste projeto leva bem menos
intervalo="${RENDER_INTERVALO_S:-15}"

anotar_resumo() {
    {
        echo "### ${1} Deploy de ${ambiente}"
        echo ""
        echo "- Serviço: \`${RENDER_SERVICE_ID}\`"
        echo "- Deploy: \`${deploy_id:-n/d}\`"
        echo "- Resposta da API: \`HTTP ${status}\`"
        echo "- Situação final: \`${2}\`"
    } >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
}

if [ -z "$deploy_id" ]; then
    # Sem id não há o que acompanhar. Não é motivo para reprovar — a chamada foi
    # aceita —, mas precisa aparecer, senão vira o mesmo silêncio de antes.
    echo "::warning title=Deploy de ${ambiente} sem id::A API aceitou a chamada mas não devolveu o id do deploy; não dá para confirmar a publicação."
    anotar_resumo "🚀" "solicitado (sem id para acompanhar)"
    exit 0
fi

echo "⏳ Acompanhando o deploy ${deploy_id} (até ${espera_max}s)..."
inicio="$(date +%s)"
situacao="desconhecida"

while :; do
    if ! curl -sS --max-time 30 -o "$corpo" \
            "${base}/v1/services/${RENDER_SERVICE_ID}/deploys/${deploy_id}" \
            -H "Authorization: Bearer ${RENDER_API_TOKEN}" \
            -H 'Accept: application/json'; then
        # Uma consulta perdida não diz nada sobre o deploy; segue tentando até o prazo.
        echo "   (consulta de situação falhou; nova tentativa em ${intervalo}s)"
    else
        situacao="$(jq -r '.status // .deploy.status // empty' <"$corpo" 2>/dev/null || true)"
        echo "   situação: ${situacao:-desconhecida}"

        case "$situacao" in
            live)
                echo "✅ Deploy de ${ambiente} PUBLICADO."
                anotar_resumo "✅" "$situacao"
                exit 0
                ;;
            build_failed | update_failed | canceled | pre_deploy_failed)
                echo "::error title=Deploy de ${ambiente} falhou::O Render terminou o deploy com situação '${situacao}'. NADA foi publicado."
                anotar_resumo "❌" "$situacao"
                exit 1
                ;;
        esac
    fi

    if [ $(( $(date +%s) - inicio )) -ge "$espera_max" ]; then
        echo "::error title=Deploy de ${ambiente} sem confirmação::Passaram ${espera_max}s e o deploy seguia em '${situacao:-desconhecida}'. Não dá para afirmar que foi publicado."
        anotar_resumo "❌" "sem confirmação em ${espera_max}s (última: ${situacao:-desconhecida})"
        exit 1
    fi

    sleep "$intervalo"
done
