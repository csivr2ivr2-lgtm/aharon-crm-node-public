# Public mirror note — 2026-09-27

This repository, `csivr2ivr2-lgtm/aharon-crm-node-public`, is the public mirror created from the validated private source repository. Its visibility is **public**. The historical validation notes below describe the source repository at the time those checks were run. The public mirror's `package-lock.json` was regenerated from the same `package.json` using Node.js 20.20.2 / npm during mirror creation.

# Current audit — 2026-09-27

Reviewed the current GitHub `main` snapshot at `a73cb098c6284b111a5142fc39ff0b78a7365147` before making changes.

- `npm ci`: successful on Node.js 24.19.0 / npm 11.9.0. npm reported existing configuration-key and deprecated-package warnings; installation completed.
- `npm run check`: passed; 33 source files checked, 0 failures.
- `npm test`: passed; 14 tests, 0 failures.
- Legacy-removal audit: no PHP source files or obsolete search integration code/references found in the repository.
- `npm run scan:secrets`: 31 files scanned, 0 findings. GitHub's repository secret-scanning endpoint remains unavailable because Advanced Security is not enabled. The prior history scan recorded below covers the earlier commit range; the current HEAD only removes an obsolete connector file.
- `npm audit` was not rerun: the dependency lockfile is unchanged, and the previous audit recorded below reported 0 vulnerabilities after the `sharp` fix.

The stated Node migration and CRM functions are present in this `main` snapshot; this audit found no remaining code change required for the listed goals. Production database migrations and live Gmail, Hostinger Mail, WhatsApp, and browser UI checks remain unverified as described below. The source repository was private at the time of this audit.

# Validation — 2026-09-26

Base reviewed: `b05c9282515f9524fac24c55dd738670f8186846` on `main`.

- `npm install` and clean `npm ci`: successful after configuring CPU-only ONNX installation. The initial clean install tried to download optional CUDA binaries and failed through the build environment proxy; `.npmrc` now skips that optional download. `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` is also documented for the hosting build environment.
- `npm run check`: all application, test and script syntax checks passed; no legacy executable files or active bridge references remain.
- `npm test`: 14 tests passed on Node 24.19.0 and Node 20.20.2, including actual Fastify injection and MCP initialization/tool discovery. Database writes use controlled test doubles, not a live database.
- Local Qwen2.5-0.5B-Instruct, q4: downloaded into ignored runtime cache and produced a nonempty response on CPU on both Node versions, without external AI fallback.
- `npm audit`: 0 reported vulnerabilities after pinning the transitive sharp dependency to 0.35.4.
- Startup: `npm start` reached the direct database connection, then returned ECONNREFUSED against an intentionally unavailable local test database. Production migrations and SQL transactions still require verification against the deployment's MySQL/MariaDB instance.
- Secret checks: repository heuristic scanner plus detect-secrets scanned current source and all 18 existing commit diffs. Two detect-secrets keyword matches were reviewed: the `scan:secrets` script command and a historical `CHECK_ERROR` status literal. Neither is a credential. No actual secrets were detected. These scans are not a proof that every conceivable secret is absent.
- GitHub's targeted secret scanning endpoint was unavailable because Advanced Security is not enabled for this repository; it was not counted as a passing scan.
- Browser screenshot verification could not run: no local browser was installed and the browser download returned an invalid archive. Browser JavaScript passed syntax checks; manual UI verification remains necessary.

Live Gmail, Hostinger IMAP/SMTP, WhatsApp QR/session behavior and sending have not been exercised against real accounts. Their implementations are included, but production credentials, OAuth consent and actual provider connections are required before claiming end-to-end operational readiness. No test sent a real email or WhatsApp message.

The source repository's visibility was private when checked. This public mirror was created afterward because the connected GitHub MCP tools do not expose a visibility-update operation for an existing repository.
