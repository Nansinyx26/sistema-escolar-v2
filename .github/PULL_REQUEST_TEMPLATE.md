<!--
  ⚠️  NÃO APAGUE A LINHA "Closes #" ABAIXO.
  O job `pr-policy` do CI reprova qualquer PR sem referência a uma Issue.
  Regras completas em AGENTS.md.
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

## Tipo

- [ ] 🐛 Correção
- [ ] ✨ Melhoria
- [ ] 🚀 Nova função

## Checklist

- [ ] Este PR resolve **uma única** Issue, e ela está referenciada acima
- [ ] `npm run verify` passou localmente
- [ ] Commits seguem Conventional Commits
- [ ] Testes adicionados ou atualizados; cobertura não caiu
- [ ] Sem segredo, `.env`, chave ou credencial no diff
- [ ] Sem PII de aluno/responsável em log, teste ou fixture

## Interface (marque se o PR toca em UI)

- [ ] Estados de carregamento usam **skeleton**, não spinner solto nem tela em branco
- [ ] Imagens abaixo da dobra com `loading="lazy"` e `decoding="async"`
- [ ] Entrada/saída animadas com os tokens de `css/motion.css` (saída mais sutil que a entrada)
- [ ] Só anima `transform` / `opacity` / `filter` / `clip-path`
- [ ] `prefers-reduced-motion` respeitado
- [ ] Interações de alta frequência e atalhos de teclado **não** animam

## Observabilidade (marque se o PR toca no backend)

- [ ] Erros reportados via `backend/src/observability`
- [ ] Operações relevantes dentro de um span do OpenTelemetry

## Deploy

<!-- Marque o destino. Deploy é automático no merge. -->

- [ ] `develop` → ambiente **Dev**
- [ ] `main` → **Produção**
- [ ] Requer migração de banco
- [ ] Requer nova variável de ambiente (liste abaixo)
