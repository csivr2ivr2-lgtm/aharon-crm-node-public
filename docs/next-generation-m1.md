# Next-generation CRM: milestone 1 (draft, 2026-10-14)

Base inspected: `main` at `8e71ac7bab53e84e0fbfd6fb980d0185e6a64dec`.
This is the first implementation milestone, not completion of the full next-generation brief.
CI database compatibility passed; do not merge/deploy until production-sized performance and live-channel gates below pass.

## Findings and implementation

- `listInboxWork` previously enumerated conversation IDs and sorted only matching
  rows in the scanned subset. A recent message in a later ID batch could be absent.
  Default is now `sort=time`, `view=inbox`. Main Inbox includes personal/unknown,
  business, outgoing and review conversations, excluding high-confidence noise;
  dedicated task views and All remain available.
- New `inbox-time-pages.js` records immutable conversation/message membership in
  MySQL using `ROW_NUMBER() OVER (ORDER BY m.sent_at DESC,c.id DESC)`, globally before
  pagination. An opaque versioned cursor tracks snapshot and ordinal. Incoming,
  outgoing and late-arriving messages cannot shift already-created membership.
  Refresh starts a new snapshot, displaying new activity. The browser retains DB
  order instead of re-sorting time pages. Workflow/classification content is read
  live, not frozen; intentional deletion/merge/filter edits can affect visibility.
- Snapshot tokens expire after 15 minutes and are bound to filter identity.
  Expired/changed-filter cursors produce explicit refresh errors. The previous-visit
  date is frozen on page creation. One expired set is cleaned per new snapshot.
  No customer/message records are deleted. Snapshot tables store IDs, not bodies.
- Removed RFC-message-ID deduplication across distinct conversations/accounts in
  the API and browser. Existing provider/account message-ingestion deduplication
  remains unchanged. A copy in two accounts must not hide either account's thread.
- WhatsApp replies no longer require an incoming message; the existing conversation
  supplies recipient and source account. Email replies still require an incoming
  message to construct reply headers. Inactive/unidentified accounts are rejected.
  New-message composition already existed and uses the existing approval engine.
- Connector send requires a provider message ID. Missing acknowledgment and socket
  exceptions do not trigger an automatic retry; the existing durable send claim
  retains its uncertain outcome. This does NOT prove remote delivery/read status.
- WhatsApp text is extracted from supported wrapped message content. Reaction and
  protocol traffic are retained as typed events; they do not increment unread,
  advance the meaningful clock or enqueue reply-generation work. Inbox queries
  exclude them from latest-message selection. Historical untyped events cannot be
  automatically reconstructed by this change.
- Invalid/nonpositive/far-future WhatsApp timestamps retain content with the epoch
  sentinel and `timestamp_review` classification instead of aborting the batch or
  promoting a false current-time event. Review explains the invalid timestamp.
- Stale socket events are ignored. A failed item no longer aborts subsequent batch
  items. Ingestion failure still needs durable replay work; this is not a no-loss
  guarantee across process crashes.

## Root-cause boundaries

Confirmed from code: sampled sorting; needs-reply default hiding outgoing/other
human conversations; incoming-message precondition in WhatsApp reply; connector
success without provider ID; missing reaction/protocol event tagging.

`Connection Closed` alone does not identify why Baileys disconnected. No live
runtime log or linked-session test was performed in this milestone. Socket/session
lifecycle and infrastructure causes remain to be verified. Do not report this as
an end-to-end resolution of the observed production send failure.

## Architecture and remaining work

Reuse existing `ai/actions.js` approval/idempotency, `ai/context.js` bounded scoped
retrieval, `assistant-chat-history.js` persistent sessions, `ai/knowledge.js`
owner-approved shared knowledge, `ai/external-router.js` provider fallback and
cooldown, and existing jobs/audit infrastructure.

Remaining milestones / acceptance gaps:

1. CI has verified migrations twice, mixed collations, snapshot paging with inserts
   between requests, scope and expiry on MySQL 8 and MariaDB 10.11. Before release,
   verify the production database version, rollback, concurrent deletion and
   realistic production-sized fixtures. Window
   functions require MySQL 8+ or MariaDB 10.2+. Existing `idx_inbox_latest` supports
   per-conversation latest-message lookup; new tables use `(snapshot_id,position)`
   primary key and expiry index. Initial snapshot creation reads the entire matching
   set: benchmark latency, locking and storage before rollout. Priority sorting
   still uses the legacy scanned subset and is labeled as such in UI; it needs a
   persisted/versioned decision projection for globally consistent priority pages.
