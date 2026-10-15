# Aharon CRM Next — תוכנית מוצר, UX וארכיטקטורה
תאריך: 2026-10-15 | סטטוס: תוכנית פיתוח, לא אישור שהיכולות מיושמות | מקור: ביקורת קוד main + תיעוד ספקים רשמי

## חזון והחלטות מחייבות
מערכת אחת ללקוחות, שיחות, דוא"ל, WhatsApp, יומן, קבצים, משימות ו-AI. כל ערוץ שומר על משמעות מקורית: ל-WhatsApp אין נושא; לדוא"ל יש נושא, נמענים ושרשור; ל-CRM יש סטטוס עבודה נפרד מסטטוס ההודעה אצל הספק.
- צורת ניווט: היום שלי, תיבת תקשורת, נשלחו, טיוטות, לקוחות, פרויקטים, משימות, יומן, קבצים, AI, חיבורים והגדרות. לא לייצר שני מסכים שמתארים אותה פעולה.
- חוויית תיבה אחידה עם תצוגה מתחלפת: WhatsApp בועות צ'אט; דוא"ל שרשור מקצועי. תצוגת שיחה מפורטת וקישורי לקוח/פרויקט/משימה.
- AI מציע, מסכם, משייך, מתכנן ומכין טיוטות. שינוי נתונים או שליחה לגורם חיצוני מחייבים מדיניות הרשאות, תצוגה מקדימה ואישור אלא אם קיימת הרשאה מפורשת ומוגבלת מראש.
- לשמור על Fastify/Node, MySQL/MariaDB, מנוע jobs ו-Realtime הקיימים. לבצע מודולריזציה הדרגתית של browser.js, לא rewrite מסוכן של כל הפרויקט.
- שחרור דרך GitHub MCP ל-main, פריסה אוטומטית ו-QA מיד אחריה כפי שביקש בעל המוצר; לפני שינויי סכמה/סשני WhatsApp לבצע גיבוי, בדיקות ואפשרות rollback.

## ממצאי baseline מהקוד
- src/connectors/whatsapp.js מקבל messages.upsert ו-messaging-history.set, אך לא מטפל באופן מלא ב-messages.update, ב-read receipts, בכל סוגי המדיה או במעקב מסירה עמיד.
- src/browser.js משתמש בטופס שליחה משותף לדוא"ל/WhatsApp. refreshCompose מסתיר 'נושא' עבור WhatsApp באמצעות hidden, אך משתמש דיווח שהשדה עדיין מוצג; לאבחן פריסה, מטמון והתנהגות UI. לפצל עורכי הודעות במבנה ממשק מבלי לשכפל מנגנוני הרשאה/שליחה.
- src/db.js: messages.is_read ו-conversations.unread_count אינם מבדילים בין קריאת משתמש ב-CRM, דגלי Gmail/IMAP ומצב מסירת WhatsApp. messages.subject רלוונטי לדוא"ל בלבד. 'נשלחו' אינו מסך ראשון במעלה.
- src/connectors/google.js: Gmail recent, historical pages, send, Calendar upcoming, Drive search; אין עדיין מנוע מלא ל-history.list/watch או תוויות. config.googleScopes: Gmail readonly + send, calendar readonly, Drive metadata readonly — כתיבה דורשת OAuth scopes נוספים והסכמה מחודשת.
- src/connectors/hostinger-mail.js: IMAP/SMTP + crawl. Hostinger Mail REST API רשמי מציע גם folders/messages/search/flags/send/webhooks. להוסיף כאופציית חיבור ממודרת עם fallback ל-IMAP/SMTP, לא להניח שלכל חשבון יש token/הרשאה.
- src/platform/jobs.js קיים עם idempotency, leases ו-retries; src/ai/actions.js כולל בדיקות הרשאה ואישור. להשתמש בהם כבסיס, לא לשכפל תורים.
- תשובת רענון זהויות Production שסיפק המשתמש: מיפוי PN אחד נמצא, LID אחד נותר ללא PN, אפס שגיאות. זה אינו כשל שאפשר לפתור בהמצאת מספר.

