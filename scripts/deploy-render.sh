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
# ============================================================================
set -euo pipefail

: "${RENDER_SERVICE_ID:?RENDER_SERVICE_ID não definido}"
: "${RENDER_API_TOKEN:?RENDER_API_TOKEN não definido}"
ambiente="${RENDER_AMBIENTE:-desconhecido}"
base="${RENDER_API_BASE:-https://api.render.com}"

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

{
    echo "### 🚀 Deploy de ${ambiente} solicitado"
    echo ""
    echo "- Serviço: \`${RENDER_SERVICE_ID}\`"
    echo "- Deploy: \`${deploy_id:-n/d}\`"
    echo "- Resposta da API: \`HTTP ${status}\`"
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
