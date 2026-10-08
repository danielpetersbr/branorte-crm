# Popup election polling correction

The deployed popup refreshed local counters every second and called the central-election HTTP endpoint on every refresh. One popup left open could produce 86,400 role requests per day. The correction keeps local counters on their existing one-second cadence, checks role immediately on open or seller change, and reconciles role once per minute. Concurrent role checks share one request. Every central request has a ten-second abort deadline. A manual claim or release forces a fresh authoritative check after an older role read completes; stale responses cannot repaint another seller or overwrite the post-mutation display.

Measured 24-hour window: 2026-09-30 23:16 UTC through 2026-10-01 23:16 UTC. `instancia-central` received 80,019 invocations, including 69,840 from the VPS. Eleven background workers at one request per minute would account for at most about 15,840 per day. The unthrottled popup path can explain the excess, although the logs do not establish the exact number of open popups. The popup correction reduces one continuously open popup from about 86,400 to 1,440 requests per day, plus its initial check and explicit actions. Counts are HTTP invocations, not unique clients or a guarantee of future totals.

All eleven VPS `ext-*` folders had the same original `popup.js` SHA256:

`8b301e30b0352a913f62e299a06a546cbda1ceedd0b6dff9b1d03b3dd31f8ea5`

Patched SHA256:

`d743454144effe0c56b8cd0dd104cf13b780997b6be5e392c93a27da6dc0a113`

The patch deliberately has zero context, so unchanged legacy credentials are excluded. Apply only after checking the original hash and backing up the file:

```sh
git -c core.autocrlf=false apply --unidiff-zero --check /path/to/popup-central-throttle.patch
git -c core.autocrlf=false apply --unidiff-zero /path/to/popup-central-throttle.patch
```

Verify the real patched file offline:

```powershell
$env:CRM_POPUP_FILE = 'C:\path\to\patched\popup.js'
node --test tools/vps/popup-central.test.cjs
node --check $env:CRM_POPUP_FILE
```

No background, manifest, automation cadence, central ownership or WhatsApp login is changed by this patch. An already open popup must be closed and reopened to run the new script. No container restart is required. Do not commit the original or complete patched legacy file because it contains existing credentials.

## VPS deployment evidence

Published at 2026-10-01 23:24:08 UTC to the eleven existing extension folders: alvaro, ana, daniel, eder, edilson-jr, gustavo, igor, jardel, lucas, pedro and ramon. Every original hash matched the expected baseline before replacement. Each original file was backed up and hash-checked under `/opt/branorte/backups/crm-performance-20261001/<seller>/popup.js`; backups are readable only by their owner. A verified staged popup was copied through a temporary file and atomically replaced each target. All eleven final hashes matched the patched hash above. Background and manifest hashes were checked before and after and remained identical. No containers were restarted. Already open popup windows retain their previous script until closed and reopened.

For rollback, restore the backed-up contents while preserving the destination file's permissions and owner. Backups have mode `600`; copying their metadata onto a normally `644` extension file can prevent Chrome from reading it. Verify the restored hash against the original above before reopening the popup.

## Windows rollout — 2026-10-08

The canonical Windows source and Daniel's existing 1.70.42 installation still had the original hash above. Both now have the reviewed patched hash. The original popups were backed up locally, file ACLs were preserved, and background/manifest hashes remained identical. No other installation, VPS worker, version, ownership setting or WhatsApp session was changed. An already open popup needs to be closed and reopened.

The existing offline suite reproduced six failures on the legacy file and passed all eight cases against the staged and reviewed candidate; the syntax check also passed. This prevents excessive role polling when a popup is open. It does not establish that a popup was open during the outage or that popup polling caused the REST 503 errors.
