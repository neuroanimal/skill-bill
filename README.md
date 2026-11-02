# skill-bill

Mobile side of **Skill Bill**: an Expo / React Native app for iPhone. It sends photos and videos to a
computer over an unreliable tunnel, and checks, by content, which items are already safely stored
on disk, so that they can be deleted from the phone without guessing.

The server side is [skill-bill-srv](https://github.com/neuroanimal/skill-bill-srv). It files every
item into a folder built from its capture date and GPS location.

## Screens

| Tab | What it does |
|---|---|
| **Upload** | Browses albums with counts of photos and videos and pages through items as thumbnails. Sends a selection, the whole album, or everything. Shows live speed and a log, and can be stopped mid-file. Files the server already has are skipped |
| **Verify** | Downloads the server's digest index once, then checks photos **offline**: on disk, missing, or not checkable. Filters by status and shows where each copy lives on disk. Includes a guarded test deletion of a single item |
| **Home** | Early prototype screen: live accelerometer and gyroscope readings, IMU recording exported as CSV, and picking or capturing media |
| **Explore** | Expo template screen, kept for reference |

## How the upload survives a bad connection

`hooks/use-upload.ts` and `hooks/upload-chunks.ts` handle each file as follows:

1. **Copy to the sandbox.** The asset is copied from the Photos library into the app sandbox, where
   `expo-file-system` can read it. The copy is removed afterwards, also after a cancellation.
2. **Register.** The app registers the file with the server, sending name, size, date and location.
   It then asks how many bytes the server already holds.
3. **Send in parallel chunks.** The file goes as **parallel chunks**, each with an `X-Offset`.
   - Parallel chunks overlap the ~130 ms tunnel latency instead of adding it up.
   - The tunnel has an unknown limit on data in flight, so the app starts cautiously, backs off after
     errors and climbs back after a run of successes.
4. **Resume after errors.** After a chunk error the app asks the server for its real offset and
   continues from there.

Two pitfalls are handled explicitly:
- **Logs during a transfer.** Log messages are buffered and sent only after the transfer finishes,
  because a concurrent request on the same tunnel breaks the upload.
- **Immediate stop.** The cancel request is kept in a ref, not in state, so the upload loop sees it
  immediately.

## Verification by content

`hooks/use-verify.ts` decides whether an item may be deleted from the phone.

**Why not by name.** iOS reuses `IMG_XXXX` names after a few months. A matching name is therefore
evidence, not proof.

**Why MD5.** It is the only digest Expo Go can compute on its own
(`getInfoAsync(uri, { md5: true })`).

**Choosing the method.** A probe on one asset picks the cheapest method that works on the device, in
this order:
1. digest of the library file;
2. digest of a sandbox copy;
3. size only, as a last resort, which makes the verification incomplete.

The report always states which method was used.

## Running

```bash
npm install
npx expo start          # open in Expo Go on the iPhone
```

The server address is the constant `SERVER_BASE` in `app/(tabs)/upload-test.tsx` and
`app/(tabs)/verify.tsx`. Set it to your own tunnel, e.g. `ngrok http 9001` in front of
`skill-bill-srv`.

Permissions used: the media library (reading items and, on the Verify screen, a confirmed test
deletion), the camera and the motion sensors (Home screen).

## Notes

- Built for Expo SDK 54 (`expo-router`, `expo-media-library`, `expo-file-system/legacy`, `expo-image`
  for `ph://` identifiers, which the built-in React Native `Image` cannot display).
- The project started as a receipt-scanning idea, hence the camera permission text and the OCR
  libraries listed in `requirements.txt` (used in desktop experiments, not by the app). The
  browser-based receipt OCR continued as
  [Camera OCR in the browser](https://neuroanimal.github.io/ocr_in_browser/skill-bill-modular/).
- `app/(tabs)/index.tsx.bk*` are saved stages of the Home screen's development.
