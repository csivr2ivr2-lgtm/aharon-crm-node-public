# AI CRM integration validation — 2026-09-27

Baseline GitHub main: `239306ba7d63fb9edc71fe6590bbd4e6f75823c8`.
Saved implementation checkpoints: `cef49b86fd4e9769847d7f1cb139ea2d63c72418`, `1dab8c2047ffd816189795f6430539ab2f24165d`, `af1d2747675954e59b2db529131d2c27f4b7cf64`.

- Clean installation succeeded with the existing CPU-only ONNX setup; added pinned `unpdf@1.4.0` (MIT) and `mammoth@1.13.0` (BSD-2-Clause).
- Syntax/legacy checks, automated tests, the repository secret scan and npm dependency audit were executed after integration. 110 tests passed with 0 failures; the secret scan checked 54 files with 0 findings; npm audit reported 0 vulnerabilities.
- Tests exercise real Fastify request injection and browser scripts in a controlled DOM VM; SQL/provider operations use controlled doubles. Real PDF and DOCX fixtures are extracted by their parsers in bounded worker threads.
- Covered: tool schemas/permissions, confirmation tokens/expiry, sender changes, parallel sends and draft reservation, uncertain send replay, client identity locking, incoming-message/job atomicity, stale draft suppression, prompt-injection examples, client isolation, spam feedback, typed source-evidenced suggestions, lifecycle relations, reminders, parser limits/path isolation, settings, job retries and connector onboarding.
- No real email or WhatsApp message was sent. No deployment or production database update was performed.

## External validation still required

- Run additive migrations against a backed-up copy of the deployment MySQL/MariaDB database. A live database server was unavailable in this environment; no live SQL migration test is claimed.
- Connect Google OAuth, Hostinger mailbox and WhatsApp and verify real send/receive/reconnect. Account credentials and OAuth consent are external prerequisites.
- Verify local model memory/latency and Hebrew output on the hosting plan, or configure an external provider. No new live-model quality benchmark was performed in this integration round.
- Verify rendered desktop/mobile layouts in a real browser. The automated UI checks validate rendering logic, escaping and routes, not screenshot appearance.

## Functional boundaries not claimed complete

- Hostinger has one active mailbox per deployment. Google supports multiple accounts. Message synchronization is bounded, not a full historical mailbox import; attachment ingestion is separate from manual CRM uploads.
- Calendar/Drive expose read-only connected methods through MCP; the central assistant does not yet retrieve live Drive document contents or calendars as part of automatic draft context.
- Cross-client conversations are excluded from customer draft retrieval. A separately reviewed, de-identified shared business knowledge corpus and automatic style learning are not implemented.
- Providers and retrieval are shared, while inbox SQL automation and the legacy task worker still have typed execution paths separate from the chat ActionEngine. A single unified action implementation for every background mutation is not complete.
- Deadline detection and source-grounded AI proposals exist, but full autonomous follow-up planning, unattended outbound follow-ups, comprehensive alias editing and multi-session persistent chat history are not implemented.
- File deletion is soft deletion; permanent physical purge is not exposed. Reversible file updates recover from handled database errors; a filesystem and database transaction cannot guarantee atomic recovery after process/host power loss.
- Prompt-injection defenses use bounded untrusted context, strict schemas, isolated retrieval and explicit policy/confirmation. Tests are regression evidence, not a proof that an LLM can never produce an unsafe suggestion.

Earlier notes below are historical and do not establish validation of the new features.

---

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
