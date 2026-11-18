TURFBOOK — FIREBASE CLOUD PROJECT

THIS PROJECT
- Existing TurfBook React/Vite + Capacitor app, retained rather than rebuilt.
- The supplied black-and-white TURFBOOK KASARGOD image is installed as the Android launcher icon source (resources/icon.png), site icon (public/icon.png), and root icon.png.
- Firebase project: turfbook-966bc
- Android package: com.turfbook.app
- Firebase Functions region: asia-south1
- Admin sign-in: Google Authentication plus an explicit Firestore allow-list record. No bootstrapAdmin function, setup secret, or local-storage admin PIN is used.

CORE APP FEATURES IN SOURCE
1. Players can request bookings without creating accounts. Each booking is retrieved using its booking ID and a random access code.
2. Bookings are stored in Firestore. Cloud Functions create per-hour slot-lock documents transactionally to prevent overlapping requests, including concurrent requests from different devices.
3. Owners have separate Firebase Authentication accounts and owner-scoped dashboards. The server checks the owner claim and active owner record on every protected owner function.
4. Admin can create/disable owners, assign owners to turfs, add/edit/hide turfs, manage QR/UPI settings, verify payments, and manage platform settings.
5. Admin payment verification adds ₹50 to the assigned owner's credit ledger once per booking. This is an in-app credit balance, not an automatic bank transfer or payout.
6. FCM notification functions target the relevant owner/admin and, when the customer granted notifications, the customer's device token. Android uses a custom notification channel/sound; foreground app code also plays the included tone and vibrates where supported.
7. Every turf must offer 5s and 7s with separate prices. The backend allows Mini 7s on at most one turf and requires its own positive price.
8. The admin Notice Board can be switched on/off and supports an announcement and optional image.
9. Customer booking phone numbers are validated as exactly 10 digits in both the interface and backend.

BEFORE FIRST USE
1. Confirm Google and Email/Password providers are enabled in Firebase Authentication.
2. Deploy Firestore rules and indexes, Cloud Functions, and Hosting using the Firebase CLI after signing in to the correct project.
3. The project currently uses Cloud Functions for secure booking locks, owner management, payment verification, and notifications. Firebase currently requires the Blaze billing plan to deploy Cloud Functions. Do not attach billing without a parent/guardian reviewing the billing account, budgets, and possible charges.
4. Sign in once with the intended Google account. In Firebase Authentication > Users, copy that account's UID. In Firestore create admins/<UID> with a Boolean field active=true. The rules deny client writes to admins, so create this record in the Firebase Console as the project administrator.
5. Add your real turf records and actual 5s/7s prices in the Admin dashboard. Choose the one Mini 7s turf and enter its actual separate price. The project does not invent real-world prices or turf details.
6. Android admin login uses the native Google picker through @capacitor-firebase/authentication 6.x and exchanges the Google ID token into the Firebase JavaScript Auth session. The web version uses Firebase's Google popup. Add the Android app's SHA-1 fingerprint in Firebase Project Settings, enable Google provider, then download the refreshed google-services.json. The current file has no Android OAuth client entries, so native sign-in is not ready to test until that console step is completed. The plugin 6.x line matches the existing Capacitor 6 app but is marked deprecated upstream; plan a Capacitor 8/plugin 8 upgrade before public production release.
7. Set the GitHub Actions repository secrets listed in .env.example before running the Android workflow.

DEPLOYMENT COMMANDS
- Firebase CLI deploy (requires a signed-in Firebase CLI account and the appropriate plan):
  firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
- To deploy Firestore rules/indexes and Hosting separately while remaining on the no-cost plan:
  firebase deploy --only firestore:rules,firestore:indexes,hosting
  Note: this does NOT deploy callable functions, so cloud bookings and protected admin/owner actions will not work end-to-end until Functions are deployed.
- Android workflow: GitHub > Actions > Build TurfBook Android APK > Run workflow. It produces a DEBUG APK for testing, not a signed Play Store AAB.

IMPORTANT LIMITATIONS
- This ZIP contains source/configuration; it has not deployed anything to your Firebase project.
- The Cloud Functions backend and Firestore rules need deployment and runtime testing in your project.
- A full Vite/Android build could not be run in the authoring environment because npm package downloads failed with a network/DNS error. Run the included GitHub Actions workflow to verify the Android build.
- Native Android Google sign-in is wired through the Capacitor Firebase Authentication 6.x plugin and bridged into the Firebase JavaScript Auth session. It still needs the Android SHA-1 fingerprint added in Firebase, a refreshed google-services.json containing OAuth client entries, and an actual device sign-in test. The plugin 6.x line is deprecated upstream because this project remains on Capacitor 6; migrate Capacitor and the plugin to their supported major versions before public production release.
- ₹50 is only recorded as owner credit in TurfBook. Real payouts require a separate payout/banking provider and agreement.
- Customer notification delivery depends on permission, correct FCM configuration, and deployed functions. Ringtone/vibration behaviour varies by device and OS settings and must be tested on real devices.
- App icon changes made here are baked into the next Android build. Admin-uploaded in-app branding does not silently replace the Android launcher icon on already-installed devices.
- This is not a certified production release. Complete deployment, OAuth verification, test bookings across multiple devices, payment tests, notification tests, security review, and a signed release build before accepting real customer payments.
