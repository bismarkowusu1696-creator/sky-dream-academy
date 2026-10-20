# SkyDream secure deployment

The redesigned SkyDream site is published from `main` and uses Firebase callable functions for protected data access.

## 1. Firebase prerequisites

The Firebase project is `skydream-academy` (see `.firebaserc`). Confirm that:

- Firebase Authentication is enabled.
- Firebase App Check / Fraud Defense is configured for the production web app and allows `skydream.academy`.
- Firestore direct browser access remains denied by `firestore.rules`.
- SMS/Twilio is currently disabled. Registration and the rest of the website do not depend on an SMS provider.

## 2. Deploy Firebase backend changes

From the repository root on a trusted Windows computer authenticated to Firebase CLI:

```powershell
git pull origin main
node scripts/validate-local.js
.\\scripts\\deploy-firebase.ps1
```

The deployment script runs the complete local validator again before changing any Firebase resource. If Node reports a failure, **stop** and fix it first. Install the Firebase CLI using `npm install -g firebase-tools` and run `firebase login` if necessary.

These commands deploy Cloud Functions, the restrictive Firestore rules, and Firestore index/TTL policies. Do not manually delete the existing `sdta_storage` documents; they contain student, administrator, facilitator, attendance, payment, waitlist and intake records.

## 3. Important callable functions

Verify in Firebase Console that these functions are present when backend changes are deployed:

- `publicCatalog`
- `registerStudent`
- `checkStudentStatus`
- `submitContactMessage`
- `adminLogin`
- `getAdminSnapshot`
- `facilitatorLogin`
- `getFacilitatorDashboard`
- `markFacilitatorAttendance`
- `adminStartNextIntake`

## 4. Front-end publishing

Netlify is connected to the `main` branch, so public-site changes pushed to `main` should publish automatically.

The `_redirects` file redirects the old Netlify hostnames and legacy routes to the canonical site at `https://skydream.academy/`.

## 5. Administrator and facilitator accounts

Main administrator: strong password (at least 12 characters) and optional authenticator 2-step verification. Registration staff and facilitators keep their existing 4-digit PINs and restricted roles. Owner legacy PIN sign-in and PIN migration remain disabled.

- Shared team access: `/academy-team-access-83d7c921`
- Facilitator access: `/academy-facilitator-access-64c2f89a`
- Public `/admin`, `/staff`, and `/facilitator` addresses return 404 after the Netlify deploy.
- These URLs are **unlisted, not confidential**. Their locations appear in this public repository. Firebase authorization remains the actual security boundary.

## 6. Search indexing

After public changes are published:

1. Open Google Search Console for `skydream.academy`.
2. Submit `https://skydream.academy/sitemap.xml`.
3. Request indexing for `https://skydream.academy/` and `https://skydream.academy/programs.html`.
4. Confirm the old Netlify URLs redirect to the custom domain.
5. Google can take days or weeks to replace old domain history and old search results.

## 7. Post-deployment checks

Test on both desktop and phone:

- Home, Programs, Schedule, About and Contact pages.
- Registration and waitlist behavior.
- Student status lookup using registration number + matching mobile number.
- Administrator login, student editing, payments and deletion permissions.
- Facilitator login and assigned-program attendance.
- PWA install/update and removal of old cached versions.

SMS actions should remain hidden until an SMS provider is deliberately configured.


## 8. GitHub Actions runner fallback

If a GitHub Actions job fails before the first step with no runner assigned, an empty steps list, and runner ID 0, the repository code has not started executing. Re-running or changing workflow commands cannot fix that pre-runner condition.

While GitHub-hosted runners are unavailable, run `node scripts/validate-local.js` on your trusted development machine before changing the site. To deploy backend changes, run `.\\scripts\\deploy-firebase.ps1` as described above. These scripts cannot repair GitHub's runner allocation issue; visit GitHub repository Actions settings/support for that.

## 9. Backups and recovery limits

