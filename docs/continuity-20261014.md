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
