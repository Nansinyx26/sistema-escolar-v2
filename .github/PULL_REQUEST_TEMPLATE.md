<!--
  ⚠️  NÃO APAGUE A LINHA "Closes #" ABAIXO.
  O job `pr-policy` do CI reprova qualquer PR sem referência a uma Issue.
  Regras completas em AGENTS.md.

  SOBRE AS CAIXAS DESTE TEMPLATE (Issue #161):
  toda caixa que sobrar aqui significa TRABALHO PENDENTE. O que é classificação
  — tipo do PR, destino do deploy — virou texto, e seção que não se aplica ao
  seu PR deve ser APAGADA inteira, não deixada com as caixas vazias.
  Um PR pronto para merge tem todas as caixas marcadas.
-->

Closes #

## O que muda

<!-- Descreva a alteração em 2-4 linhas. -->

## Por que

<!-- O motivo, não a repetição do "o que". Qual dor da Issue isso resolve. -->

## Como testar

1.
2.
3.

<!-- Deixe só um: 🐛 Correção · ✨ Melhoria · 🚀 Nova função -->
**Tipo:** ✨ Melhoria

## Checklist

- [ ] Este PR resolve **uma única** Issue, e ela está referenciada acima
- [ ] `npm run verify` passou localmente
- [ ] Commits seguem Conventional Commits
- [ ] Testes adicionados ou atualizados; cobertura não caiu
- [ ] Sem segredo, `.env`, chave ou credencial no diff
- [ ] Sem PII de aluno/responsável em log, teste ou fixture

## Interface

<!--
  APAGUE esta seção inteira se o PR não toca em UI.
  Item que não se aplica ao seu PR (sem imagem, sem animação) também é
  marcado — e o porquê vai na descrição, como frase, não como caixa vazia.
-->

- [ ] Estados de carregamento usam **skeleton**, não spinner solto nem tela em branco
- [ ] Imagens abaixo da dobra com `loading="lazy"` e `decoding="async"`
- [ ] Entrada/saída animadas com os tokens de `css/motion.css` (saída mais sutil que a entrada)
- [ ] Só anima `transform` / `opacity` / `filter` / `clip-path`
- [ ] `prefers-reduced-motion` respeitado
- [ ] Interações de alta frequência e atalhos de teclado **não** animam

## Observabilidade

<!--
  APAGUE esta seção inteira se o PR não toca no backend.
  Mesma regra da seção acima para item que não se aplica.
-->

- [ ] Erros reportados via `backend/src/observability`
- [ ] Operações relevantes dentro de um span do OpenTelemetry

## Deploy

<!--
  Deploy é automático no merge. Responda as três linhas — "Não" é uma
  resposta, caixa vazia não era.
-->

| | |
|---|---|
| Ambiente | `develop` → **Dev** |
| Migração de banco | Não |
| Variável de ambiente nova | Não |
