O patch `20261008-visita-obrigatoria.patch` acrescenta as duas marcações no cadastro da extensão do vendedor: `visitar` é **Pode visitar**; `visita_obrigatoria` é **É para visitar**. Marcar É para visitar marca também Pode visitar, e retirar Pode visitar limpa É para visitar. As duas flags ficam preservadas ao salvar outras informações, inclusive no autosave de interesse e em respostas GET/POST tardias.

O patch contém somente `wa-sidebar.js`, `wa-sidebar.css` e `wa-interface.css`. Foi aplicado sobre a fonte do vendedor e as cópias Daniel/compartilhada, preservando diferenças fora dos trechos alterados. A revisão do manifest e de `AGENTE_V` passou de 1.70.40 para 1.70.41. A instalação da Ana e o `ext_release` global foram preservados.

Na revisão 1.70.42, o rótulo passou a ser somente **É para visitar**, conforme solicitado. A lógica das duas marcações foi preservada.

Os testes executam as funções reais da extensão em uma VM, sem rede nem mensagens WhatsApp. Para apontar para uma pasta da extensão no PowerShell:

```powershell
$env:BRANORTE_EXTENSION_DIR = 'D:/MEGA BRAIN/Branorte/wa-sync-extension'
node --test tools/extension-patches/20261008-visita-obrigatoria.test.cjs
```

A migração `cliente_visita_obrigatoria` e a Edge Function `cliente-dados` precisam estar publicadas antes do código da extensão. Os testes de banco e handler usam Postgres descartável: `node supabase/tests/visita-obrigatoria.test.mjs caminho/node_modules`, com `@electric-sql/pglite` disponível nesse runtime.
