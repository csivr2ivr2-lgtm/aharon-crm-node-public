# AHARON CRM NEXT — checkpoint 2026-10-20

This is a development checkpoint, NOT a final release. M0–M7 are not complete.
No merge to main, production deployment or production smoke test was performed.

## Repository
- Work branch: feature/aharon-next-complete-20261016.
- Verified starting HEAD this continuation: 7ab433b46d1d599337ba118e0bfc100b03050ab9.
- Verified main: 69bad92c6cb3c2586c4662adf9f485c32e4855f7.
- Latest implementation/test commit before this document: 2e2767ad716cc13f4b37207aadd1e5886e872241.
- All repository changes used GitHub MCP Repo. Local files are test mirrors.

## New work
- 75e51ec: Gmail HTTP authentication, origin, explicit confirmation, server-derived account and scope tests.
  Bind the Gmail confirmation dialog to the conversation originally opened.
- c43f2cb, 3786af4: additive client_resource_links schema and authenticated API;
  explicit manual links from synchronized Drive/People/primary Calendar panels to a client.
  Transactional audit, duplicate-safe linking, one client per provider/account/resource.
  Exact binary client/account/source comparisons. No fuzzy identity merge.
- 273f91f: real MySQL/MariaDB isolation, repeated migration, audit rollback and tombstone tests;
  Chromium confirmation/cancellation and axe at widths 360, 390, 768, 1440.
- 0bbc04d: explicit audited unlink, which removes only the local association;
  provider records are retained. Safe source links in client 360.
- 5955305, 4ec0ccd, 207fc96: read-only commitment candidate tool with exact client scope,
  rolling time window up to 168 hours, outgoing-message source IDs, bounded quotes,
  explicit uncertainty and untrusted-evidence instructions. Hebrew catalog prioritization.
  A failing prioritization test was fixed in implementation, not weakened.
- 852c35c: HTTP tests for unauthenticated resource operations, confirmation and scope revocation.
- 2e2767a: real SQL concurrent assignment race, wrong-client unlink rejection and provider preservation.

Files changed this continuation:
src/browser.js, src/server.js, src/client-resource-links.js,
src/ai/actions.js, src/ai/tool-catalog.js, src/ai/commitment-candidates.js,
test/mail-content-http.test.js, test/client-resource-links.test.js,
test/commitment-candidates.test.js, scripts/check-inbox-browser.mjs,
scripts/check-inbox-sql.mjs, this checkpoint.

## Mail work since the October 19 checkpoint
The old checkpoint's statement that downloads/HTML are unbuilt is superseded:
- Bounded MIME attachment downloads resolve account/message/conversation server-side,
  reject identity/metadata mismatches, use read-only IMAP with UIDVALIDITY validation,
  and force safe download headers. MAIL_ATTACHMENT_DOWNLOADS remains false by default.
- Strict allowlist HTML sanitization is persisted and repeated at serving; preview uses
  a sandboxed iframe, no remote images or active links. MAIL_HTML_PREVIEW remains false.
- Historical Gmail ingest retains attachment metadata and sanitized HTML.
- HOSTINGER_FOLDER_SYNC (false by default) enables bounded continuous multi-folder
  reconciliation with acknowledged checkpoints, optimistic conflict checks and replay safety.
- Gated per-message Gmail read/unread/archive/inbox/star/unstar uses explicit confirmation,
  verified gmail.modify scope, fixed action allowlist and audit. Local state awaits sync.
- The SQL fixture variable collision from CI 162/163 was fixed in f7439fa.

## Verified evidence
- Local Node 24: full npm test: 480 passed, 0 failed/cancelled/skipped.
- Syntax: 174 source files, 0 failures. Heuristic secret scan: 172 files, no findings.
- CI #174 (7ab433b): all eight jobs successful:
  https://github.com/csivr2ivr2-lgtm/aharon-crm-node-public/actions/runs/39446356008
- CI #178 (273f91f): all eight jobs successful, including new SQL/browser resource-link tests:
  https://github.com/csivr2ivr2-lgtm/aharon-crm-node-public/actions/runs/39447568985
- CI #182 (207fc96): all eight jobs successful after commitment test fix:
  https://github.com/csivr2ivr2-lgtm/aharon-crm-node-public/actions/runs/39448169588
- Eight jobs cover npm ci + Node 20/22 regression, real MySQL 8.0 and MariaDB 10.11,
  Chromium/axe RTL/mobile, owner memory, production-dependency high+ audit and heuristic secrets.
- Later commits and this document require their own latest HEAD CI verification.
  Prior green results never certify newer changes.
- Browser tests use synthetic HTTP data; connector tests do not constitute live provider QA.

## Known limitations / remaining work
- M0–M2: complete media/reactions/edits/retry coverage and live WhatsApp testing remain.
  All real WhatsApp sessions remain untouched/disconnected.
- M3: full provider draft lifecycle, custom labels and spam/trash workflows,
  Watch/PubSub infrastructure, authorized live Gmail acceptance remain.
- M4: REST entitlement, full provider search/write lifecycle, expunge/move and
  multi-folder-location semantics, authorized live Hostinger acceptance remain.
- M5: source linking is manual owner attribution, not independent identity verification.
  Provider scope is checked on every read; unavailable records return no cached payload.
  Provider caches are last synchronized observations, not live permission probes.
  Background/multi-calendar sync and further customer workflows remain.
- M6: commitment detection is heuristic, NOT semantic understanding or proof of a promise.
  Negations/quotations may be candidates; completion is unknown, task creation still
  requires existing approval. Full Hebrew semantic/hybrid retrieval, contradiction
  handling and live-model scenario evaluation remain.
- M7: broader performance/manual accessibility checks, restore rehearsal and production QA remain.
- Release is blocked: no verified current production backup/restore capability,
  deployed SHA or authenticated production smoke evidence. Earlier Hostinger browser
  restriction was not bypassed. No claim of successful production release.

Provider flags remain off by default pending authorized validation. No OAuth scope was
expanded, no customer message was sent, no production data or WhatsApp auth was changed.
The user's conditional merge authorization remains valid; do not request it again merely
because a PR form exists. Merge only after ALL required quality and backup gates.
