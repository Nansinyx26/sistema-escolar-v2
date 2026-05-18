# Relatório de Performance e Otimizações

Este documento explica os motivos da lentidão percebida no sistema e as ações tomadas para melhorar a velocidade de resposta.

## 1. Por que o sistema parece lento às vezes?

Existem três fatores principais que afetam a velocidade:

### A. Cold Start (Início Frio) do Servidor
O backend do sistema está hospedado no **Render (Plano Gratuito)**.
- **O que acontece:** Após 15-30 minutos de inatividade, o servidor "dorme" para economizar recursos.
- **Impacto:** O primeiro acesso do dia (ou após uma longa pausa) pode demorar de **30 a 50 segundos** para carregar, pois o servidor precisa "acordar".
- **Comportamento esperado:** Após o primeiro carregamento, o sistema deve ficar rápido para todos os usuários subsequentes.

### B. Carregamento Sequencial (Anterior)
Anteriormente, o sistema carregava os dados um por um:
1. Pedia as Configurações -> Esperava resposta.
2. Pedia as Turmas -> Esperava resposta.
3. Pedia os Alunos -> Esperava resposta.
Isso acumulava o tempo de espera de cada pedido.

### C. Volume de Dados
A lista de alunos carrega todos os registros da escola de uma vez para permitir buscas instantâneas e filtros rápidos sem precisar falar com o servidor novamente.

---

## 2. O que foi feito para melhorar?

Implementamos as seguintes otimizações técnicas:

### ✅ Carregamento em Paralelo (Parallel Fetching)
Alteramos o núcleo do sistema (`js/database.js`) para usar `Promise.all()`. 
- **Resultado:** Agora o sistema pede Configurações e Turmas **ao mesmo tempo**. O tempo total de espera inicial foi reduzido drasticamente.

### ✅ Foco em Dados Reais (MongoDB)
O sistema foi configurado para **sempre carregar os dados originais do banco de dados**. Removemos qualquer carregamento de arquivos locais antigos para garantir que a informação que você vê na tela seja 100% fiel ao que foi salvo por último.

### ✅ Otimização de Filtros
Na lista de alunos, os filtros agora são processados localmente no navegador, o que significa que, após o primeiro carregamento, a busca e a troca de turmas são **instantâneas**.

### ✅ Cache Busting (v2.5)
Adicionamos sufixos de versão nos arquivos para garantir que seu navegador não tente carregar uma versão antiga e lenta que esteja guardada no cache.

---

## 3. Recomendações

Para uma melhor experiência:
1. **Primeiro Acesso:** Ao chegar na escola, abra o sistema uma vez. Isso "acorda" o servidor para todos os outros professores que chegarem depois.
2. **Navegador:** Recomendamos o uso do Google Chrome ou Microsoft Edge atualizados para melhor performance do motor de JavaScript.

---
*Documento gerado em 05/05/2026 para documentação do Sistema Escolar v2.*
