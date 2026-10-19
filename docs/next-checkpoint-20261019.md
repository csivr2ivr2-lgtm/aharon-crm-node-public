# AHARON CRM NEXT — development checkpoint, 2026-10-19

This supersedes the current-state portions of next-checkpoint-20261018.md.
It is not a final release report: M0–M7 are not complete, main has not been merged,
and production deployment/backup/rollback have not been verified.

## Repository and current verification

- Branch: feature/aharon-next-complete-20261016.
- Main read through GitHub MCP: 69bad92c6cb3c2586c4662adf9f485c32e4855f7.
- This continuation began at e65ea36b50aa2b288eb5678681d531b775a06ef2.
- Latest implementation: c4362b9938c5bcf2b5e3d21f172225419e306f08 (attachment metadata increment).
- Prior validated M0–M7 baseline: 8ee311d74738d13df5c7feb6f01c32f864603827.
- All repository writes use GitHub MCP Repo; local copies are test mirrors.
- Local Node 24: 446 tests passed, zero failed/skipped; syntax checks passed
  for 160 files; heuristic secret scanning found no findings in 158 files.
- Verified CI #156 on 8d997c9:
  https://github.com/csivr2ivr2-lgtm/aharon-crm-node-public/actions/runs/39204503394
  All eight jobs passed: Node 20/22, MySQL 8.0/MariaDB 10.11, Chromium RTL/mobile,
  owner memory, dependency audit high+, secret scan.
- Subsequent callback tests and MIME thread changes require their own latest CI
  result; #156 alone does not certify those later commits.
- Local checks are not substitutes for live provider or production QA.

## Changes on October 19

- 8a0cbbf: serialize account credential writes; rotate consent generation;
  reject stale refresh callbacks and prevent an in-flight refresh from restoring
  a disconnected account. This changed code only: no real account was disconnected.
- 38f976c: tests for stale consent, disconnect races and storage failure recovery.
- 7bb88c2: replace fixed synthetic credential strings with random runtime fixtures.
  The secret scanner flagged the synthetic strings; its rules were not weakened.
- 8d997c9: require verified scopes before legacy Gmail read/send, Calendar read,
  Drive search and incremental sync; explicit Hebrew Gmail permission errors.
  An account with absent scope metadata fails closed rather than assuming consent.
- 848103f: test callback generation rotation and wrong-account consent rejection.
- 8ee311d: preserve MIME In-Reply-To as a threading reference when References is
  missing, share normalization across Gmail/IMAP, and retain message/parent IDs in
  the safe header allowlist. Test actual MIME parsing and reply encoding.

Changed source/test paths this continuation:
src/connectors/google.js, src/connectors/hostinger-mail.js, src/browser.js,
src/message-format.js, src/ai/inbox-headers.js,
test/google-token-persistence.test.js, test/google-permissions.test.js,
test/mail-thread-references.test.js.

## Delivered since the earlier checkpoint

- Drive changes/full pagination and People sync tokens with expiry recovery,
  atomic records/checkpoints, account isolation, removal tombstones and opt-in flags.
- Explicit Contacts consent bound to the selected Google account; incremental
  consent requests only the requested capability and previously granted scopes.
- Google cache panels reject responses belonging to a previously selected account.
- IMAP observations retain folder, UID/UIDVALIDITY, flags and unknown state.
  SMTP acceptance explicitly does not claim confirmed delivery.
- Audited AI reads for recent activity, exact linked client activity and overdue
  project tasks. Source IDs are returned; causes are marked unknown where unproven.
- Monthly work calendar with leap-year navigation and explicit undated records.
- Real SQL tests include legacy collations, repeated migrations, transactions,
  account/client separation, provider checkpoint conflicts and tombstones.
- Automated axe WCAG A/AA scans on inbox, assistant, conversation, work month and
  connector screens at four viewport widths; actual contrast violations were fixed.

## Still incomplete

- M0–M2: complete media/reactions/edits/retry coverage; live WhatsApp unavailable.
- M3: full attachment lifecycle, safe rich HTML viewer, Watch/PubSub, full mailbox
  actions/drafts UI and authorized live Gmail sync validation.
- M4: account-specific REST entitlement, continuous multi-folder flag reconciliation,
  full search/attachments and actual Hostinger Mail lifecycle validation.
- M5: explicit external Calendar/Drive/People links in client 360, background and
  multi-calendar sync. Current caches advance by explicit user-triggered pages.
- M6: full Hebrew semantic/hybrid retrieval and contradiction flows, complete
  commitment-to-task scenarios and live model evaluation.
- M7: broader manual accessibility/performance/health checks and restore rehearsal.
- Release: verified current backup and usable rollback, authenticated production QA,
  deployed SHA verification and merge remain outstanding.

GMAIL_INCREMENTAL_SYNC, GMAIL_WRITES_ENABLED, GOOGLE_CALENDAR_SYNC,
GOOGLE_DRIVE_SYNC and GOOGLE_PEOPLE_SYNC remain off by default pending authorized
provider/staging validation. No live messages, grants, session repairs, auth-file
changes or production mutations were performed. WhatsApp remains disconnected.
Hostinger browser access was blocked previously; no safeguard was bypassed.

The user's merge authorization remains valid, but does not replace quality gates or
backup evidence. Do not merge based solely on a green CI run.


## Attachment metadata follow-up — 2026-10-19

- fde692d: added safe, bounded MIME attachment metadata normalization and an
  additive MySQL/MariaDB table; binary content is never persisted to this table.
- 9bc982b: connected metadata to Gmail recent/history/incremental and IMAP
  recent/history ingest events, including replay-safe transactional persistence.
  Authenticated, read-only conversation attachment list is available in RTL UI.
- c4362b: real SQL integration test for repeated migration, provider replay,
  account isolation and no duplicate records.
- Local isolated functional assertions and syntax checks passed for new files.
- Latest branch CI (post c4362b) has NOT been independently verified; previous
  CI #159 reported green by the user was for an earlier commit.
- Downloading provider attachment bytes and rich HTML rendering remain unbuilt.
  The UI explicitly says only filenames/MIME/sizes are retained, and no download
  action is offered.
- No WhatsApp sessions, provider authentication files, live customers, or main
  branch were modified in this increment. No merge or production deploy.
