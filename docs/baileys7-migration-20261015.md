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
