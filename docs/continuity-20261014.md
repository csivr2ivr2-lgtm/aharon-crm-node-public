# Continuity checkpoint — 2026-10-14

Reference main: fefa53bc9e1bd881858c41a1c9dfeb704653e3ab. Rechecked before editing; no newer commits were present.

## Preserved work
The earlier local repo directory was retained. A separate MCP snapshot was used for changes. PR #7 was already merged; later main commits added PN/LID mapping, direct-chat filtering, history ingestion/progress/recovery diagnostics and owner memory. None were reverted. No production sessions or data were deleted.

| Area | Evidence at this checkpoint | Deployment |
| --- | --- | --- |
| Existing chronology, replies, refresh, channel filtering, dedupe, history requests and memory | Full release suite: 357/357 tests | Not verified live |
| Previous PR #7 | Seven CI checks successful on 2ad97349ce46ffb8f092ced043c4aa3ba382fddc, including MySQL 8 and MariaDB 10.11 | Merge verified, Hostinger not verified |
| Current WhatsApp changes | Regression tests below; syntax check 127 files, zero failures | Awaiting actual deployment evidence |

## Current WhatsApp changes
- A failed profile write no longer discards the actual message; history LID mapping metadata failures do not abort a chunk.
- Canonical phone JIDs cannot be replaced by a contradictory alternative PN.
- Both seconds and milliseconds retain valid chronological timestamps; invalid dates stay in review.
- A socket replaced during identity lookup cannot inject the stale message.
- History requests stay on the original socket and stop when it is replaced.
- A missing persistence acknowledgment counts as failure, never as a duplicate; recovery anchors remain available before successful storage.
- Updated two obsolete regression fixtures to current account-ID and shared channel-filter contracts.

## Validation and limits
Baseline: 349/352 passed. Two stale fixtures failed; the subprocess-crash test timed out under initial load but passed in isolation and subsequent full runs without weakening its assertion.
Release tree: npm test 357/357; syntax 127 files / 0 failures; git diff --check clean.
Heuristic secret scan: zero findings. npm audit high/critical gate passed; seven moderate dependency findings remain and were not force-upgraded.
No live WhatsApp message was sent. End-to-end delivery, full phone history coverage, current main Actions and Hostinger deployment are not verified.
The available GitHub MCP Repo tools expose check runs for PR heads, not arbitrary main/branch runs or Hostinger deployments. Local SQL could not run: no database service is installed and package installation failed due container permissions.
AI retrieval changes are developed separately and must pass their new real-SQL regression gate before main.

## AI continuation (validation branch)
The WhatsApp release was committed directly to main as ffef2a18368ac87b0cf34b61d75d879e50e1f1be after its 357 tests passed.

AI implementation builds on owner-memory.js, assistant-chat-history.js and the existing ActionEngine:
- Retrieval ranks all owner records before limiting candidates, rather than sampling the newest 200. Query terms are bound parameters.
- Inferences and temporary notes are separate owner-controlled kinds. Temporary notes stop participating after seven days; records are not deleted. Owner assertions are explicitly not presented as independently verified facts.
- Long chats display the latest 400 turns, and relevant older turns are recalled only from the same authorized session. Recalled text remains untrusted data with a separate character budget.
- Tools absent from the advertised catalog cannot reach the ActionEngine. Existing permission, confirmation and background-action fences remain.
- Recognized provider outages produce an explicit recoverable response instead of losing the conversational response. Disabled external-provider configuration still fails explicitly.
- Memory source IDs and evidence kinds are returned by the assistant service; a persisted/UI citation presentation is still outstanding.

Validation: full npm test 363/363 and bounded-concurrency run 363/363; new regressions cover old Hebrew decisions behind 230 newer records, expired notes, inference labels, 410-turn sessions and cross-session recall isolation, tool allowlisting and provider outages.
The SQL integration script now also checks old-memory retrieval after 205 newer records, expiry, inference labels and long-session recall against the real CI database. THESE NEW SQL CHECKS HAVE NOT BEEN OBSERVED PASSING.
The branch's workflow accepts pushes to work/ai-continuity-20261014, allowing CI without a PR. No PR was opened.

Remaining: typed client/project/account scope for owner memories; independently verified fact provenance; semantic retrieval and evaluation on a Hebrew business corpus; configurable TTL and conflict/supersession workflows; persisted memory citations; live inbox/WhatsApp/Hostinger verification; real SQL gate and main promotion for this AI branch.
Existing scoped CRM/file context, triage, business inbox and background actions were inspected and retained, with their regressions in the full suite; they were not replaced or claimed as newly implemented.


## Verified release — 2026-10-15
Supersedes the earlier SQL-blocked status. Public run 38750858284 identified ER_NO_SUCH_TABLE in AssistantChatHistory.load: the integration harness omitted migrateActions, although server startup already invokes it. Commit 4c26589 adds that prerequisite twice to verify idempotency. No production migration was missing or removed.
Run https://github.com/csivr2ivr2-lgtm/aharon-crm-node-public/actions/runs/38751046338 completed successfully on 4c26589: Node 20/22, owner-memory, secret scan, high+ audit, real MySQL 8.0 and MariaDB 10.11. Local npm test: 363/363.
Failure diagnostics now publish only an allowlisted error code and repository source locations; no credentials or SQL values are included in public annotations.
Main was rechecked at ffef2a1 before promotion. Live CRM rendered its password gate; authenticated functionality and Hostinger deployment version remain unverified.


## Persistent memory sources — verified 2026-10-15
The preceding AI release is on main at 9ac48624d102d1f27b771742788171edc262a677. Follow-up d29124b9f49730c2827162e650e92f15c4eb937d passed all seven gates in https://github.com/csivr2ivr2-lgtm/aharon-crm-node-public/actions/runs/38751790041 (public result inspected before promotion): Node 20/22, owner-memory regression, secret scan, high+ dependency audit, real MySQL 8.0 and MariaDB 10.11.
Assistant turns now persist memory IDs, revisions and evidence labels without copying memory bodies. Reload resolves only actor-authorized sources, marking revised or unavailable records. The Hebrew UI distinguishes owner reports, preferences, temporary notes and unverified inferences, and explains these are model context rather than proof of every answer. Regression tests include source updates/deletion, actor isolation and HTML escaping; real SQL verifies the same source lifecycle in an isolated test database.
Promotion preserves existing WhatsApp code: this follow-up changes only assistant/memory/UI rendering, their tests, SQL harness and this report. No production messages, data deletion or session reset was performed. Live authenticated WhatsApp behavior and Hostinger deployment SHA remain unverified. Typed client/project/account scopes, semantic Hebrew retrieval, independent fact verification and conflict resolution remain open. CI warnings about action-runtime deprecation are non-failing and remain maintenance work.
