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

## 12. AI Command Center, Data Guardian and Admissions Concierge (pilot)

This update adds three **read-only** Firebase features:

- `adminAiCommandCenter`: owner-only answers grounded in registered student counts, attendance, finance/capacity statistics and related owner-visible rows. Students and staff do not have access. The existing staff and facilitator permissions are unchanged.
- `adminAiDataGuardian`: owner-only review flags for duplicate current registration numbers, shared numbers within an intake, ledger mismatches, orphan attendance and course mismatches. It **never edits** student, attendance or payment records.
- `publicAdmissionsAssistant`: website assistant that uses the current **publicCatalog** to discuss listed courses, course recommendations, dates, published fee and places. It cannot identify students, verify personal registration details or take an application.

These features use App Check, server-side authorization and hashed rate-limiting identifiers. The public assistant accepts at most 15 requests per IP per hour; the owner workspaces allow 40 per principal per hour. The model does not receive raw public questions, student names, phone numbers, Ghana Card details, registration numbers, individual payment transactions or student attendance histories. Only a classification/topic and precomputed programme or academy aggregate facts are sent. No chats are retained by this implementation. Use the original records to verify any output before taking action.

**Provider configuration:** The optional AI model uses OpenAI Responses with model `gpt-4.1-mini`; model use may incur provider charges. From a trusted, authorized development machine, set the Firebase Secret Manager secret *before deploying the code*:

```powershell
firebase functions:secrets:set SKYDREAM_AI_API_KEY --project skydream-academy
```

Paste the API key **only into the Firebase CLI prompt**, never a source file, browser console, chat message, GitHub issue or repository secret printed in logs. The cloud functions bind this secret; absent/invalid credentials cause locally computed **Guided** responses instead of failed admissions or incorrect claims. Verify Firebase billing, quota, App Check configuration and provider permission before enabling production model requests.

This is a **pilot for review**, not an authorization to deploy. Before merging and deploying: run `node scripts/validate-local.js`, confirm new tests pass, confirm database backups, exercise the owner-only permissions with test accounts, test public FAQ and rate limits, and verify that personal information is never present in model request payloads. Test in a staging Firebase project where possible. New backend functions and scripts are deployed only after a Firebase deploy; changing public HTML alone will display controls that cannot answer until backend deployment completes.

The deployment process should keep the following guarantees:

1. Anonymous visitors can ask about public courses but cannot retrieve private student or payment details.
2. Staff admins, facilitators and students are denied access to AI Command Center and Data Guardian.
3. No AI action can delete, renumber or otherwise modify registration, attendance or payment data.
4. A model outage, provider rejection or absent API key falls back to deterministic, clearly labeled guidance.
5. Live enrolment capacity is not guaranteed by a chatbot; only the normal registration transaction reserves places.

