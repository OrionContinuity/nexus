# NEXUS Android App — Build Guide

## What This Does

Takes your existing NEXUS website and wraps it in a real Android app.
Same website, but now with access to your phone's camera, microphone,
notifications, and background processing.

## What You Need

1. A computer (Mac, Windows, or Linux)
2. Node.js installed (you probably have this)
3. Android Studio installed (free, from developer.android.com)
4. Your Android phone with USB debugging enabled

## Step-by-Step

### Step 1: Create the app folder

On your computer, create a new folder called `nexus-app`.
This is SEPARATE from your website repo.

```
nexus-app/
├── package.json          ← (from this zip)
├── capacitor.config.ts   ← (from this zip)
└── www/                  ← your website files go here
    ├── index.html
    ├── manifest.json
    ├── sw.js
    ├── css/
    │   └── nexus.css
    └── js/
        ├── app.js            ← PIN auth, syslog, time clock
        ├── admin.js          ← Ingest pipeline + WhatsApp/SMS parser
        ├── brain-canvas.js
        ├── brain-chat.js
        ├── brain-list.js
        ├── brain-events.js
        ├── cleaning.js
        ├── log.js            ← Unified activity feed
        ├── board.js          ← Kanban using unified cards table
        ├── calendar.js
        ├── i18n.js
        ├── native-bridge.js
        └── ... all your other JS
```

### Step 2: Copy your website files

Copy EVERYTHING from your nexus GitHub repo into the `www/` folder.
All the HTML, CSS, JS, images, icons, audio — everything.

Then copy `native-bridge.js` into `www/js/`.

### Step 3: Install dependencies

Open a terminal in the `nexus-app` folder:

```bash
npm install
```

This downloads Capacitor and all the plugins. Takes 1-2 minutes.

### Step 4: Initialize Capacitor

```bash
npx cap init NEXUS com.nexusops.app --web-dir www
```

If it says "already initialized" that's fine — the config file handles it.

### Step 5: Add Android platform

```bash
npx cap add android
```

This creates an `android/` folder with a full Android Studio project.

### Step 6: Sync your web files into the Android project

```bash
npx cap sync android
```

This copies everything from `www/` into the Android project.

### Step 7: Open in Android Studio

```bash
npx cap open android
```

Android Studio opens with your NEXUS project.

### Step 8: Build the APK

In Android Studio:
1. Wait for Gradle to finish syncing (bottom progress bar)
2. Click **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. Wait 1-2 minutes
4. Click "locate" when it says "APK(s) generated successfully"
5. The APK file is at: `android/app/build/outputs/apk/debug/app-debug.apk`

### Step 9: Install on your phone

**Option A — USB cable:**
1. Connect phone to computer via USB
2. Enable USB debugging on phone (Settings → Developer options → USB debugging)
3. In Android Studio, click the green Play button ▶
4. Select your phone from the list
5. App installs and opens

**Option B — Transfer the APK:**
1. Send the `app-debug.apk` file to your phone (email, Google Drive, AirDroid)
2. Open it on your phone
3. Allow "Install unknown apps" when prompted
4. Install

### Step 10: Done

NEXUS is now a real app on your phone. It has:
- 📷 Camera button in nav bar — scan receipts, invoices, labels
- 🎙 Voice button in nav bar — tap to log, long-press to dictate to chat
- Background sync every 5 minutes
- Native notifications on your lock screen
- Full offline support
- No browser bar — true full-screen app

## Updating the App

When you push changes to your website:

1. Copy the changed files into `www/`
2. Run `npx cap sync android`
3. Build a new APK in Android Studio
4. Install on phone

OR — if you enable the live URL in `capacitor.config.ts`:
1. Uncomment the `url: 'https://orioncontinuity.github.io/nexus/'` line
2. The app always loads from your live site (needs internet)
3. Push to GitHub = instant update, no new APK needed

## Features Added by native-bridge.js

### Receipt Scanner (📷 button)
- Tap the camera icon in nav
- Take a photo of any receipt, invoice, or document
- Claude Vision reads it and extracts: vendor, amount, date, items
- Auto-creates a node in your brain
- Saves the photo to Supabase Storage

### Voice Logging (🎙 button)
- TAP = voice log (saved to daily logs)
- LONG PRESS = voice to chat (fills chat input)
- Works with Web Speech API (browser) or native speech (APK)
- Phone vibrates on successful log

### Live SMS Capture (APK only)
- Incoming text messages auto-queue for AI processing
- Filter by contact — only capture messages from people you choose
- Set watch list: open browser console → `NX.setSmsWatchList(['John','5125551234'])`
- Empty list = capture ALL incoming SMS
- Requires SMS permission on first launch

### WhatsApp / Telegram Capture (APK only)
- Reads app notifications to passively capture incoming messages
- Requires **Notification Access** permission in Android Settings
- On first launch, you'll be prompted to enable it
- Default apps watched: WhatsApp, WhatsApp Business, Telegram
- Customize: `NX.setNotifyWatchApps(['com.whatsapp'])`
- Messages are deduplicated (same message within 30s = skipped)
- ⚠ This captures notification text only (not full conversations)

### Background Sync
- Refreshes nodes every 5 minutes
- Checks for urgent triage alerts
- Shows native notification if something urgent is found

### Share
- NX.shareContent(title, text) — shares via Android share sheet
- Works for reports, node info, digests

## Troubleshooting

**"App crashes on launch"**
→ Make sure all files are in www/ and run `npx cap sync android` again

**"Camera doesn't work"**
→ Grant camera permission when prompted. Check AndroidManifest.xml has camera permission.

**"Voice doesn't work"**
→ Grant microphone permission. Chrome/WebView needs RECORD_AUDIO permission.

**"Notifications don't show"**
→ Grant notification permission in Android Settings → Apps → NEXUS → Notifications
