# Helium Voice

A web page that makes your voice sound like you've breathed in helium. Open it in your phone's browser, tap the mic, talk, then tap again to hear the result.

- Nothing to install: the page is one HTML file plus `helium.js`.
- All processing happens on the phone. No audio is uploaded.
- **Helium amount** raises your voice's resonances (formants), which is what helium really does. **Pitch** raises the note you're speaking at.
- **Save** shares or downloads the result as a WAV file.

## How it works

Helium doesn't make your vocal cords vibrate faster. It makes sound travel faster, which raises the resonances of your throat and mouth. `helium.js` recreates this with PSOLA:

1. Find the pitch of your voice.
2. Cut the recording into grains, one per vocal-cord pulse.
3. Squeeze each grain in time. This raises the formants.
4. Lay the grains back down at the original spacing, or slightly tighter if Pitch is above ×1.

## Running it on your phone

Browsers only allow microphone access on **https** pages, so the page needs hosting. The easiest free option is GitHub Pages:

1. Go to the repo on GitHub → **Settings → Pages**.
2. Under "Build and deployment", pick **Deploy from a branch**. Choose the branch this code is on and the `/ (root)` folder. Save.
3. After a minute, open `https://<your-username>.github.io/helium-voice/` on your phone and allow the microphone when asked.
4. Optional: use "Add to Home Screen" to launch it like an app.

To test on a computer, serve the folder locally, for example with `python3 -m http.server`, and open `http://localhost:8000`. Browsers allow the mic on localhost.
