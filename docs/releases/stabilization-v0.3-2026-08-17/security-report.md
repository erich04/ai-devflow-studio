# Stabilization V0.3 Security Scan

Status: **completed — no findings**

Scan ID: `026f692b-780a-4ba8-b726-26e8bb12c789`

Target revision: `1cb0482a9afe157c4e1dcdd7ae4e8026939f2b9d`

Started: 2026-08-18T04:11:13.782725Z

Completed and sealed: 2026-08-18T04:14:24.603160Z

Producer: `codex-security-plugin` 0.1.20

## Scope and result

This was a complete standard repository review of the fixed V0.3 candidate. It combined source
review with the focused security tests already bound to the candidate. Generated dependencies and
build output were excluded from source review and were verified independently by the package,
container, and artifact gates.

- Reportable findings: 0
- Coverage: complete
- Reviewed surfaces: 8
- Deferred surfaces: 0
- Open questions: 0
- Warnings: 0

The reviewed surfaces were authentication and browser sessions; Desktop bearer and pairing
lifecycle; tenant/project isolation; GitHub credential issuance and revocation; outbound source and
PR text disclosure; Electron IPC and local process execution; SQLite migration, privacy, and
durability; and PostgreSQL/container configuration. Every surface was recorded as
`no_issue_found`.

## Sealed artifact digests

| Artifact | SHA-256 |
| --- | --- |
| `scan-manifest.json` | `8103c8f5d577cf3171452801bf2191433d76f9ae3a1a8930dbe1656a907d0786` |
| `findings.json` | `afe5f238b35781c3d8d98b929a9207d6dc48675e6f2ab2565507238740b94793` |
| `coverage.json` | `541aafa1e887950d682c61f859dd1913d62c35e16ad3258425513f0d1527b291` |
| rendered `report.md` | `7b3e96cf26d7b4d32c4cb3bba13d0671e9dbf626593d55143dd1b269c89abe32` |

No secrets, raw provider output, local absolute paths, or generated artifacts are stored in this
repository record.
