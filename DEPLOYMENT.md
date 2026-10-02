# SkyDream secure deployment

The redesigned SkyDream site is published from `main` and uses Firebase callable functions for protected data access.

## 1. Firebase prerequisites

The Firebase project is `skydream-academy` (see `.firebaserc`). Confirm that:

- Firebase Authentication is enabled.
- Firebase App Check / Fraud Defense is configured for the production web app and allows `skydream.academy`.
- Firestore direct browser access remains denied by `firestore.rules`.
- SMS/Twilio is currently disabled. Registration and the rest of the website do not depend on an SMS provider.

## 2. Deploy Firebase backend changes

From the repository root on a computer authenticated to Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use skydream-academy
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules --project skydream-academy
```

This deploys Cloud Functions and the restrictive Firestore rules. Do not manually delete the existing `sdta_storage` documents; they contain student, administrator, facilitator, attendance, payment, waitlist and intake records.

## 3. Important callable functions

Verify in Firebase Console that these functions are present when backend changes are deployed:

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
- `adminStartNextIntake`

## 4. Front-end publishing

Netlify is connected to the `main` branch, so public-site changes pushed to `main` should publish automatically.

The `_redirects` file redirects the old Netlify hostnames and legacy routes to the canonical site at `https://skydream.academy/`.

## 5. Administrator and facilitator accounts

Existing accounts that still use a legacy PIN can enter it once and then upgrade to a password with at least 12 characters including uppercase, lowercase and a number. New accounts use strong passwords.

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
