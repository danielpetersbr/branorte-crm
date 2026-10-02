# ANA: arquivar ao finalizar no CRM — 1.70.36

Estado: candidato revisável; publicação aguarda autorização final. Atua somente na extensão ANA, mantendo mídias, citações, fotos, autoria e controle da versão 35.

O comando `crm_close` antes aplicava apenas a etiqueta. Agora aplica a etiqueta existente, valida novamente a geração e chama o arquivamento oficial. A API WA-JS pode retornar antes de o modelo mudar: o ACK exige `chat.archive === true`, identidade real da conversa e leitura válida das mensagens. Não apaga histórico nem marca leitura.

Uma nova fala local antes do arquivo impede a operação; chegada durante o arquivo, inclusive no mesmo segundo, dispara desarquivamento compensatório. A geração é conferida após a confirmação, antes de persistir `arq_ana_base`. Esse registro usa o mesmo guard do ciclo legado, preservando sua reabertura normal por nova fala.

Se houver reabertura manual durante a operação, a compensação guarda prova local do comando (ação, conversa e geração) antes de tentar desfazer o arquivo. Falha mantém a prova para o mesmo retry ou para um dreno ANA de até três registros antes da próxima fila; a limpeza exige confirmação real de desarquivamento. O dreno exige gate obsoleto, conserva arquivo/prova em permissão atual ou falha de rede e não atua em arquivos manuais sem prova. Um gate normal de fechamento/bloqueio posterior preserva o novo arquivo e descarta somente a prova antiga exata. As operações CRM e WhatsApp continuam separadas; verificações reduzem as janelas de concorrência, sem constituir transação distribuída.

Provas: **128 testes passaram** (105 regressões e 23 casos de arquivamento/recuperação); novos casos falharam antes da implementação. Sintaxe dos três JavaScript, `ValidateOnly` remoto e reconstrução dos quatro arquivos por patch com `core.autocrlf=false` passaram. Logs na raiz da tarefa: `outputs/whatsapp-ana-archive-tests.log`, `whatsapp-ana-archive-validate.log`, `whatsapp-ana-archive-red.log`, `whatsapp-ana-archive-final-gate-red.log`, `whatsapp-ana-archive-undo-retry-red.log`, `whatsapp-ana-archive-new-generation-red.log`.

Fonte primária: [WA-JS 4.4.3 archive](https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/chat/functions/archive.ts). O arquivo chama `Cmd.archiveChat`; o retorno imediato não é confirmação do estado.

| Arquivo | SHA-256 candidato |
| --- | --- |
| background.js | `675949f01eac380ea94bf7a46184bf7605a4c0297f2ebf863c1e64c9ab32d98f` |
| bsb-detect-chat.js | `ce00639170c5653b0caecb50dd4b978789a7a640966e5c7b886f6b8ef90dc1d4` |
| painel-worker.js | `15a2f384f27da1279a2c044bc5f8f069e98804e077f236becba298d03bdcd18a` |
| manifest.json | `494cb798927fa69a6905b22bbe786fc36edbde984eee275d0675a107af73b645` |

O deployer fixa baseline 35 e candidato 36, atua somente em `/opt/branorte/ext-ana`, verifica caminhos sem symlinks, salva quatro originais com metadados e publica atomicamente o manifesto por último. Atualização natural, sem reinício, reset de login ou envios. Reversão: validar backup, restaurar os quatro originais com owner/mode salvos e manifesto por último. Um baseline diferente interrompe a publicação.
