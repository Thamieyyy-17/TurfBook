TURFBOOK — FULL UI PROTOTYPE + ANDROID BUILD WORKFLOW

WHAT'S INCLUDED
- Premium black/gold responsive app interface.
- Player browsing and booking request flow.
- Owner ID/password login created by Admin.
- Owner dashboard: booking list, approve/decline.
- Admin dashboard: add/edit/delete turfs, create/edit owners, manage bookings.
- Upload/change payment QR image and enter UPI ID.
- Player booking lookup by phone, display uploaded QR after approval, submit transaction reference.
- Admin can review submitted payment references and mark verified.
- Commission setting, app display name, backup/restore.
- Capacitor configuration and GitHub Actions workflow to build a DEBUG APK.

IMPORTANT LIMITATIONS — READ BEFORE REAL USE
This version is a local prototype. Data is saved in the browser/device local storage. It is NOT a secure multi-user backend:
- Owners on different phones will not share the same live bookings.
- Owner passwords and Admin PIN are local prototype credentials, not secure authentication.
- QR image is stored locally on this device.
- Payment verification is a manual prototype action; no money is processed.
- Do not collect real customer payments or use real passwords with this prototype.
A production release needs Supabase/server authentication, server-side Owner ID mapping, database row-level security, atomic slot locking, private QR/payment-proof storage, audit logs, verified payment handling and owner settlement records.

FIRST-RUN ADMIN PIN
246810
Sign in using Admin from the top navigation, then change the PIN in Settings.
This is a demo PIN, not secure for a public release.

HOW TO PREVIEW
1. Open the project in StackBlitz or another Vite environment.
2. Install dependencies if prompted.
3. Run the preview.

HOW TO GET A DEBUG APK
The included GitHub Actions workflow builds an installable DEBUG APK after the project is pushed to a GitHub repository:
1. Upload these project files to a new GitHub repository.
2. Open the repository's Actions tab.
3. Run "Build TurfBook Android APK" (or push to main).
4. Download the "TurfBook-debug-apk" artifact from the completed workflow run.
This is a DEBUG APK for testing, not a Play Store release build. Google Play requires a properly signed release AAB, privacy policy, Data safety declaration, testing and Play Console setup.

Do not upload secrets or private payment keys into the source project.
