# Relatório de Atualizações - Sistema ATA Escolar v2.0

Este documento resume as melhorias e correções implementadas recentemente no módulo de **ATA do Conselho de Classe**.

## 🚀 Novas Funcionalidades e Melhorias de UX

### 1. Atualização em Tempo Real (Real-time Preview)
*   **O que mudou:** A prévia do documento PDF na parte inferior da tela agora é atualizada instantaneamente conforme você digita.
*   **Benefício:** Não é mais necessário clicar manualmente no botão "Atualizar Prévia" para ver como o texto está ficando.

### 2. Salvamento Automático (Auto-save)
*   **O que mudou:** Implementado sistema de salvamento inteligente que detecta inatividade de 1.5 segundos e salva os dados do aluno automaticamente no banco de dados.
*   **Benefício:** Maior segurança contra perda de dados. O botão "Salvar" manual continua existindo como garantia extra.

### 3. Campo de Observações Inteligente
*   **O que mudou:** O campo "Pequeno Relatório / Observações" agora aumenta de altura automaticamente conforme você escreve (auto-grow).
*   **Benefício:** Melhor visibilidade de textos longos durante a edição, eliminando a necessidade de barras de rolagem internas.

### 4. Atualização de Ano Letivo
*   **O que mudou:** O ano padrão do sistema foi alterado de **2025** para **2026** em toda a interface e scripts de configuração.

---

## 📄 Melhorias na Geração de PDF

### 5. Correção de Transbordamento de Texto
*   **O que mudou:** Implementada quebra de linha automática (word-wrap) para os campos de **Observações**, **Condição** e **Faltas**.
*   **Benefício:** O texto agora fica 100% contido dentro das células da tabela, sem "fugir" para fora do documento ou cortar palavras.

### 6. Layout de Página e Cabeçalho
*   **O que mudou:** 
    *   O cabeçalho completo (Escola, Professor, Logo) agora aparece **apenas na primeira página**.
    *   Da segunda página em diante, o documento começa direto na tabela para economizar espaço e manter o foco nos alunos.
    *   **Ano/Turma:** Corrigido o alinhamento para que apareça abaixo do Professor, de forma organizada.

### 7. Alinhamento de Foto e Nome
*   **O que mudou:** Na coluna do aluno, a foto e o nome agora são empilhados verticalmente e **centralizados**.
*   **Benefício:** Visual profissional e simétrico, com a foto no topo e o nome logo abaixo, ambos centralizados no eixo da coluna.

### 8. Altura de Linha Dinâmica
*   **O que mudou:** A altura de cada linha do PDF agora é calculada dinamicamente baseada no maior conteúdo daquela linha.
*   **Benefício:** Bordas da tabela sempre alinhadas e fechadas corretamente, independente do tamanho do relatório de cada aluno.

---

## 🛠️ Detalhes Técnicos (Git Commit History)
As alterações foram sincronizadas no branch `main` com os seguintes commits:
1. `b363c54`: Refactor ATA: reorder Nível/LP, real-time preview, auto-grow, auto-save.
2. `d557872`: Fix PDF overflow: dynamic row height and text wrapping.
3. `e8c01af`: Fix PDF header: pagination and alignment.
4. `911b922`: Update default system year to 2026.
5. `287fb5c`: Fix PDF layout: vertical alignment for student column.

---
**Status:** ✅ Finalizado e Implantado.
