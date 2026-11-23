# PATTS project guidance

## Project map

- `app.js` coordinates browser events and application state.
- Domain logic lives in focused root modules such as `wallet.js`, `cards.js`,
  `checkout.js`, `access.js`, `backup.js`, and `inventory.js`.
- `views.js` owns HTML rendering; `db.js` owns IndexedDB persistence.
- `reader-protocol.js` and `android/app/src/main/java/ph/edu/patts/offlinepos/`
  implement the read-only browser and Android NFC-X paths.
- `build.mjs` produces `www/`; Capacitor sync copies it into generated Android
  assets. Do not edit generated copies.

## Validation

- Run `npm run verify:fast` for ordinary JavaScript, UI, or data changes.
- Run `npm run verify:android` for native, Capacitor, reader, manifest, or release
  changes. Use `npm run verify` when both layers changed.
- After app feature changes or fixes, increment the package and Android versions
  together, run `npm run android:apk`, and deliver the new APK from `dist/`.
- Never claim physical NFC/USB validation from emulator or bridge results.
- Keep `.codex/CONTINUATION.md` limited to current state and the next action.

## Primary test device

- Treat Bernard's Samsung SM-X110 tablet as the canonical UI target.
- Design and verify at 800 x 1340 px portrait (1340 x 800 landscape), 213 dpi,
  and 60 Hz. The long-side-to-short-side aspect ratio is 67:40 (1.675:1).
- Use the `PATTS_SM_X110` Android emulator for routine PC development.
- Test RFID/NFC, USB peripherals, and final Android 14 behavior on the physical
  tablet; the local emulator cannot reproduce those hardware paths exactly.
- See `docs/BERNARDS_TABLET.md` for the recorded hardware profile and commands.
