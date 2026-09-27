# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Modelo de Relatório de Impacto à Proteção de Dados
> Pessoais (RIPD) para o Sistema Escolar. A auditoria o recomenda fortemente
> por envolver crianças, dados sensíveis e IA (LGPD, art. 38)
> `[VALIDAR COM JURÍDICO]` obrigatoriedade. As seções já trazem o que o código
> mostra; o que é avaliação institucional está marcado.

---

## 1. Identificação

- Controlador: `[ ]`
- Encarregado: `[ ]`
- Sistema: Sistema Escolar v2 (web, portal do responsável, backend)
- Data e versão: `[ ]`
- Responsáveis pela elaboração: `[ ]`

## 2. Necessidade do relatório

Tratamento em larga escala de dados de crianças e adolescentes (art. 14), de
dados sensíveis (art. 11) e uso de serviço de IA de terceiro.

## 3. Descrição do tratamento

Ver `registro-operacoes-tratamento-RASCUNHO.md` (natureza, escopo,
finalidade, titulares, dados, retenção, operadores).

## 4. Partes interessadas consultadas

`[ ]` — sugestão: direção, secretarias escolares, conselho escolar,
representação de famílias, TI da prefeitura.

## 5. Necessidade e proporcionalidade

| Pergunta | Situação no sistema |
|---|---|
| Cada dado tem finalidade? | religião e responsabilidade financeira removidas; CPF do aluno e plano de saúde continuam `[DECISÃO]` |
| O acesso é o mínimo? | lista fechada de campos por perfil; professor só da própria turma; gestão só da própria escola |
| Há dado sensível sem necessidade? | detalhe de deficiência e transtornos fechado ao professor por padrão |
| A IA recebe dado identificável? | não: pseudonimização antes do envio; IA desligada por padrão |

## 6. Riscos

| Risco | Probabilidade `[AVALIAR]` | Impacto `[AVALIAR]` | Medida existente | Risco residual |
|---|---|---|---|---|
| Acesso de pessoa sem vínculo a dados de criança | | alto | vínculo por e-mail confirmado, aprovação da escola para inclusão, bloqueio judicial | `[ ]` |
| Cruzamento entre escolas | | alto | filtro por escola que falha fechado; guarda em todas as rotas por id | `[ ]` |
| Vazamento por fornecedor de IA | | alto | pseudonimização; IA por adesão | plano do provedor `[DECISÃO]` |
| Perda de dados | | alto | backup `[DESCONHECIDO — confirmar tier do Atlas]` | `[ ]` |
| Transferência internacional sem contrato | | médio | nenhuma técnica | contratos `[PENDENTE]` |
| Destruição de prova (documento assinado) | | médio | versões imutáveis com hash | `[ ]` |
| Decisão automática sobre aluno | | médio | indicadores só como apoio, sem gravar situação | `[ ]` |
| Genitor com restrição judicial acessando | | alto | marcador de bloqueio controlado pela secretaria | depende de a escola marcar |

## 7. Medidas adicionais propostas

`[ ]`

## 8. Conclusão e aprovação

Parecer do encarregado: `[ ]`
Aprovação do controlador: `[ ]`
Revisão prevista: `[ANUAL / a cada mudança relevante]`
