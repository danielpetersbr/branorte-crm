# ANA live transport patch

`ana-crm-live-1.70.28.patch` updates the existing ANA extension from 1.70.26 to 1.70.28. It contains only the changed lines and their context; the legacy extension and its credentials must remain outside this repository.

Apply against the exact VPS baseline, keeping original line endings:

```sh
git -c core.autocrlf=false apply --check /path/to/ana-crm-live-1.70.28.patch
git -c core.autocrlf=false apply /path/to/ana-crm-live-1.70.28.patch
```

Validate the real patched files offline:

```powershell
$env:CRM_EXT_DIR = 'C:\path\to\patched-extension'
node --test tools/vps/crm-live.test.cjs
```

The tests execute the actual CRM transport block and resident-agent functions with controlled WhatsApp, storage, timer and HTTP boundaries. They cover incoming and cellphone outgoing events, duplicate and ciphertext handling, LID phone resolution, image thumbnails, media model fallback and size limit, serialized queue wakeups, scope checks, retries, new messages during uploads, fragmented SSE, reconnect backoff, delayed central-role verification and restart after re-enabling ANA. They never connect to WhatsApp or send messages.

Deployment is scoped to `/opt/branorte/ext-ana`. Back up the four original files and verify their hashes before replacing them. Publish `manifest.json` last so the existing safe auto-update mechanism sees a complete version. Preserve the connected phone session and all other sellers' containers. The existing scheduled-message compare-and-set claim remains responsible for preventing duplicate sends.

Initial baseline SHA256:

| File | SHA256 |
| --- | --- |
| background.js | df07bf0535d159a8bfd6f08366c28be93048a1c3f5b63289ec312907b692a0da |
| bsb-detect-chat.js | b5dc0998e426015e24905df6ee8fed507977b556c0605cb1603918a95e86ae37 |
| wa-sidebar.js | 18b6b16cc1490e30ad509b96fa428a5d97d30a4bcbd46c4fc750a6dc93bd4279 |
| manifest.json | f433dbe3895e1a914feba6b6b13a8d050bf825c7ed0de80e300c60d3ea8287ca |
