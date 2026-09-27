# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Procedimento para atender pedidos de titulares
> (responsáveis, equipe e, por meio do responsável, as crianças). Descreve o
> que o sistema já oferece e o que a equipe faz à mão.

---

## 1. Canais

- **No sistema:** página "Meus dados" (exportação e pedido de exclusão, com
  número de protocolo) e acompanhamento dos pedidos.
- **Fora do sistema:** `[E-MAIL DO ENCARREGADO]`, secretaria da escola.
  Pedido recebido fora do sistema é registrado pela administração como pedido
  do titular, para ter protocolo e prazo.

## 2. Quem pode pedir

- O próprio titular maior de idade.
- O **responsável legal**, pelos dados do filho (LGPD, art. 14, e Enunciado
  CD/ANPD nº 1/2023). Responsável com bloqueio de acesso por decisão judicial
  **não** exerce direitos sobre aquele aluno pelo sistema.
- Confirmar a identidade antes de atender: pedido pelo sistema já vem
  autenticado; pedido por e-mail precisa de confirmação `[PROCEDIMENTO]`.

## 3. Tipos de pedido e como atender

| Direito (art. 18) | Como atender hoje |
|---|---|
| Confirmação e acesso | "Meus dados" gera o pacote na hora (inclui os dados escolares do filho, para o responsável) |
| Portabilidade | o mesmo pacote, em JSON |
| Correção | contato e autorizações: o próprio responsável no portal; dado escolar: a secretaria corrige e registra |
| Eliminação | abre pedido com protocolo; a administração avalia. Dado com dever de guarda (histórico, notas, frequência, Censo) não é eliminado: é anonimizado o que for desnecessário (art. 16, I) |
| Informação sobre compartilhamento | resposta com base na lista de fornecedores |
| Revogação de consentimento | desmarcar a finalidade no perfil; o histórico de aceites fica registrado |
| Oposição / revisão de decisão automatizada | não há decisão automática sobre aluno; indicadores são de apoio |

## 4. Prazos

O sistema conta **15 dias corridos** a partir da abertura e marca os pedidos
vencidos. É um compromisso da escola: o art. 19 fixa esse prazo para o
direito de acesso. Para os demais tipos, `[VALIDAR COM JURÍDICO]`.

## 5. Passo a passo da administração

1. Abrir a fila de pedidos (`html/admin/pedidos-lgpd.html`).
2. Conferir identidade e legitimidade.
3. Mudar o status para "em análise" com observação interna.
4. Executar (exportar, corrigir, anonimizar) ou justificar a recusa.
5. Concluir com a resposta ao titular. Cada mudança fica no histórico do
   pedido e no `AuditLog`, por id.

## 6. Pendências

- `[DEFINIR]` quem na escola responde cada tipo.
- `[VALIDAR COM JURÍDICO]` modelo de resposta de recusa.
