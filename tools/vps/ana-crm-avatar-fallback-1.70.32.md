# ANA avatar recovery and message ID 1.70.32

Production31 proved that all 15 full-picture getters returned undefined, including three thumbnail and confirmed-PN probes, with HTTP 200 and no errors. Version32 reads the official ProfilePicThumbStore model for the confirmed chat Wid, accepting imgFull/img/eurl/previewEurl only when they are HTTPS URLs on whatsapp.net/fbcdn.net or proper subdomains, with no URL credentials. Cache misses may use official findQuery with a 3.5s deadline, at most 3 calls per 15-contact batch, then re-read the model/getter. PN fallback requires the official local mapping. Undefined, errors and empty strings cannot clear an existing photo. Other sellers retain their existing behavior.

Only safe source counts/capability flags are added to the existing ANA diag.avatar heartbeat. No URLs, phone numbers, contact IDs or raw exception messages are logged in this diagnostic. The queue also stores a nonempty confirmed result.wa_msg_id or result.id, preserving the exact WPP ID needed for seller attribution. Legacy messages without a request-to-ID relationship are not inferred or backfilled.

All 53 actual-source transport/live/avatar/author tests pass; essential new fallback cases failed against 31. Syntax checks, remote preflight, four-file exact patch reconstruction and credential scans pass. Full extension sources remain outside Git. Parent review authorized publication.

Published on 2026-10-02 UTC, run started 10:46:54 UTC. Backup: /opt/branorte/backups/crm-media-1.70.32-20261002T104654Z-52152b5d. All four published hashes match this table. Natural automatic activation and production saved counts are confirmed below.

| File | Baseline 31 SHA256 | Candidate 32 SHA256 |
| --- | --- | --- |
| background.js | c9f9dfcc1d4a82d502020d33228a6a5ae0d5decd34fdf826859e3a39ea9e17d3 | 1374d8367e58ecac516f55c1ed8211b8c59854d776481a83fe01c6aeeb9ea068 |
| bsb-detect-chat.js | 3744778303623a43d12740728ce3d78db230af5a6d955b5f0e424a3ecde7c2d6 | b4220f18e217da7a99b0056df7fa9e09ac45ef5150db51f5e616c81464a67306 |
| painel-worker.js | f4c06a73d55141cc9d042515941568a3bd00d72730748c10a1bd941ab16deab6 | ec1a1c31355265b313bd63d22f7aab44c78b3a179d8ea4391f0630bc85d2d4c8 |
| manifest.json | bf94cec6e225529cce31974b0fd611394285ec654a39b1447e5dac55c8eb4936 | f679e885a812bd2d81a8513bcd79ad7216d82771dab1dcec8415fa0326bf7e4d |

The strict deployment script verifies preimages and staged hashes, keeps private backups and original mode/owner metadata, publishes atomic replacements with manifest last, and targets only /opt/branorte/ext-ana. Rollback restores all four backup files with live permissions/owners from metadata.txt, manifest last; backup mode 600 must not replace live mode 644. No container restart, phone reset or real test message was performed.

Run tests with CRM_EXT_DIR pointing to the private candidate and node --test tools/vps/crm-live.test.cjs tools/vps/crm-media.test.cjs tools/vps/crm-avatar-diag.test.cjs tools/vps/crm-avatar-fallback.test.cjs tools/vps/crm-message-author.test.cjs. The combined32 patch applies to exact31; the separate author patch is already included and must not be applied twice.

Official API sources: https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/contact/functions/getProfilePictureUrl.ts , https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/whatsapp/models/ProfilePicThumbModel.ts and https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/whatsapp/collections/BaseCollection.ts .

Production proof: heartbeat 2026-10-02T10:50:03.589Z confirms runtime 1.70.32, auto-update ok, WPP ready=true. The first batch10:49:34.163–10:49:46.264 UTC read 15 contacts: all 15 full getters undefined, model_img=0, model_eurl=13, model_preview=13 and raw_eurl=13. Lookup/uploadHTTP 200, checked=13, saved=13. SQL independently confirms ANA cache grew27 to 40 photos with 13 checked/saved recently. This proves the current WhatsApp models expose usable eurl while the older WPP derived imgFull/img fields are empty. Three feature-checked hydration attempts raised safe TypeError and left the unresolved contacts pending; they did not clear cached photos or prevent 13 successful saves. Later batches continue automatically through the cursor. Mounted hashes, mode 644/originalowners and wa-ana running/restarts=0/originalstart were also verified. No real message was sent to validate attribution; its exact-ID contract is covered by offline tests.

Heartbeat 2026-10-02T10:51:03.730Z also confirms resident-agent version 1.70.32 in diag.call.agente.
