# Pacote comercial pelo WhatsApp do vendedor

O modo `ia_config.ana_pacote_vendedor` muda somente o canal do pacote no atendimento da Ana sob a contingência comercial existente. A Ana continua identificando a necessidade e respeitando qualificação, dúvidas pendentes, controle humano, bloqueios e recusa. Depois de repasse confirmado, o vendedor recebe o pacote pelo dispatch já existente. Não altera pool, preço, catálogo, janela do vendedor, fila antiga ou prospecção.

Configuração: `{"v":{"ativo":true,"inicio":"ISO com timezone","fim":"ISO com timezone"}}`. Início inclusivo, fim exclusivo. `fim` omitido permite uso permanente; valor inválido, leitura falha, início ausente ou `ativo` diferente de `true` desliga o novo modo. Aceita a precisão de microssegundos do PostgreSQL. O prazo temporário solicitado para esta ativação é `2026-10-05T03:00:00Z`; o candidato não ativa configuração nem fixa datas no código. `activate-weekend.sql` é responsabilidade do integrador.

Não envia foto/vídeo/tabela ou valores pela Ana enquanto o modo estiver ativo. Preço pedido antes da identificação continua com a pergunta que falta. Consultas técnicas/humanas permanecem no fluxo existente. A proteção final também impede texto afirmando material enviado quando nenhum anexo será entregue e mantém números técnicos como 220 V e 300 kg/h.

Mantém as montagens dryrun que identificam o pacote do vendedor. Novos repasses não recebem `ana_pacote_pend`, e a Ana não fecha marca `equip_ana` para pacote que não enviou. O produtor especial Mini R1 e a propagação de suas marcas ficam suspensos nesse modo; marcas históricas não são removidas. Não cria A/B: a contingência já bloqueia os trabalhadores A/B e cadência.

## Reconstrução e revisão

Baseline: Edge `ia-atendente` v257, `index.ts` SHA256 `984421c7cf221e77fec3930913c24d32c02f07f002a2eb49e6d07f952a11c842`. `crm-gate.ts` SHA256 `66f423d70c999720046e0cd23faa93b782ec6a715f51a26b97aea671b7b5e794` e conteúdo permanecem iguais.

Snapshots privados ficam em `outputs/ana-seller-package-baseline/ia-atendente` e `outputs/ana-seller-package-candidate/ia-atendente`, fora do Git. `transformations.json` contém versão esperada, hashes e 14 substituições exatas, cada uma com `countExpected: 1`. Para reconstruir, verificar a versão e hashes do baseline, aplicar as substituições sequencialmente com contagem estrita e comparar bytes/hash com o candidato. Não retransmitir fontes completas ou mudar módulos adicionais. `ia-atendente-v257.patch` possui headers relativos `a/index.ts` / `b/index.ts` para revisão.

## Verificação

Testes executam funções, condições e spreads extraídos por AST do arquivo real em VM sem rede, banco ou WhatsApp. Usar `ANA_SELLER_PACKAGE_SOURCE` apontando para o snapshot. Baseline inicial: 9 testes, 7 falhas esperadas e 2 proteções legadas aprovadas. Suite final: 12 testes do modo; junto aos testes existentes de continuidade e gate do CRM, 37/37 aprovados. Logs em `outputs/ana-seller-package-red.log`, `outputs/ana-seller-package-red-final.log` e `outputs/ana-seller-package-green.log`.

```powershell
$env:ANA_SELLER_PACKAGE_SOURCE='<workspace>/outputs/ana-seller-package-candidate/ia-atendente/index.ts'
$env:ANA_CONTINUITY_SOURCE=$env:ANA_SELLER_PACKAGE_SOURCE
$env:ANA_ROUTING_IA_SOURCE=$env:ANA_SELLER_PACKAGE_SOURCE
$env:CRM_ANA_EDGE_SOURCE=$env:ANA_SELLER_PACKAGE_SOURCE
node --test tools/ana-seller-package/seller-package.test.cjs tools/ana-continuity/continuity.test.cjs tools/ana-continuity/continuity-regression.test.cjs tools/ana-routing/repasse-allowlist.test.cjs tools/vps/cloud-ana-gate.test.cjs
```

Reconstrução byte a byte e parse TypeScript sem diagnósticos também verificados. Não houve envio real nem execução de jobs. Falha de mídia na extensão do vendedor permanece uma limitação do transporte existente; este patch não prova entrega física ao cliente. Para desfazer o modo, desativar a configuração ou aguardar seu prazo, sem replay das filas antigas.

## Publicação e ativação

Publicado como `ia-atendente` v258 em 02/10/2026 às 20:33:26 BRT; a leitura posterior confirmou `ACTIVE`, autenticação preservada e ambos os arquivos idênticos ao candidato. SHA256 de `index.ts`: `a7f151fbdc8c7d42018d79ba72fd461698bc139c71b554bf1c0aa4d83582e3e1`. SHA256 do pacote publicado: `a2ca364f0eb3f935a9e7de929a80dd4bbceaaa792cfca6e03ce37b37a36ed78e`.

`activate-weekend.sql` inseriu somente `ana_pacote_vendedor` às 20:33:41 BRT, com início `2026-10-02T23:33:41.919182+00:00` e fim exclusivo `2026-10-05T03:00:00.000Z` (segunda-feira 00h BRT). A leitura seguinte confirmou o modo ativo, o pool de nove e MD5 da configuração de roteamento `df2169ad4e793643ea400505e336d99c`, sem alteração.

Verificação final do integrador: 45/45 testes dirigidos passaram, incluindo o prompt de rodízio nos dois modos; `npm test` do CRM passou com 1.488/1.488 testes. Logs `outputs/ana-seller-package-root-targeted.log` e `outputs/ana-seller-package-crm-suite.log`. O modo pode expirar sem depender de job ou deste computador. A publicação não disparou mensagens de teste ou reenvios.
