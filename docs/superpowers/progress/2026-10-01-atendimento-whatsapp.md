# SDD ledger — plan: docs/superpowers/plans/2026-10-01-atendimento-whatsapp.md

Base 992e269, branch feat/atendimento-whatsapp-1144; cópia isolada, sem sobrepor checkout externo sujo.
Pre-flight: Task1 produz RPC crm_chat e bucket; Task2 consome mesmas ações/IDs/limites. Task3 valida os dois.

Task 1: complete — migration aplicada no projeto real, transporte existente identificado; teste domínio observado falhar sem módulo e passar após implementação. SQL rollback passou para duas carteiras/admin/anônimo, transferência, lease, envio idempotente, worker claim e recovery. Hub v11 usa RPC service-only com ordem de travas conversation→queue.
Task 2: complete — /whatsapp com três colunas e navegação responsiva; login/carteira existentes, mídia privada, voz, etiquetas/notas/finalização. Teste regressão preserva request UUID por usuário/chat após reload.
Task 3: in progress — revisão independente concluída; fix pass corrige quatro achados (disputa IA, transferência externa, chave incerta, preservação de papéis legados). Build e suíte completos verdes antes do último fix pass; verificação final/publicação em andamento.

Ruling: integrar fila já em uso em vez de trocar provedor — instância Linux observada com final1144 e v1.70.26; custo: depende da disponibilidade da VPS existente.
Ruling: atualização por polling (4s história, 10s lista) — nenhuma publicação Realtime legada necessária; custo: atraso de atualização limitado também ao sync da extensão.
Ruling: preservar leitura legada de papéis não vendedores — pedido restringe carteira de vendedores; custo: políticas históricas administrativas não são reformuladas.
Ruling: migrations com policies separadas por tabela — banco tem crons longos segurando locks; divisão evita deadlock e lock_timeout permite abortar sem alteração parcial. Arquivos locais alinhados às versões geradas pelo MCP para não reaplicar em db push.
Ruling: publicar via branch/PR após verificações — usuário autorizou terminar tudo; nenhuma confirmação extra para decisões rotineiras. Sem disparos a clientes durante QA.

Limitação prévia: tsc global contém erros em telas legadas de orçamento/motor; nenhum erro nos arquivos novos de chat. Build Vite e suite são os gates usuais do projeto.
