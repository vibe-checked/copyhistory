# Copy History

A private clipboard history for iPhone. Auto-captures copies while the app is foregrounded, saves reusable snippets, supports pinning, and never sends data off-device.

- **Support / FAQ:** https://kiddkevin00.github.io/copyhistory/
- **Privacy Policy:** https://kiddkevin00.github.io/copyhistory/privacy.html

## Stack

- Expo SDK 54 (React 19.1.0, React Native 0.81)
- TypeScript
- `expo-clipboard`, `expo-haptics`, `@react-native-async-storage/async-storage`
- Node 22.17.0 (pinned via `.tool-versions`)

## Local development (Expo Go)

```sh
npm install
npx expo start --tunnel
```

Open Expo Go on your iPhone → "Enter URL manually" → paste the `exp://...exp.direct` URL printed in the terminal (or scan the QR if running interactively).

## App Store submission checklist

Apple requires the following to submit a build. Items marked **[done]** are in this repo / ready to point to; **[you]** require you to act (Apple credentials, Xcode, or the App Store Connect web UI).

- [done] App display name (`Copy History`) — `app.json`
- [done] Bundle identifier (`com.kiddkevin00.copyhistory`) — `app.json`
- [done] Version (`1.0.0`) and iOS build number (`1`) — `app.json`
- [done] App icon (`assets/icon.png`)
- [done] **Privacy Policy URL** — https://kiddkevin00.github.io/copyhistory/privacy.html
- [done] **Support URL** — https://kiddkevin00.github.io/copyhistory/
- [you] Apple Developer Program enrollment ($99/yr)
- [you] Xcode 17+ installed locally (or use EAS Build to skip this — see below)
- [you] `npx expo prebuild --platform ios` to generate the `ios/` folder
- [you] Open `ios/copyhistory.xcworkspace` in Xcode, sign with your team, archive, upload via Organizer or Transporter
- [you] In App Store Connect: create the listing, set the URLs above, fill out Privacy Nutrition Labels (the app collects no data — answer "Data Not Collected"), category (Utilities), age rating, description, keywords, screenshots, then submit for review

### Skipping the local Xcode build with EAS

If you don't want to install Xcode 17+, Expo's hosted build service can do it for you:

```sh
npm install -g eas-cli
eas login
eas build --platform ios   # produces an .ipa in the cloud
eas submit --platform ios  # uploads to App Store Connect
```

You still need the Apple Developer account; EAS handles signing and the native build.

## Privacy nutrition labels answer

When App Store Connect asks "What data does this app collect?", the answer for Copy History is **Data Not Collected**. The clipboard contents the app handles stay on-device only and are never transmitted; iOS's sandbox keeps them inside the app's container.

## License

See `LICENSE`.
