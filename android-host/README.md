# Android host — SEEK & STRIKE

Capacitor 8 project (`android/`), app id **`it.seekandstrike.app`**, domain `seekandstrike.it`
(owner-confirmed 2026-10-28). The web game is the release build in `../dist` (`webDir`).

## What is here

- `capacitor.config.json` — app id/name, `webDir ../dist`, mixed content off, WebView debugging off,
  `CapacitorHttp` on (stopgap for the public-RPC 403 on browser `Origin`; **untested on a Seeker**).
- `android/` — generated Gradle project (`npx cap add android`), plus our changes:
  - `PassValidatorPlugin.java` — the only app-specific native bridge method (`PassValidator.validate`).
  - `pass/TxValidator.java` — native pre-wallet validator, pure Java. It re-derives every account (ATA, lock,
    pool, curve, volume accumulator PDAs), rebuilds the expected instructions byte for byte and compares them with
    the unsigned transaction. Fixed route SOL→PASTA→SWANGY; a different route fails closed until the app is updated.
  - `AndroidManifest.xml` — no backup, HTTPS only, `solana-wallet` intent query.
  - `res/xml/network_security_config.xml` — cleartext allowed only to `localhost`/`127.0.0.1` (MWA local WebSocket).
- `resources/` — icon sources for `@capacitor/assets`.

## Validator tests

The TypeScript validator writes shared vectors; the Java validator must agree on every one.

```bash
npx vitest run tools/validator-vectors        # writes android/app/src/test/resources/validator-vectors.txt
```

```bash
cd android/app/src && javac -d /tmp/vout main/java/it/seekandstrike/app/pass/TxValidator.java test/java/it/seekandstrike/app/pass/VectorRunner.java && java -cp /tmp/vout it.seekandstrike.app.pass.VectorRunner test/resources/validator-vectors.txt
```

Under Gradle the same check runs as `TxValidatorVectorsTest` (`./gradlew :app:testDebugUnitTest`).

## Build (debug APK built 2026-10-28 with Temurin JDK 21.0.12 in ~/.jdks/temurin-21; never run on a device)

Needs JDK 21 (Capacitor 8), Gradle 8.14 (wrapper downloads it) and Android platform 36.

```bash
npm run build && npm run check:release
cd android-host && npx cap sync android
cd android && ./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Release signing: see `HANDOFF.md` §5.1. Keystores never go in the repo.

## Known deviations

- Capacitor's JS bridge is broader than the skill's "minimal bridge" rule. Only our own plugin is added, but the
  stock Capacitor plugins stay enabled. Switching to a Kotlin host with a single `addWebMessageListener` bridge
  remains an option (`docs/brief.md` §8).
- The validator is Java, not Kotlin (no Kotlin Gradle plugin needed); it has no Android dependencies.
