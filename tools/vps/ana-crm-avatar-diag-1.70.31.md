# ANA avatar diagnosis 1.70.31

Existing production metadata showed 202 ANA contacts, all LID chats, with 175 unchecked profiles and no new avatar cache result in 24 hours. The actual authenticated pending lookup returned HTTP 200 and 15 pending contacts. Edge POST logs also returned HTTP 200. This establishes an active integration, but does not establish why the WPP full-picture getter returns no uploadable result.

This temporary instrumentation preserves the existing full-picture lookup and original cache payload. ANA batches expose only counts, safe whitelisted error classes/codes, HTTP statuses, checked/saved counts, phase and timestamps through diag.avatar in the existing heartbeat. No phone, contact ID, URL, cursor value, raw error message or client content appears in this diagnostic. Other sellers retain the existing array result and upload behavior.

Up to three missing full-picture results per batch are observed using the official thumbnail getter. When the official local LID mapping supplies a distinct confirmed phone Wid, the corresponding full/thumbnail getters are also observed. Each probe is bounded to 750ms and the combined probe budget is 6 seconds. These probe URLs never enter the upload payload. Original undefined/errors remain omitted, while original explicit null remains authoritative under the existing pic_checked contract. No profile lookup outcome has been inferred from mocks.

Four new actual-function VM tests fail against unchanged 1.70.30 and pass against 1.70.31. All 42 transport/live/avatar tests pass. Syntax checks and remote ValidateOnly pass. Applying the zero-context diff to the exact fresh baseline reproduces all four candidate hashes byte-for-byte. Credential scanning of the committed artifacts passes. Full legacy sources stay outside Git.

```powershell
$env:CRM_EXT_DIR = 'C:\path\to\candidate'
node --test tools/vps/crm-live.test.cjs tools/vps/crm-media.test.cjs tools/vps/crm-avatar-diag.test.cjs
./tools/vps/deploy-ana-crm-avatar-diag-1.70.31.ps1 -ExtensionDirectory $env:CRM_EXT_DIR -ValidateOnly
```

The dedicated deployment script verifies all four old and staged hashes before modifying only /opt/branorte/ext-ana. It creates a private backup plus original owner/mode metadata, publishes atomic replacements with the manifest last, and preserves the connected phone session. It does not restart a container, send messages or change other sellers. Parent-agent review is required before publication.

| File | Baseline 1.70.30 SHA256 | Candidate 1.70.31 SHA256 |
| --- | --- | --- |
| background.js | bb686623ba71884f6c676ddcddcef0332f41641dbd39d90a06e64f9ed1a1c15d | c9f9dfcc1d4a82d502020d33228a6a5ae0d5decd34fdf826859e3a39ea9e17d3 |
| bsb-detect-chat.js | f1c940740cfa386b987bb324f809bfa9ddb240bfd315fae962c66cbc1fe14c21 | 3744778303623a43d12740728ce3d78db230af5a6d955b5f0e424a3ecde7c2d6 |
| painel-worker.js | db975b9dd88d27ed606984c5b24ae1562b819303d0dae14508d14c74e8fec952 | f4c06a73d55141cc9d042515941568a3bd00d72730748c10a1bd941ab16deab6 |
| manifest.json | 7dc18c91ce2eff62ca5116c06285dca2e242e9413b7d3120f4edffe591488abe | bf94cec6e225529cce31974b0fd611394285ec654a39b1447e5dac55c8eb4936 |

Rollback restores all four original backup files, applying the saved live mode and ownership from metadata.txt, with the manifest last. Private backup mode600 must not replace live mode 644. The wrapper version remains a comment recognized by the existing guard; no duplicate global constant is declared.

Preparation and review were completed before publication. There were no remote changes during preparation; no forced reloads, phone resets or real test messages were performed.

Official getter semantics: https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/contact/functions/getProfilePictureUrl.ts and https://github.com/wppconnect-team/wa-js/blob/v4.4.3/src/contact/functions/getPnLidEntry.ts . Full getter returns imgFull; thumbnail getter returns img. The diagnostics distinguish those outcomes before any fallback change is considered.

Publication was reviewed and authorized on 2026-10-02 UTC. The deployment run started at 10:32:29 UTC and completed by 10:32:59 UTC. Backup: /opt/branorte/backups/crm-media-1.70.31-20261002T103229Z-6eb33beb. All four published hashes match the candidate table. The latest heartbeat at 10:32:30 UTC still reported 1.70.30 during the normal automatic-update window; the automatic updater was allowed to complete naturally. No restart, phone reset or real test message was performed.

Runtime confirmation: heartbeat 2026-10-02T10:36:17.417Z reported client_version1.70.31, auto-update ok and WPP ready=true. The first observed batch ran10:35:47.885–10:35:48.752 UTC (15 contacts in 0.87s): lookupHTTP 200, full_url=0, undefined=15, null=0, exceptions=0, timeouts=0. Thumbnail probes=3/unknown=3; confirmed-PN probes=3/unknown=3; no probe errors. No upload was attempted (phase no_photos). This rules out a thumbnail-only or LID-only explanation for those observed probes; it does not prove that profiles have no photo. The container remained running with restart count=0 and original start time, mounted hashes and mode 644/originalowners verified.