The deployed backend defines a daily scheduled backup (`dailyAdminBackup`, 02:30 Africa/Accra) and an owner-only manual backup (`adminRunManualBackup`). **Confirm their real production execution and storage permissions in Firebase Console**; source code alone cannot establish whether a scheduled job has run.

As of backup format 2, a successful run writes:
- `admin-backups/YYYY-MM-DD/skydream-TIMESTAMP.json`: legacy shared records plus a `collections` manifest listing document counts and page paths.
- `admin-backups/YYYY-MM-DD/skydream-TIMESTAMP/collections/NAME/part-000000.json` etc.: paginated per-document records, including messages, audit archives, registration follow-ups, facilitator onboarding, and the full legacy `sdta_storage` collection.

The manifest is saved **only after all collection pages succeed**. An interrupted export may leave orphan page files but must not count as a completed backup. Files in the `admin-backups/` prefix are deleted after about 30 days on successful backup runs. Since these files contain sensitive staff/student information, restrict bucket access and never share raw backups publicly.

**Important:** These are JSON snapshots for emergency recovery, not a tested one-click Firestore restore or an atomic point-in-time database export. Verify contents and regularly perform an authorized restore drill in a separate test project before relying on them for disaster recovery. The next Firebase backend deployment is required for the expanded backup format to start running.

## 10. Pre-launch owner acceptance test

Using test accounts (not live student data), verify: owner sign-in/2FA; staff PIN sign-in and restricted permissions; facilitator PIN sign-in and attendance; student registration/status/portal messages; approved templates and staff activity audit; old public admin paths showing 404; mobile PWA install instructions; and that a manual backup writes a complete format-2 manifest.

Do not change any current PIN format or the accepted student-status verification flow during this check.

## 11. Safe registration-number compaction on student deletion

When the **main administrator** deletes a registration, SkyDream moves the removed record into the recycle bin and checks the remaining students in that **same program and intake**. If all students whose numbers would change are safe to renumber, their sequence is made contiguous again (for example, deleting 001 moves 002 → 001 and 003 → 002). The operation keeps permanent student IDs, payments and attendance associations, and writes an audit entry for each old/new number and one for the deletion.

**Fail-closed safety:** No other students are renumbered when a relevant record has a payment, attendance, portal account, message, push device, assessment, verification tracking, internal note, historical audit record, protected status, unsupported numbering, or an ambiguous registration number/mobile pair. An unavailable protection check also prevents renumbering. Deletion still moves the record into the recycle bin, but the owner dashboard explains why numbers were retained.

For records that do change, old registration numbers are retained under `previousRegNumbers`. Students can continue signing into their **Student Portal** with a previous number and their existing matching mobile; the portal shows their current number. The existing student status lookup continues to expect the **current** registration number. Exact current portal numbers take priority over aliases. The recycle-bin restore action checks for duplicate current registration numbers and assigns a free number if the previous one has already been reassigned.

Historical receipts and exported reports are not rewritten. Keep the immutable audit trail with old and new numbers and advise affected students of their current number. This implementation intentionally avoids forcing contiguous numbers when that would threaten the integrity of historical or external records. Staff-admin and facilitator roles remain unchanged.

Run `node scripts/validate-local.js` and deploy Cloud Functions using `.\\scripts\\deploy-firebase.ps1`. This feature runs in Firebase; changing frontend files alone does not activate it.

## 12. Main Admin payment correction (audited)

Existing **Payment** actions append new entries and never correct an incorrect entry. The separate **Correct Payment** action is shown to the Main Admin in the student registration table.

1. Create a verified database backup before correcting live financial records.
2. Select the intended student's **Correct Payment** button. If several transactions are listed, select the exact one by amount/date/note.
3. Enter the actual amount received, a specific reason, and review the final confirmation before submitting.
4. The callable `adminCorrectPayment` validates the active Main Admin session, checks the payment's index/date/previous amount to prevent stale edits, and confirms the payment ledger matched the stored total before the change.
5. A single Firestore transaction updates the selected payment and recomputes `feePaid` while atomically creating a dedicated `sdta_admin_audit_archive` event with old/new amounts, admin, reason, and timestamp. Each payment also keeps its own correction history, visible on the student's profile.

