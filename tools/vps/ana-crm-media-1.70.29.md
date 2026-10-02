# ANA CRM media transport 1.70.29

This incremental patch applies to the exact deployed ANA extension 1.70.28. It contains changed lines only, without legacy credentials. Full source remains outside Git. The main patch changes background.js, bsb-detect-chat.js and manifest.json; ana-crm-media-worker-activation.patch adds the wrapper's build stamp in painel-worker.js. Sidebar and all other sellers are untouched.

CRM queue items retain their attachment when a phone number needs LID resolution. A failed attachment never degrades to caption-only text. Generic scheduled items retain their existing fallback. The compare-and-set claim, central-PC ownership check and ANA cadence filters remain unchanged.

The CRM sender uses one resident-page attempt per request ID and target, retains the returned WhatsApp ID and awaits upload completion. It records rejected or resolved ERROR_* uploads as failed. An ID without the upload promise also remains uncertain. A 45-second agent timeout becomes an uncertain failure without automatic retry: check WhatsApp before sending again. The cache protects overlapping calls within the same page; the database claim protects separate workers. The sender does not claim exactly-once delivery across page reloads or an interrupted external network call.

Image, audio, video and document types preserve their MIME and safe basename. Downloads have a 30-second deadline, reject declared or streamed sizes over 20 MiB and reject empty files. Incoming media also accepts up to 20 MiB: a declared or hydrated-model size over the limit prevents downloading; when WhatsApp omits size metadata, the returned Blob is checked before base64 conversion. Filename is included in history ingestion. Ogg bytes with an OpusHead header receive isPtt and waveform; WebM remains a regular audio attachment. The frontend recorder must actually encode Ogg/Opus to obtain voice-note behavior.

ANA avatar queries run before the snapshot-change gate, at most once per minute and only on the central PC. A single flight prevents overlapping batches, and lookup/network deadlines prevent a stalled request from stopping future refreshes. The cursor is persisted as crm_avatar_cursor_ana and sent as avatar_cursor on lookup requests. It advances before WPP lookup/upload even if every photo is unavailable; an empty batch resets it, and the next minute starts another pass. Queries omit thrown or undefined answers, preserving cached photos. An authoritative URL or explicit null receives pic_checked:true. Other sellers retain their original payload and behavior.

Backend prerequisites before deployment:

- wa_scheduled_messages.wa_msg_id and result propagation to crm_chat_outbox.
- wa_chat_messages.filename and the wa-sync-messages filename whitelist.
- wa-sync-avatars honoring pic_checked:true before clearing an absent photo, and ANA-only avatar_cursor ordered pagination.

Offline checks (no client messages or network calls):

```powershell
$env:CRM_EXT_DIR = 'C:\path\to\patched-extension'
node --test tools/vps/crm-live.test.cjs tools/vps/crm-media.test.cjs
node --check "$env:CRM_EXT_DIR/background.js"
node --check "$env:CRM_EXT_DIR/bsb-detect-chat.js"
node --check "$env:CRM_EXT_DIR/painel-worker.js"
```

The 37 tests use actual source functions in VM boundaries, including upload completion, ID propagation, CAS failure, LID behavior, missing files, uncertain timeout, MIME/filename, Ogg versus WebM, streaming limits, single-file inbound POST metadata, avatar outcomes/cadence/cursor advancement and the existing auto-update guard accepting the wrapper stamp without duplicate declarations.

Apply with original line endings. Zero-context diffs require --unidiff-zero:

```sh
git -c core.autocrlf=false apply --check --unidiff-zero /path/to/ana-crm-media-1.70.29.patch
git -c core.autocrlf=false apply --unidiff-zero /path/to/ana-crm-media-1.70.29.patch
git -c core.autocrlf=false apply --check --unidiff-zero /path/to/ana-crm-media-worker-activation.patch
git -c core.autocrlf=false apply --unidiff-zero /path/to/ana-crm-media-worker-activation.patch
```

Baseline SHA256:

