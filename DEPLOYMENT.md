# SkyDream secure deployment

This branch changes both the public website and the Firebase security architecture. Deploy the backend first, then publish/merge the front end.

## 1. Review Firebase prerequisites

The Firebase project is `skydream-academy` (see `.firebaserc`). Confirm that:

- Firebase Authentication is enabled.
- Anonymous Authentication may remain enabled for older deployments, but the redesigned site does not rely on anonymous users for database access.
- Firebase App Check for the web app is configured for `www.skydream.academy` and `skydream.academy`.
- The existing Twilio secrets remain configured: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`.

## 2. Deploy the secure Firebase backend first

From the repository root on a computer authenticated to Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use skydream-academy
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

This deploys the Cloud Functions and the Firestore rule that denies all direct browser database access.

## 3. Smoke-test the backend before publishing the new front end

Verify in Firebase Console that the new callable functions are deployed, especially:

- `publicCatalog`
- `registerStudent`
- `checkStudentStatus`
- `submitContactMessage`
- `adminLogin`
- `upgradeAdminPassword`
- `getAdminSnapshot`
- `facilitatorLogin`
- `upgradeFacilitatorPassword`
- `getFacilitatorDashboard`
- `markFacilitatorAttendance`

Do not manually delete the existing `sdta_storage` documents. The secure backend intentionally keeps the current JSON storage format so existing students, administrators, facilitators, attendance, payments, waitlist and intake records remain compatible.

## 4. Merge/publish the website branch

After the backend is live, merge `security-seo-hardening` into `main`. If Netlify is connected to `main`, it should publish the redesigned public pages automatically.

The `_redirects` file redirects the old Netlify hostname and the legacy `/skydream-academy` page to the canonical site.

## 5. First administrator/facilitator login

Existing accounts that still use a 4–8 digit PIN can enter that PIN once. After successful server verification, the site requires an upgrade to a password with at least 12 characters including uppercase, lowercase and a number. The legacy PIN hash is then removed from the account record.

New administrator and facilitator accounts are created with strong passwords only.

## 6. Search indexing

After the front end is published:

1. Open Google Search Console for `skydream.academy` / `www.skydream.academy`.
2. Submit `https://www.skydream.academy/sitemap.xml`.
3. Request indexing for the homepage and `programs.html`.
4. Confirm the old `skydream.netlify.app` URLs redirect to the custom domain.
5. Google can take days or weeks to replace old domain history and old search results.

## 7. Post-deployment checks

Test these flows on both desktop and a phone:

- Home, Programs, Schedule, About and Contact pages.
- New registration and waitlist behavior.
- Student status lookup using registration number + matching mobile number.
- Administrator legacy-PIN upgrade and login.
- Administrator student edit/payment/SMS actions.
- Facilitator legacy-PIN upgrade and assigned-program attendance.
- PWA install/update and removal of old cached site version.

If a Firebase backend deployment fails, do not publish/merge the new front end until the backend error is resolved.