## עקרונות הנתונים — לפני כל עיצוב
מודל ישויות:
1. accounts: ספק, אישור scopes, health, last_success, last_error, יכולות נתמכות.
2. identities: מקור מהימן וקשרים חוצים-ערוצים; whatsapp_lid, whatsapp_pn, email, phones; דרגת אימות ו-provenance; לא למזג לקוחות לפי שמות דומים בלבד.
3. conversations: account_id, provider_id, contact_id, project_id, unread_crm, provider_unread, last_activity, sync_status.
4. messages: source_uid, provider_message_id, direction, type(text/image/audio/video/document/reaction/system), content/attachment metadata, timestamp, per-provider state; שימור מזהי המקור ושלמות.
5. message_status_events: persisted monotonic status history: queued, sending, provider_accepted, sent, delivered, read, played, failed, unknown; לא לייחס סטטוס שאינו נתמך בערוץ.
6. message_read_state: per-user CRM opened/read timestamp בנפרד מ-Gmail UNREAD/IMAP \Seen ובנפרד מ-WA readMessages.
7. sync_state: provider cursor, last page/chunk, checkpoint, cursor validity, full/partial/gap, last_verified, error reason. Event log ו-dedup unique(account, provider_id, provider_message_id) למניעת כפילויות.
8. attachments: streaming, מוגבל-גודל, MIME אמיתי, סריקות, הרשאות והצפנה לפי הצורך.
9. ai_actions/audit: מקור החלטה, טיעון קצר, evidence IDs, policy, preview, user approval, output, rollback references.

להוסיף סכמות בצורה additive בלבד; migrations חוזרות, backfill מוגבל, rollback; לעולם לא לאפס שיחות/סשנים/היסטוריה קיימת.

## M0 — אמינות, בדיקת Production ובסיס עיצוב (P0)
- אמת commit main, פריסת Hostinger, גרסת Baileys בפועל, מצב session, שגיאות לאחר פריסה, גיבוי DB+WhatsApp auth מוצפן ללא העברת סודות ללוגים/מאגר.
- מטריצת capabilities פר חשבון: יכול לקרוא/לשלוח/לסמן נקרא/לסנכרן/לקבל push/לצרף קבצים. החיווי בממשק חייב להציג 'לא זמין' במקום הצלחה מדומה.
- לבנות design tokens, components וקונטרסט נגיש, RTL, מצבי טעינה/ריק/שגיאה, keyboard navigation, responsive, UX של תיקיות.
- בדיקת רגרסיה בסיסית למסך שליחה: WhatsApp ללא נושא/כותרת מייל; דוא"ל עם נושא ומאפייני מייל. תרחישי cache-busting.
DONE: smoke suite לכניסה, חשבונות, תיבה, פתיחה ושליחה מבוקרת בסביבת בדיקה; אין שבר בדאטה/סשנים, ושחזור מגיבוי אומת.

## M1 — מרכז תקשורת חדש (P0, הערך הראשון למשתמש)
- Left/right split desktop RTL מותאם, רשימת שיחות עם חיפוש וסינון מהיר + פאנל שיחה; מובייל מסך יחיד עם ניווט ברור.
- תיקיות: דואר נכנס, הכול, לא נקרא, נשלחו, טיוטות, ממתינים לי, ממתינים ללקוח, בארכיון, ספאם. 'נשלחו' מציג הודעות out מכל הספקים עם קישור לשיחה; לא ליצור עותק הודעה.
- שליחה חדשה: מסך WhatsApp ייעודי (חשבון, איש קשר/מספר, הודעה, קובץ בהמשך; בלי subject/CC), ומסך דוא"ל ייעודי (From, To/Cc/Bcc, Subject, body, attachments). חובה Preview ואישור עד שיוגדר trusted-send מפורש.
- צ'אט עם בועות והפרדה לפי תאריך, timestamp, סמל מסירה אמיתי, unread, ציטוט/תגובה, פעולה על הודעה, זיהוי שם/מספר אם ידוע.
- קיצורי מקלדת, פעולות מרובות, סדר מיון, שמירת פילטרים, פאנל מידע לקוח שמציע שיוך אך אינו כופה.
DONE: לשלוח WhatsApp ללא subject; לדוא"ל עם subject; הדואר היוצא מופיע ב'נשלחו' לאחר אישור ספק ותמונת מצב מתעדכנת בלי refresh; 0 כפילויות.