| File | SHA256 |
| --- | --- |
| background.js | 544c8c55924dc153004252d28da09435f8468e5929494c88ad1f48631ccace6a |
| bsb-detect-chat.js | ed65bd0b92b2d6ed1c9efcf3399ee6263e5bda04462c48d192635f0c47a56735 |
| manifest.json | ea36bcf10005bbe25641192d4601a716fd66800541562a6b44b3a217ba8b7f0c |
| painel-worker.js | 27211abda0de6bea8fc85c2b413b5d02690f58dd7e5d52050bf0c00cc1b22d17 |

Deployment requires root-agent review and the backend prerequisites. Recheck the four remote baseline hashes; if any differ, stop rather than overwrite. Back up all four originals, stage only these files, verify staged hashes and publish manifest.json last. Preserve file readability and the connected WhatsApp profile. Rollback restores the same four original files and their readability, with manifest last. No restart, session reset or test message is part of this patch.

The prepared deployment script has fixed reviewed hashes and strict SSH host verification. Its ValidateOnly mode checked the current remote baseline without making remote changes. After root-agent review and backend activation:

```powershell
./tools/vps/deploy-ana-crm-media.ps1 -ExtensionDirectory 'C:\path\to\patched-extension' -ValidateOnly
./tools/vps/deploy-ana-crm-media.ps1 -ExtensionDirectory 'C:\path\to\patched-extension'
```

The script stages only the four files under /opt/branorte/staging/crm-media-1.70.29-<unique-tag>, backs up originals and metadata under /opt/branorte/backups/crm-media-1.70.29-<unique-tag>, verifies both preimage and staged hashes, preserves target permissions/ownership, replaces files atomically and publishes manifest last. Backup files are private (mode600); rollback must restore their original metadata from metadata.txt so Chrome can read them. Staging and backup paths are retained for review. ValidateOnly checked the original three-file preflight before deployment; the subsequent four-file script passed syntax validation. After successful deployment, the preflight deliberately rejects the changed baseline rather than republishing.

Deployment was subsequently authorized and completed on 2026-10-02 UTC, after the backend migration and wa-sync-avatars v7 / wa-sync-messages v15 activation. Backup: /opt/branorte/backups/crm-media-1.70.29-20261002T000001Z-3ea933a8. All three original backup hashes matched the baseline. Published hashes matched both the host files and the mounted /ext files inside wa-ana. Mode644 and original ownership were preserved. No container restart, phone reset or real test message was performed; all 11 WhatsApp containers remained running.

The first heartbeat exposed an activation blocker: the manifest names painel-worker.js as its service worker, but the old auto-update guard searched that wrapper for BG_VERSAO. The wrapper only imports background.js and had no build stamp. A separately authorized follow-up added one comment containing the same version, without declaring a JavaScript variable or changing its import/connection logic. The fourth original file and metadata were added to the same backup; original and published hashes matched on host and container. The guard then reported normal copy-stability waiting, replacing the earlier background_sem_carimbo error. Future releases must keep this wrapper comment aligned with background, resident-agent and manifest versions.

Published SHA256:

| File | SHA256 |
| --- | --- |
| background.js | 58e487888a6f1f88c3141f72b1d384d5ae5cbb5c7a8001c4cd133b05c3ed10bc |
| bsb-detect-chat.js | 96b12a5a865067a5857b3a773e41dc9b30921963ca91d597fd59a46e6f77a088 |
| manifest.json | 25a4b13694f2ac8b57ff7c9a0eda5db15b97d50a28f612e86e5e01f67e240e0e |
| painel-worker.js | 315860b149a688899aee4ca85837a8b6cfa12913b1bfe93c4e6014862d8be215 |

Primary sources for the actual bundled WA-JS 4.4.3:

- [sendFileMessage, supported types/PTT and upload result](https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/chat/functions/sendFileMessage.ts)
- [SendMsgResult error states](https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/whatsapp/enums/SendMsgResult.ts)
- [getProfilePictureUrl undefined outcome](https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/contact/functions/getProfilePictureUrl.ts)
- [prepareAudioWaveform only decodes and computes waveform](https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/chat/functions/prepareAudioWaveform.ts)
