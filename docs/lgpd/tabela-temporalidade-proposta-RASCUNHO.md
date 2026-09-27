# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Proposta de tabela de temporalidade. A coluna "Hoje no
> sistema" foi conferida no código; a coluna "Proposta" é sugestão e depende
> da Secretaria de Educação e do arquivo público.
> **[VALIDAR COM A SECRETARIA DE EDUCAÇÃO]** todos os prazos.
>
> **Não apagar nada automaticamente** antes de esta tabela ser aprovada pela
> mantenedora.

---

| Documento / dado | Hoje no sistema | Proposta | Observação |
|---|---|---|---|
| Histórico escolar, notas, frequência | sem prazo, preservados | guarda permanente `[VALIDAR COM A SECRETARIA DE EDUCAÇÃO]` | pela LGPD, art. 16, I, não se elimina enquanto houver dever de guarda; o direito vira anonimização do desnecessário |
| Dados do Censo (cor/raça, deficiência) | sem prazo | conforme normas do INEP `[VALIDAR]` | |
| Cadastro de aluno que saiu da rede | anonimização manual, preservando vida escolar | anonimizar `[PRAZO]` após a saída | o `DELETE` não apaga mais |
| Contatos e dados dos responsáveis | enquanto houver vínculo | até `[PRAZO]` após o fim do vínculo | |
| Autorizações e documentos da família | versões preservadas, sem prazo | vínculo + prazo prescricional `[VALIDAR COM JURÍDICO]` | o documento é prova da manifestação do responsável |
| Fotos de aluno | removidas na troca e na anonimização | remover ao fim do vínculo | |
| Registro de auditoria | 365 dias (TTL), só inclusão | manter ≥ 6 meses (Marco Civil, art. 15, se aplicável) | aviso de privacidade deve dizer 365 dias, não "permanente" |
| Conversas do chat direto | sem prazo (`CHAT_RETENCAO_DIAS` desligado) | `[PRAZO]` | ligar a variável quando decidido |
| Conversas com o assistente da escola | 90 dias (`IA_RETENCAO_DIAS`) | manter | |
| Conversas com o assistente do portal | 180 dias | manter | |
| Pedidos do titular | sem prazo | `[PRAZO — VALIDAR COM JURÍDICO]` | prova do atendimento |
| Contas inativas | 12 meses: responsável sem vínculo ativo anonimizado, equipe desativada | `[DECISÃO DA MANTENEDORA]` | configurável por `ANONIMIZACAO_INATIVIDADE_DIAS` e `ANONIMIZACAO_EQUIPE` |
| Tokens revogados, bloqueios de IP, contadores de acesso | expiram sozinhos | manter | só segurança |
| Áudio de narração em cache | 30 dias | manter | |
| Importação de alunos (prévia) | 2 horas | manter | |
| Backup | desconhecido | `[DEFINIR]` | confirmar o tier do Atlas; o M0 não tem backup automático |