**Safety:** This action does not delete the student, alter registration numbers, remove earlier payment history, or automatically refund money. It cannot fix an actual financial transfer; any real overpayment or refund must be processed and documented separately by staff. Staff administrators and facilitators cannot call the owner-only endpoint. Corrections to records with inconsistent existing totals are blocked for manual review.

Before deployment: run `node scripts/validate-local.js`, make a fresh cloud backup using the Main Admin dashboard, confirm the correct Firebase project, and deploy Firebase backend through `./scripts/deploy-firebase.ps1` (PowerShell: `.\\scripts\\deploy-firebase.ps1`). A frontend-only publication is insufficient because the correction callable runs on Firebase. Test with disposable data before correcting a live student's entry.

## 13. Private facilitator messages and inbox

**Why:** The existing **Internal Admin Notes** feature may target a facilitator record, but those notes are strictly internal to the administrator. They were never facilitator portal messages. Do not automatically reveal old internal notes to facilitators; some are private staff observations.

**What changed:** The Main Admin has a **Facilitator Messages** section for choosing a currently active facilitator, sending a private message, and viewing that recipient's read status. The facilitator's existing private dashboard has a **Messages** section with an unread count, refresh, and **Mark as read**. New messages are saved to the dedicated Firestore collection `sdta_facilitator_messages`, not to the internal notes collection. The existing admin and facilitator login routes, PINs, accounts, attendance permissions, and student messages remain unchanged.

**Security:** `adminSendFacilitatorMessage` and `adminGetFacilitatorMessages` require an active, owner-only strong admin session. `facilitatorGetInbox` and `facilitatorMarkInboxRead` verify a Firebase facilitator ID token, current account ID, current username and active account status. Recipients cannot list or mark someone else's messages. All four functions enforce App Check. Message submission creates an audit entry without copying the body into the audit record. Records are included in scheduled/manual cloud backups through `backup-collections.js`.

**Rollout:** Run `node scripts/validate-local.js` before merging. Back up the production data. Deploy backend functions via `.\\scripts\\deploy-firebase.ps1` from up-to-date `main`. GitHub Pages must also publish the new facilitator and admin JavaScript files and updated HTML. Check the backend callable names in `firebase functions:list --project skydream-academy` before testing. Sign in as Main Admin and use **Facilitator Messages**, not **Internal Admin Notes**; send a disposable test message. Sign into the intended facilitator account on a second browser or separate tab session, open **Messages**, press **Refresh Messages**, and mark it read. Verify the Main Admin sees the read receipt. Verify another facilitator and any staff admin cannot read or send these messages.

**Existing notes:** An old note addressed to a facilitator still stays in the Internal Admin Notes area. If the owner intended it as a delivered message, deliberately copy and resend the appropriate content using Facilitator Messages after deployment.


## 14. Facilitator replies in private message threads

Facilitators can now **reply directly** to each Main Admin message in their existing Messages inbox. Replies appear beneath the original message, and the Main Admin can see a per-facilitator unread reply count, read the reply history, and explicitly mark replies as read. When the Main Admin starts a new message, the facilitator may reply to it as another conversation.