## M2 — Baileys 7 / WhatsApp עומק (P0–P1)
- אירועים: messages.upsert (notify/append), messages.update ל-status, messaging-history.set עם progress/isLatest/syncType, chats.update unread, contacts.upsert/update, lid-mapping.update, optional presence; לטפל באירועים בסדר ובאידמפוטנטיות.
- לשלוח דרך sock.sendMessage, לשמר key.id ו-JID מענה, והיסטוריית סטטוסים; provider accepted אינו delivered. מיפוי סטטוס רק לפי enums/event אמיתי. לשמור WAMessageKey עבור readMessages([keys]), quoted replies ו-recovery.
- PN↔LID: לשמור LID כמזהה קנוני, לשמור PN רק מ-remoteJidAlt/participantAlt, contacts, Signal cached mapping או מקור מאומת. getPNForLID אינו API חיפוש ברשת, ולכן מספר שאינו ידוע יישאר חסר. לנסות backfill מותר דרך history/contacts; לא להמציא PN ולא לחשוף מידע פרטי.
- היסטוריה: syncFullHistory עם preset מתאים ובקרת זיכרון, progress, עוגנים earliest-message, fetchMessageHistory במנות, retry bounded, חיווי 'requested/not yet received'; אין להבטיח שחזור של כל ההיסטוריה.
- תמיכה בתוכן: טקסט, emoji, תמונה, קובץ, אודיו/קולי, וידאו, caption, תגובות, הודעות ערוכות/נמחקו במגבלות ה־API; media downloads מוגנים.
- 'נקרא ב-CRM' לא מחייב read receipt; כפתור 'סמן כנקרא גם ב-WhatsApp' אם supported ועם הרשאה. לא לבצע readMessages אוטומטית בטעינת preview.
- מבחני live מבוקרים בשני חשבונות (או חשבון בדיקה): הודעה נכנסת/יוצאת, echo, delivery, read, offline/reconnect, הודעה היסטורית, תמונה, LID מוכר/לא מוכר, group/channel excluded.
DONE: כל אירוע נשמר פעם אחת, סטטוסים מדויקים, אין אובדן auth או פרטי שיחה, חסרים מוצגים בגלוי.

## M3 — Gmail ברמת לקוח דואר (P0–P1)
- משתמשי Gmail: initial full sync ו-history.list מאז historyId; בקשות watch באמצעות Pub/Sub, חידוש יומי (נדרש לפחות פעם ב-7 ימים), fallback poll. אם historyId פג/404 — sync מחדש ללא מחיקת מידע קיים.
- threads לפי threadId, In-Reply-To/References ונושא תואם; מיילים multipart, HTML sanitized, attachments; לא להתייחס ל-Subject כתנאי ב-WhatsApp.
- תוויות מערכת ולקוח, drafts, sent, archive, trash, spam, unread, mark read באמצעות messages.modify — דורש הרחבת Gmail OAuth scopes מעבר ל-readonly/send; לבקש incremental consent בלבד כשמפעילים.
- חשבונות רבים, חסינות ל-429/5xx, OAuth refresh, one-provider-result idempotency.
DONE: שינוי LABEL/UNREAD אצל Gmail מתעדכן בממשק ולהפך רק כאשר scope מאפשר; Thread reply נשמר באותו שרשור; סנכרון incremental אינו מאבד הודעות.

## M4 — Hostinger Mail מקצועי (P0–P1)
- לבדוק הרשאה ומודל תמחור/זכאות ל-Hostinger Mail API לכל תיבה. אפשרות חיבור API token מוגבל mailbox, לצד IMAP/SMTP legacy.
- מיפוי REST folder/message/search/flags/send/webhooks; אימות signatures וזרימת replay protection ל-webhook; fallback IMAP עם UIDVALIDITY/UID ו-flags.
- read/unread מדויק, folder Sent ו-Drafts, search, threads לפי Message-ID/References, attachments, פעולות copy/move עם אישור למוחקות.
- send states: SMTP accepted/API queued != delivered; event/webhook אם נתמך; ללא המצאת confirmation. חיפוש נתונים סינכרוני לצד pagination וקצב בקשות.
DONE: תיבת Hostinger המציגה הודעות בתיקיות מקור, נתוני flags ויוצא, עם בדיקות מול ספק live מורשה.

## M5 — לקוחות, יומן, קבצים ופרויקטים (P1)
- כרטיס לקוח 360°: כל שיחות הדוא"ל/WhatsApp, משימות, פגישות, קבצים, קשרים, החלטות, הצעות AI והיסטוריית פעולות.
- Google Calendar: syncToken, events.watch ל-push, timezone נכון, reminders ובעלות על אירוע, מינימום scopes; כתיבה רק לאחר reconsent.
- Google Drive: changes.getStartPageToken + changes.list/watch; קישור לקובץ המקורי, הרשאות/מחיקה/גירסאות; לא להעתיק הכל מקבצים פרטיים.
- Google People Contacts: sync token עם תפוגה, זיהוי אנשי קשר רק על בסיס נתונים מאומתים, מנגנון manual merge.
- משימות/פרויקטים: kanban/list/calendar, assignee, dates, follow-up, templates, automation, הקשר לשיחה.
DONE: מידע על לקוח מוצג מכל מקור עם מקור ותאריך, ללא זליגת נתונים בין חשבונות.

