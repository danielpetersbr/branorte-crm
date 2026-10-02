# ANA quoted reply transport 1.70.33

The server owns authorization and selects reply_msg_id/reply_from_me from a real ANA history message in the same conversation. The queue passes those nullable fields through the existing hub select('*'); no hub change is needed. Its request envelope must remain immutable, including the quote. The resident validates the quote against the actual WhatsApp model, same remote chat and optional fromMe, then passes its real serialized ID as the official quotedMsg option. Hashes are never expanded into guessed keys.

Full serialized IDs use official getMessageById and can hydrate an older message directly. A short hash is resolved from the actual MsgStore or one bounded fetch of 100 recent messages in that chat. If no real key is found in 8 seconds, the row fails visibly before sending. This is an explicit limit for old short-hash messages outside the available model/history window. It does not send silently without context. Quote failures cannot degrade to unquoted text, including LID fallback. Media keeps the existing image/audio/video/document send path and PTT/media limits. Quoted text uses the resident singleflight cache and confirmed upload result, preserving exact WPP IDs. Existing uncited text and other sellers retain their paths; version 32 photo capture is unchanged.

Nine new VM tests fail against 32 and pass against 33, covering exact keys, hash hydration, cross-chat/fromMe mismatch, invalid/missing quotes, text and four media types, no silent fallback, timeout with no late send, singleflight and queue propagation. All 62 transport/live/avatar/author/reply tests pass. Syntax checks, remote ValidateOnly, exact four-file diff reconstruction and credential scans pass. No real client message was sent; full private sources remain outside Git.

| File | Baseline 32 SHA256 | Candidate 33 SHA256 |
| --- | --- | --- |
| background.js | 1374d8367e58ecac516f55c1ed8211b8c59854d776481a83fe01c6aeeb9ea068 | e9f423e06012681b9c00687811708a604c6b52be219aa0ae1bbb0a52a65fd2e9 |
| bsb-detect-chat.js | b4220f18e217da7a99b0056df7fa9e09ac45ef5150db51f5e616c81464a67306 | 37a986223cf22b90041c25aa620c9fd7b0602aa1e209c0451735896a4e2313c3 |
| painel-worker.js | ec1a1c31355265b313bd63d22f7aab44c78b3a179d8ea4391f0630bc85d2d4c8 | 240c981353fc78301f700847e82ca67cb73824bf3e290d5ba13899c411f96eef |
| manifest.json | f679e885a812bd2d81a8513bcd79ad7216d82771dab1dcec8415fa0326bf7e4d | 5eb0126492103771040156359e9abc043de263192a0029aece4c256b4e0f9223 |

Apply the zero-context patch to the exact 32 baseline with git -c core.autocrlf=false apply --unidiff-zero. Run node --test tools/vps/crm-live.test.cjs tools/vps/crm-media.test.cjs tools/vps/crm-avatar-diag.test.cjs tools/vps/crm-avatar-fallback.test.cjs tools/vps/crm-message-author.test.cjs tools/vps/crm-reply.test.cjs with CRM_EXT_DIR pointing to the private candidate. The dedicated deployer supports -ValidateOnly and retains strict known-host validation, fresh preimage/staged hashes, private backup with metadata, atomic four-file replacements and manifest-last order. It targets only /opt/branorte/ext-ana and does not restart/reset the phone.

Rollback restores all four old files with live mode/owner from metadata.txt and publishes manifest last; never propagate backup mode 600 onto live mode 644.

Published on 2026-10-02 after root review, production productivity SQL deployment and explicit root authorization. Fresh baseline 32 and all four staged/final hashes matched. Backup: `/opt/branorte/backups/crm-media-1.70.33-20261002T120621Z-a04690ea`. Mounted `/ext` hashes match the candidate table; original mode 644 and ownership were preserved. The ANA container remained running with restart count 0. No reset, restart, real client message or other seller change occurred. The normal updater detected version 33 and completed its 60-second copy-stability guard. The existing ANA heartbeat at **2026-10-02 12:09:21.129 UTC** confirms **background 1.70.33**, **resident 1.70.33**, **WPP ready=true** and number final **1144**. This proves runtime activation and connectivity; quoted delivery was verified offline with real-source mocks, without a production client message.

Primary official sources (WA-JS 4.4.3):
- https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/chat/types.ts (quotedMsg option shared by text and file)
- https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/chat/functions/prepareRawMessage.ts (validates a real message model and prepares reply context)
- https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/chat/functions/getMessageById.ts (serialized key and official search-context hydration)
- https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/chat/functions/getMessages.ts (bounded chat history lookup)
