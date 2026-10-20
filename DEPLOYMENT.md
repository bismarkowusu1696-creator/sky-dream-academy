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
