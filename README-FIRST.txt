TURFBOOK — UPDATED PROJECT + ANDROID BUILD WORKFLOW

INCLUDED
- Full React/Vite + Capacitor project.
- Premium black/gold TurfBook interface.
- Player turf browsing and booking requests; no player registration.
- Owner ID/password login and owner booking dashboard.
- Admin dashboard to add/edit/delete turfs and owner accounts.
- Separate hourly prices for 5s and 7s at every turf.
- Exactly one turf can offer the additional Mini 7s format and its own price. The app blocks enabling Mini 7s on a second turf.
- Booking requests save the selected format and price.
- QR image upload, UPI/payment reference workflow, manual payment verification.
- Commission and app-name settings, per-turf image uploads, app-icon upload/preview inside the app, and backup/restore.
- Crown-free dark-green TurfBook Ksd. football artwork at resources/icon.png and icon.png; Android launcher icons are generated from this image during the build.
- GitHub Actions workflow to build a DEBUG APK and generate Android launcher icons.

IMPORTANT PRICING SETUP
The six sample turf records are demonstration data. Their 5s and 7s price fields start with the same old sample price because the actual price list was not supplied. Before accepting bookings, open Admin > Manage Turfs > Edit for each turf and enter the real 5s and 7s rates. Tick “Also offer Mini 7s” only for the one turf that provides that option, then enter its separate price. The player booking form will show the enabled formats and the corresponding rate.

FIRST-RUN ADMIN PIN
246810
Change it from Admin > Settings. This is a local prototype PIN, not secure authentication.

HOW TO PREVIEW
1. Open the TurfBook folder in StackBlitz or another Vite environment.
2. Install dependencies if prompted.
3. Run the preview.

HOW TO BUILD A DEBUG APK
1. Upload the contents of this project folder to the ROOT of your GitHub repository (keep .github and resources folders).
2. Open GitHub > Actions > Build TurfBook Android APK.
3. Run the workflow or push to main.
4. Download the TurfBook-debug-apk artifact from the completed run.

The workflow creates Android launcher icons from resources/icon.png. Rebuild and reinstall the APK to see a changed launcher icon on your device.

CRITICAL LIMITATIONS — NOT READY FOR REAL CUSTOMER BOOKINGS OR PAYMENTS
This remains a local-storage prototype. Data is stored in one browser/device; owners using other phones do not share live bookings. Owner passwords and Admin PIN are stored locally. QR/payment verification is manual. Slot checks are not protected by a server-side atomic lock. Do not use real customer data, real passwords, or collect real payments with this version.

The requested natural-language AI Creator bar is technically possible, but requires an AI API and a secure backend with permission checks and confirmation before actions. It is not faked in this offline prototype. A production launch still requires a shared secure backend (e.g. Supabase), proper owner/admin authentication and access controls, server-side slot locking, secure payment-proof storage, audit logs, settlement records, privacy policy, and a signed Play Store AAB. The included workflow creates a DEBUG APK for testing, not a Play Store release.