2. Authorized two-account live WhatsApp test (new send, reply, outgoing echo,
   disconnect/reconnect, uncertain result reconciliation). No live messages sent.
   Sent/Failed/Uncertain UI and durable replay/reconciliation are not complete.
   Realtime currently displays a refresh notice; this change adds a refresh button,
   not automatic replacement of an in-progress snapshot.
3. Account Intelligence: evidence-based internal identity, manual-name protection,
   revision history and reversible proposals. Not implemented by this milestone.
4. Context-aware structured classification and feedback/trusted-sender policies.
   Existing deterministic classification remains; no claim of semantic AI upgrade.
5. Independent owner/project/person/episodic/semantic memory, permission-scoped
   retrieval, contradiction/version handling and memory management UI. Persistent
   chat history alone does not satisfy these requirements. Not implemented here.
6. Reasoning/task model routing, bounded multi-step planning, explicit fact/inference/
   proposal outputs, cost controls and proactive suggestions. Existing tools/provider
   routing retained; new orchestration not implemented here.
7. Full RTL/mobile/accessibility/browser E2E, load/security regression, and authorized
   staging/production verification. Not performed against a live instance here.

## Validation evidence

- `npm ci --ignore-scripts --prefer-offline --fetch-retries=0 --fetch-timeout=15000`
  succeeded: 364 packages. Native dependency install scripts were not exercised.
- Existing suite initially passed 316/316 after the first send/event edits.
- Final milestone suite: 331/331 passing, no skipped/cancelled tests. Unit and
  mocked integration tests, NOT a live database or live-provider result.
- `npm run check`: 119 source files, zero failures.
- `git diff --check`: passed.
- `npm run scan:secrets`: nonzero, 3 pre-existing heuristic findings in unchanged
  `.env.example:43` and `test/external-router.test.js:6-7`. Synthetic/example markers
  were inspected without printing values. No findings in changed implementation
  files. Scanner gate is not represented as clean; review existing findings.
- GitHub connector secret scan could not run: GitHub Advanced Security is not enabled for this repository.
- Local MySQL/MariaDB server unavailable. Attempt to prepare an OS package index
  failed due to container permission limitations; no escalation or access bypass.
- GitHub CI for code commit `7c2e8d4596b1b417fa16065be04348d8c101668e`:
  all four jobs passed: Node 20, Node 22, MySQL 8.0, MariaDB 10.11.
  Run: https://github.com/csivr2ivr2-lgtm/aharon-crm-node-public/actions/runs/38563300821
  Database jobs exercise additive migrations twice, mixed collations, actual SQL
  time ranking, immutable pages under new inserts, outgoing activity, reactions,
  scoped/expired cursors, cross-account reply references and merge/split integrity.
  These are real isolated CI databases, not production or large-scale load tests.
- Browser gate could not launch locally because the Playwright Chromium executable
  is absent. No browser E2E pass is claimed.
- Production: no login, send, schema migration, merge or deployment performed.

New tests cover stable pages under concurrent arrivals, outgoing activity,
late messages/reactions, global order independent of conversation IDs, same RFC ID
in two accounts, exact page limits across filtered batches, cursor expiry/scope,
parameter binding, outbound-only replies, account restrictions, acknowledgment
failure, wrapped messages, stale socket batches and technical-event persistence.

## Migration and rollback

Take a verified database/runtime backup and rehearse on an isolated copy. Existing
startup migration creates `inbox_page_sets` and `inbox_page_members` additively;
there are no destructive CRM column/table changes. Test required SQL/window-function
support and mixed-collation installations before enabling this build. Snapshot
cleanup deletes only derived expired membership.

Rollback by restoring the previous application revision and restarting it. Retain
snapshot tables initially; old code ignores them. No reverse migration or customer
data restore is required solely for these additive tables. Their eventual removal
is an explicit maintenance operation after rollback verification. Reaction/technical
markers and preserved messages remain stored. No live rollback was performed.

## Continuation: owner memory and account label safety (2026-10-14)

- Added authenticated owner-only memory CRUD and a dedicated SQL table. Only the
  owner may create, edit or delete these explicit memories; inbound emails and
  WhatsApp content cannot author memories. Revision guards prevent stale edits.
  Delete removes the active database record (backups may still retain data).
- The assistant retrieves a bounded, query-ranked subset of manually entered
  memories, with source and timestamp, for signed-in dashboard chats. Memories
  are data only, never authorization for tools; no client facts are auto-promoted.
- The assistant UI offers a memory dialog with create/edit/delete controls.
  This is first-step lexical retrieval, not autonomous semantic AI memory.
- Existing account labels are marked manual during additive migration, and
  explicit account edits keep that flag. Connector ingestion only refreshes
  connector-managed labels and cannot overwrite owner-chosen names.
- New memory tests added. Production, browser and live-provider verification
  remain necessary. This does not complete Account Intelligence.
