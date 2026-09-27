# File extraction components

- **unpdf 1.4.0**, MIT: https://github.com/unjs/unpdf . Approximately 1.83 MB unpacked, bundles Mozilla PDF.js, no extra runtime dependencies. Selected a pinned Node 20 compatible release because the latest release requires Node 22. No canvas, rendering, GPU, OCR or external PDF service is used.
- **mammoth 1.13.0**, BSD-2-Clause: https://github.com/mwilliamson/mammoth.js . Approximately 1.67 MB unpacked; eight direct JavaScript dependencies (ZIP/XML utilities). Maintained upstream; 1.11 disabled external file access by default. We explicitly disable external file access and only extract plain text, never HTML.

Both upstream repositories, npm manifests, licenses and maintenance were reviewed. Preserve the packages' license notices on redistribution. Installed transitive dependencies are covered by the lockfile and the repository's npm audit check; review dependency advisories when upgrading.

Extraction runs in an isolated worker thread with a 15 second timeout and 96 MB V8 old-generation cap. Input is capped at 10 MB, PDF page count at 100 before extraction, searchable text at 200,000 characters, DOCX ZIP entries at 2,000 and declared expanded bytes at 25 MB. Worker threads are resource controls, not an operating-system security sandbox. File contents remain untrusted data for AI retrieval. Files beyond these limits remain downloadable but show an explicit indexing error.

## Lifecycle and files

Project/system archive and soft delete preserve all associations and audit history. Permanent deletion requires prior soft deletion, confirmation, and explicit relation-detachment permission when related records exist. Business records are preserved with project pointers cleared; directly owned notes are removed and the pre-delete audit snapshot remains. Restore clears archive/deletion timestamps and preserves business status.

File folders are virtual metadata, never filesystem paths. Rename preserves extension. Physical filenames are opaque identifiers. Scope is required for read/search: a specific client or explicit authenticated internal mode. File deletion is reversible soft deletion; binary purge is not implemented. Text, Markdown, CSV and JSON can be created/edited; PDF and DOCX support extraction only.

Reminder delivery is transactionally claimed, creates one deterministic notification, and optionally schedules a follow-up draft. It never sends externally. Suggested next actions are notifications; owner approval is required to enact them.
