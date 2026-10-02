# CRM closure gate for the existing Ana engine

The live engine is maintained outside this repository. `crm-closure-v254.patch` is the surgical patch against the retrieved production version 254, package `ezbr_sha256` `924eb15c581851a6e70c80a7aff7cf9c2e3795d7706007ca7affe953f3d3938f`. `crm-gate.ts` is its added relative dependency. Existing shared-secret authentication and simulation/sandbox isolation are preserved; `verify_jwt` remains false as in production.

Before applying, retrieve the live function and compare its version and full original content with the reviewed baseline. Apply the patch to that baseline, include `crm-gate.ts`, validate TypeScript syntax, and deploy both files through the Supabase deployment tool. A changed baseline requires review and rebase; do not replace it with an older copy. The migration providing `crm_ana_automation_gate` must already be applied.

The gate runs before ANA activation or response processing and per contact during cadence. Database and VPS guards cover late producers and responses generated before a closure. Cancellation paths now preserve human CRM requests. Transport test: set `CRM_ANA_EDGE_SOURCE` to the complete patched entrypoint and run `node --test tools/vps/cloud-ana-gate.test.cjs`; helper tests run with `npm test`.
