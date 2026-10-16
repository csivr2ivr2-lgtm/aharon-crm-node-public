# AHARON CRM NEXT — implementation log | 2026-10-16

Base main: 17dd75ac72c2dd7c92980dc4f5803dea65c66989.
Updated main directly through GitHub MCP Repo, without PR. No WhatsApp connection, re-pairing, sending, deletion or authentication changes in this increment.

## M3 — Gmail (partial)
- Authenticated GET /api/google/folders?account_id=... and an account-specific Hebrew folders/labels button.
- Uses existing read-only OAuth, official Gmail labels.list / labels.get.
- Selected system labels show provider-confirmed totals/unread counts; unavailable values remain null, not invented zeros.
- Still open: Gmail history.list cursor/watch, two-way flag changes and drafts (requires explicit expanded scope consent), reconciliation.

## M4 — Hostinger Mail (partial)
- Authenticated GET /api/hostinger/folders and a read-only folder browser for the configured IMAP account.
- Uses ImapFlow list/statusQuery, with fallback to list-only when the server does not support status queries.
- No flag mutations, moving messages, or messages sent.
- Still open: verify Hostinger Mail API entitlement, full folder sync, UIDVALIDITY/UID checkpoints, mark-read only after authorized permission.

## M5 — Client 360 (partial)
- Authenticated GET /api/clients/:id/overview and a Hebrew client detail panel.
- Directly linked conversations/projects/tasks/files/reminders/notes/activities only, with bounded results and explicit data provenance. No matching by similar name or partial phone.
- Added read-only Google Calendar upcoming events and Google Drive filename search per connected Google account, through GET /api/google/calendar and GET /api/google/drive-search, reusing current scopes and connector methods.
- Still open: Calendar/Drive change cursors and push, Google People Contacts, multi-provider identity reconciliation, paginated details.

## M6 — Operations summary (partial)
- Authenticated GET /api/insights/changes?hours=24 with validated 1–168 hour window.
- Home dashboard shows incoming/outgoing messages, task updates, new clients and links to underlying conversations.
- Deterministic CRM-only aggregation, NOT a generative AI answer. No external action or unverifiable delivery/read status claims.
- Still open: Hebrew semantic search, client/project-grounded generative briefing, contradiction handling and consent-gated automations.

## M7 — Current evidence and missing gates
- Seven isolated tests passed locally for the new pure services.
- Static syntax parsing passed for browser, server and connector changes.
- GitHub Advanced Security scanning API reported that Advanced Security is not enabled for this repo; passing results are not claimed.
- Full CI status, actual MySQL/MariaDB integration, live account checks, Hostinger deployment SHA and Production QA are NOT YET VERIFIED.
- No WhatsApp session or data mutation was requested or tested here.

## Next release gates
1. Confirm current main CI (Node 20/22, MySQL 8 and MariaDB 10.11, regression and secret checks).
2. Confirm deployed SHA in Hostinger and use authenticated read-only smoke checks for three newly added routes and dashboard.
3. Verify provider counts are correct or explicitly unknown and no cross-customer leakage exists.
4. Incrementally deliver Gmail change tracking and Hostinger folder checkpoints; never silently widen provider OAuth scopes.
5. Continue connected Calendar/Drive/People views and evidence-grounded Hebrew AI with human approval for outbound actions.