**Compatibility:** Existing facilitator messages are unchanged. Documents without `replies` are treated as having no replies. Original `readAt` (facilitator's receipt) remains separate from each reply's `readAt` (Main Admin's receipt). Internal Admin Notes are still private and never converted into messages.

**Security:** The callable `facilitatorReplyToMessage` verifies the logged-in active facilitator, matches the immutable recipient `facilitatorId`, validates the reply (max 1500 characters), and appends it transactionally. `adminMarkFacilitatorRepliesRead` requires the existing strong owner-only administrator session. Both enforce Firebase App Check. Replies carry server-generated IDs, times and account-derived sender names. No client-supplied facilitator identity or sender name is trusted. Threads are capped at 40 facilitator replies; a new Main Admin message starts a fresh thread. No student, payment, attendance or registration records are changed.

**Backups:** Replies live inside the existing `sdta_facilitator_messages` collection, already included in cloud backups. No new collections, keys, or billing configuration are required.

**Rollout:** Run `node scripts/validate-local.js`, verify the Firebase backup and tests, merge the dedicated pull request, then deploy functions via `.\\scripts\\deploy-firebase.ps1` and ensure GitHub Pages publishes the updated scripts. Confirm both callable names with `firebase functions:list --project skydream-academy`. Test a conversation in separate browsers: Main Admin sends, facilitator replies beneath that message, admin refreshes **Facilitator Messages**, sees unread replies and marks them read; facilitator refreshes and sees **Seen by Main Admin**. Test that a different facilitator and a staff administrator cannot read or change the conversation.


## 15. Facilitator Reply button visibility and private-script cache fix

The first reply release displayed the entry point as a collapsed `<details>` disclosure, which could look like plain text rather than a button. The revised facilitator dashboard shows a visible **Reply** button on every existing admin message; click it to open the reply textarea and **Send Reply**. It remains available for messages already marked read. Replies are still restricted by `facilitatorReplyToMessage`.

Previously, the PWA service worker applied a cache-first rule to `assets/facilitator-inbox.js` and `assets/admin-facilitator-messages.js`, even though production HTTP response headers instructed `no-store`. The service worker now bypasses caching those private scripts. The cache namespace was rotated and both authenticated dashboard HTML pages use a versioned script URL to defeat existing cache entries, including while an older service worker is still active.

**Production host check:** The canonical site is deployed from Netlify's connected `main` branch. GitHub Pages success alone does **not** verify that `https://skydream.academy` is running the new assets. Confirm the Netlify production deploy is successful. On a separate logged-in facilitator session, refresh the private dashboard using Ctrl+Shift+R, open **Messages**, and look for a visible **Reply** button below each admin message. If the site still looks old, check that `assets/facilitator-inbox.js?v=20261020-reply-ui2` returns the new code on the **canonical** site (look for `data-toggle-fac-reply` in the source). Do not paste tokens, credentials, or message text when asking for troubleshooting help.

This fix changes front-end files, the service worker, and test coverage only; existing Firebase functions `facilitatorReplyToMessage` and `adminMarkFacilitatorRepliesRead` remain unchanged. A Firebase Cloud Functions redeployment is not necessary for this fix.


## 16. Student and facilitator private course chat

Students can now send and receive messages with **active facilitators assigned to their current programme and intake**. A separate conversation area appears under **Student Portal → Messages → Chat with your facilitator**, and facilitators can open **Student Chats** from their authenticated dashboard. Clicking **Chat** alongside a student in the facilitator roster opens that student's conversation. Student chat messages are separate from legacy administrator announcements and older one-way facilitator notices; none of those historical messages is deleted or exposed to unrelated accounts.

**Backend and data:** The new `functions/student-facilitator-chat.js` exports six App Check-protected callables: `studentListFacilitatorChats`, `studentGetFacilitatorChat`, `studentSendFacilitatorChat`, `facilitatorListStudentChats`, `facilitatorGetStudentChat`, and `facilitatorSendStudentChat`. Conversations are keyed by permanent student and facilitator IDs in `sdta_student_facilitator_threads`; individual messages are stored in `sdta_student_facilitator_messages`. Every request independently revalidates Firebase identity, active account status, programme assignment, and current intake. Facilitator credentials are resolved through the existing Firebase ID-token fallback; no public/admin shortcuts exist.

**Safety:** Chat is limited to 1000 characters per message and 30 messages per sender per conversation per hour. Message writes and unread counters are transactional. Read receipts are thread-level; students and facilitators cannot list another person's conversations. Both collections are included in scheduled/manual cloud backups. Student deletion/renumbering preflights now check private chat threads before shifting a linked student's registration number. Administrative notes and other students' private messages are never returned in these endpoints.

**Deployment:** Use a real fresh Firestore backup and validate locally first: `node scripts/validate-local.js`, including `scripts/test-student-facilitator-chat.js`. Review and merge the feature branch deliberately. Deploy Firebase Functions **and Firestore indexes** with `.\\scripts\\deploy-firebase.ps1`. Two new indexes for thread/message ordering must finish building before chat history can load reliably; verify them in Firebase Console → Firestore Database → Indexes. Confirm the six new callable names in `firebase functions:list --project skydream-academy`. Separately verify that Netlify has published `main` to the canonical `skydream.academy` domain. Both chat JS files use versioned URLs, network-only PWA treatment, and no-store headers.

**Verification:** In different browsers, sign in as a test student and an assigned active facilitator for the same current intake; send a student message, use the facilitator's **Student Chats → Refresh Chats**, reply, then refresh the student portal conversation. Also test another student, a different-programme facilitator, a disabled facilitator, and expired sessions. Check that no private messages are visible across accounts and the old administrator messages still display correctly. Student notifications for these new conversations are **in-portal unread counts**; realtime background push for facilitator chats has not been implemented in this initial version.


## 17. Message deletion and clearing (participant-scoped)

Every authenticated SkyDream messaging area now offers a **Delete for me** action on individual messages. This includes (1) student–facilitator private chats on both portals, (2) Main Admin–facilitator messages and individual replies on both portals, and (3) legacy private Student Portal messages and the Student Profile message-history panel inside the admin dashboard.

Where large histories are common, **Clear conversation** or **Clear my message history / inbox** also appears:
- Students and facilitators can clear their current student–facilitator conversation with one action. This uses `studentClearedThroughSeq` or `facilitatorClearedThroughSeq` on the immutable thread record so it takes one Firestore write rather than hundreds of individual deletes; messages received afterward remain visible.
- Main Admin and facilitator private inboxes support **Clear my inbox/history**, hiding up to 100 visible messages per call. If 100 were hidden, repeat the action to continue with older history.
- Student Portal and Main Admin per-student message history likewise support clearing up to 100 items at a time.

**Safety and scope:** Delete and Clear actions remove content **only from the requesting person's view**. They do **not** delete the other participant's message copy, student or facilitator registrations, payments, attendance, read history or historical backups. They mark the relevant message with a per-viewer hidden flag in Firestore, or record a high-water message sequence for clearing a conversation. This deliberately does **not** reduce Firestore storage usage; controlled permanent purging and data-retention rules are a separate maintenance function and should require explicit academy policy and backup verification.

**Authorization:** Every delete/clear callable enforces Firebase App Check and authenticates the relevant existing student, assigned active facilitator, or permission-checked Main Admin before modifying records. Student-to-facilitator chats cannot be cleared across programmes or intakes. Main Admin–facilitator owner-only rules remain intact. Admin deletions of Student Portal messages use the existing students permission level. No message body is sent to an external service.

**Rollout:**
1. Run `node scripts/validate-local.js` (includes `scripts/test-message-delete.js` and extended existing chat tests).
2. Back up Firestore via **Main Admin → Cloud Backups → Create Backup Now**.
3. Merge this branch after validation, deploy Firebase Functions through `.\\scripts\\deploy-firebase.ps1`, and verify the new callables appear in `firebase functions:list --project skydream-academy`.
4. Confirm the Netlify production build for `main` published to `https://skydream.academy`. All affected private script URLs are versioned and do not use the old PWA cache.
5. Test with two separate browser sessions: a student and their facilitator exchange two messages; deleting one should hide it from the deleting user but not the other, and clearing a conversation should allow future messages to appear. Repeat for Main Admin–facilitator messages/replies and legacy student portal notices, verifying all read-only roles remain excluded.
