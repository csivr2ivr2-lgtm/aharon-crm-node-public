# Baileys 7.0.0-rc14 — isolated migration candidate (2026-10-15)

This branch is **NOT DEPLOYABLE YET**. The Node dependency was changed from 6.7.24 to 7.0.0-rc14, the latest npm dist-tag as checked on 2026-10-15. This is a major breaking-change prerelease.

## Mandatory gates before moving to main
1. In a trusted Node 22 environment with normal npm registry connectivity, run `npm install --package-lock-only --ignore-scripts` followed by `npm ci`. Commit the generated lockfile **through GitHub MCP Repo**, not through other GitHub clients. Never modify a lockfile by hand.
2. Verify Signal key-store migration supports `lid-mapping`, `device-list` and `tctoken`, and that existing credentials survive reconnect without logout, deletion or unexpected QR pairing.
3. Run `npm run check`, `npm test`, `npm run scan:secrets`, and real MySQL/MariaDB SQL integration checks.
4. Verify two existing linked accounts, PN/LID mappings from message alternate JIDs, contacts, history and optional `lid-mapping.update`; verify incoming/outgoing delivery and that historical sender names render correctly.
5. Verify groups, newsletters and broadcasts remain excluded from the inbox, and that no old conversations are overwritten.
6. Only after all gates pass, copy the pinned package version, regenerated lockfile, tested mapping code and tests to main using GitHub MCP Repo. Confirm Hostinger deployment and connection status.

The initial CRM code fix was validated with six focused mock tests; those tests do **not** validate Baileys 7 compatibility or Production.

The official migration guide warns that LID mapping events are not guaranteed and PN may remain unknown. Use PN only if source data verifies it. Never infer PN from LID digits.

## Evidence and release state (2026-10-15)
- User-generated `package-lock.json` for `7.0.0-rc14` committed via GitHub MCP Repo as `d2a748409e396d91ae57d429ae5e625eac55a88c`.
- The uploaded lockfile is npm v3, 171,518 UTF-8 bytes, SHA-256 `00abb38e893d3566c44a71b377cce7ca719a89653584f1edae15edaf672359bb`. The root dependency and locked package are both `7.0.0-rc14`.
- Windows PowerShell npm install/ci succeeded on Node `v24.20.0`; `npm run check` checked 130 source files and found zero syntax failures; subsequent `npm test` passed **369/369**, including six WhatsApp identity tests and a revised cross-platform symlink security test.
- `npm audit --omit=dev --audit-level=high`: no High/Critical findings, **7 Moderate** findings involving transitive `sprintf-js`, `argparse`, `mammoth`, `roarr`, `global-agent`, `onnxruntime-node`, and `@huggingface/transformers`; do not run `npm audit fix --force` because it proposes a breaking mammoth downgrade.
- GitHub Actions CI push trigger expanded on this branch to include `upgrade/baileys7-lid-20261015` (commit `24359efea6e74fd80a618fd09dbd6e1a79306295`). **CI run outcome NOT verified yet**: confirm green Node 20, Node 22, audit, secret-scan, MySQL 8 and MariaDB 10.11 jobs for the exact latest commit.
- **NOT DEPLOYED:** existing WhatsApp production sessions have not been migrated or tested against Baileys 7. Use a securely backed-up test session; never delete/re-pair live sessions or send actual messages without explicit consent.
- Main advanced independently to `463d795513394b1aa27133c8c60ca48dcd1b10a4` during this work (AI improvements). Before integration, rebase/reconcile using GitHub MCP Repo only, preserving all main changes.
