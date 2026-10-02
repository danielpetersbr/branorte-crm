# ANA CRM media permission hotfix 1.70.30

In 1.70.29, crmEnviarMidia tested envioTravado(chatId) without awaiting it. envioTravado is asynchronous, so its Promise was always truthy and CRM media returned cancelled before invoking the resident sender. The hotfix adds await and aligns the four version stamps. Text already used await and is unchanged.

The VM helper now uses the actual asynchronous contract. Against unchanged 1.70.29, two tests failed: dispatch never reached the agent, and an asynchronously permitted send was cancelled. Against 1.70.30, all 38 transport/live tests pass. The new regression test waits for an unresolved permission check, verifies false permits one send, and verifies true prevents another. Syntax checks pass for background, resident agent and wrapper.

The five changed lines are one await plus four version stamps. No queue, database, credential, WhatsApp session, ownership or other-seller behavior is changed. Full extension source remains outside Git. This fixes transport of media; it does not claim that a frontend/RPC error before queue creation is resolved.

Apply the zero-context patch to the exact 1.70.29 baseline:

```sh
git -c core.autocrlf=false apply --check --unidiff-zero /path/to/ana-crm-media-1.70.30.patch
git -c core.autocrlf=false apply --unidiff-zero /path/to/ana-crm-media-1.70.30.patch
```

Validate the real candidate without sending messages:

```powershell
$env:CRM_EXT_DIR = 'C:\path\to\candidate'
node --test tools/vps/crm-live.test.cjs tools/vps/crm-media.test.cjs
./tools/vps/deploy-ana-crm-media-1.70.30.ps1 -ExtensionDirectory $env:CRM_EXT_DIR -ValidateOnly
```

The dedicated deployment script retains the reviewed strict-host-check, preimage/staged hash verification, private backup and original file metadata, atomic replacements and manifest-last order. It targets only /opt/branorte/ext-ana and does not restart containers or reset the connected phone. Root-agent review precedes publication.

| File | Baseline 1.70.29 SHA256 | Candidate 1.70.30 SHA256 |
| --- | --- | --- |
| background.js | 58e487888a6f1f88c3141f72b1d384d5ae5cbb5c7a8001c4cd133b05c3ed10bc | bb686623ba71884f6c676ddcddcef0332f41641dbd39d90a06e64f9ed1a1c15d |
| bsb-detect-chat.js | 96b12a5a865067a5857b3a773e41dc9b30921963ca91d597fd59a46e6f77a088 | f1c940740cfa386b987bb324f809bfa9ddb240bfd315fae962c66cbc1fe14c21 |
| painel-worker.js | 315860b149a688899aee4ca85837a8b6cfa12913b1bfe93c4e6014862d8be215 | db975b9dd88d27ed606984c5b24ae1562b819303d0dae14508d14c74e8fec952 |
| manifest.json | 25a4b13694f2ac8b57ff7c9a0eda5db15b97d50a28f612e86e5e01f67e240e0e | 7dc18c91ce2eff62ca5116c06285dca2e242e9413b7d3120f4edffe591488abe |

Rollback restores these four original files from the deployment backup, preserving their original mode/ownership from metadata.txt and publishing manifest last. Backup file mode600 is intentional; do not propagate that private mode to the live extension.

Deployment was reviewed and authorized, then published on 2026-10-02 UTC (deployment run started at 08:51:53 UTC). Backup: /opt/branorte/backups/crm-media-1.70.30-20261002T085153Z-4f82b376. All four backup hashes matched the fresh 1.70.29 baseline. All four published hashes matched the candidate table on the host and the container's mounted /ext files. Original mode 644 and ownership were preserved. The ANA container remained running with restart count 0 and its original start time 2026-10-01T20:11:36.129357833Z. No phone reset, container restart or real test message was performed.

The automatic updater completed the natural 1.70.29 to 1.70.30 reload at 2026-10-02T08:53:29.623Z after its normal copy-stability window. The database heartbeat at 2026-10-02T08:54:30.916Z confirmed runtime and resident-agent version 1.70.30, auto-update state ok with no reason/error, WPP ready=true and central_off=false. No forced reload or container restart was needed.