## M6 — AI Personal Operations (P1–P2)
- Assistant מרכזי עם הקשר מפורש: מי הלקוח, מה הפרויקט, מאיזו שיחה/מסמך הגיע פרט ומה רמת הביטחון; מקור מידע והיסטוריית גרסאות.
- Hebrew semantic search / hybrid retrieval עם הרשאות, entity resolution מבוקר, זיכרון מתמשך מובנה עם הסכמה ויכולת תיקון.
- Smart inbox triage: classify actionable/spam/personal, urgency, suggested response, next-action, lead, commitments; explain why, allow undo/feedback.
- אפשרויות: 'סכם את כל מה שהשתנה מאז אתמול', 'איזו הודעה דורשת תשובה?', 'תכין לי תשובה', 'תיצור משימה מההבטחה'.
- Router LLM עם fallback/cost/latency, token limits, redaction וprompt-injection defense; guardrails: אי-שליחת מייל/WhatsApp, שינויי לקוח או מחיקת קבצים בלי הרשאת פעולה/אישור.
- automation engine: triggers (incoming/reply/deadline), suggested action preview, dry-run, audit, dedup, rollback where feasible; default read-only.
DONE: חבילת הערכה בעברית מול שאלות זהות/ייחוס/סתירות; אפס פעולות בלתי מורשות ובלי קישורי מקורות לא אמיתיים.

## M7 — איכות, ביצועים ואבטחה (תנאי קבוע לאורך הדרך)
- Test pyramid: pure/unit + adapter contract + integration MySQL 8/MariaDB 10.11 + Node 20/22 + browser E2E + sanctioned provider live + staging smoke.
- CI: npm ci, syntax, unit, SQL, security deps, secret scanning, accessibility, UI RTL snapshots, performance; GitHub main deploy and post-deploy QA; rollback on regressions.
- Security: encrypted token/credential vault, rotation, CSRF, scoped API, RBAC, audit trail, log redaction, attachment validation, rate limits, backups, retention/export/delete.
- Observability: per-connector health, last success, queue lag, lost cursor, manual retry, reconciliation divergence, message ingestion count, provider rate-limit, status accuracy.
- Performance targets for acceptance (not measured current metrics): inbox initial interactive < 2.5s at reference dataset; typical local filter < 150ms; new realtime event visible < 2s when provider delivers; 0 duplicate sends, 0 data loss in replay tests.
- Feature flags for provider-specific writes and AI actions. Do not run destructive production tests or disconnect/re-pair sessions during smoke.

## Delivery sequence and gates
1. M0 + M1 foundation together: UI split, sent, typed composer, status data model, smoke tests.
2. M2 WhatsApp and M3 Gmail reliability in parallel only where schemas stabilized; per-provider acceptance separately.
3. M4 Hostinger API integration with token permission check and IMAP fallback.
4. M5 linked entities + M6 contextual AI/automation, iteratively with user feedback.
5. M7 QA, access control, performance and observability enforced at every commit.
כל עבודה מוגדרת GOAL/DONE מדידים, רשימת תרחישי בדיקה ומעקב ממצאים. לא מציגים feature כ'מוכן' לפני אימות live. לפני push ל-main משמרים HEAD נוכחי וקוד/נתונים קודמים; אחרי push QA בשרת.

## Reference URLs — תיעוד רשמי שנבדק
- https://baileys.wiki/concepts/events
- https://baileys.wiki/concepts/jids
- https://baileys.wiki/advanced/history-sync
- https://baileys.wiki/messaging/message-actions
- https://baileys.wiki/messaging/sending-messages
- https://baileys.wiki/migration/v7
- https://developers.google.com/workspace/gmail/api/reference/rest
- https://developers.google.com/workspace/gmail/api/guides/sync
- https://developers.google.com/workspace/gmail/api/guides/push
- https://developers.google.com/workspace/calendar/api/guides/sync
- https://developers.google.com/workspace/calendar/api/guides/push
- https://developers.google.com/workspace/drive/api/guides/manage-changes
- https://developers.google.com/people/api/rest/v1/people.connections/list
- https://api.mail.hostinger.com/
- https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/
