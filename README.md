# SignTalk AI

Gesture recognition with a shared KRSL vocabulary, Russian/Kazakh output and explicit text-to-speech. The main screen lets you capture one sign, check the hypothesis and use the result on the same page. Built on GestureSign. This remains experimental: output normalization does not make sign recognition reliable.

**[Инструкция на русском: README_RU.md](README_RU.md)**

**Version 0.7: messenger + video calls with live sign captions.** Accounts usable on several devices at once, search by unique ID (`ST-XXXXXX`), real-time chat, one-to-one WebRTC video calls in which the on-device KRSL/ASL models turn your signs into subtitles for the other person, speech captions and read-aloud for hearing partners. One Node server (SQLite file + WebSocket), deployable to Render with `render.yaml`. See **[docs/MESSENGER.md](docs/MESSENGER.md)** (in Russian).

```sh
npm ci && npm --prefix web ci   # server + web dependencies
npm --prefix web run dev        # http://localhost:5330/
npm test                        # server tests
```

**Version 0.6.** See [release notes and real cloud checks](docs/RELEASE_0.6.md). Cloud KRSL10 and the local model share exact label IDs. Free recognition remains separate. Speech replies and text communication are secondary tools.

Windows: install Node.js 24 LTS, extract the package and run `preview-windows.cmd` for the included build or `start-windows.cmd` for development. Open the printed localhost URL, not an HTML file.

```sh
cd web
npm ci
npm run dev
```

The KRSL model is a small ten-lexeme pilot trained on public hand-coordinate data with participant-held-out evaluation. The ASL model is NOT relabelled as KRSL. Full sentences and robust live-camera translation are not claimed. See `DATA_SOURCES.md`, `docs/VALIDATION.md` and the model reports.

GestureSign's original documentation is preserved in [README_UPSTREAM.md](README_UPSTREAM.md). Keep all original and third-party notices.

Version 0.3 adds a separate consent-based local hand-landmark dataset collector (RU/KZ), preview, relabel/retake/delete and JSON export. See [dataset guide](docs/DATASET_COLLECTION.md) and [Windows validation](docs/WINDOWS_VALIDATION.md). New samples do not retrain or extend any model automatically.

Version 0.4 adds a server-side Gemini video integration, separate Help/Gestures/Settings pages and a redesigned communication workspace. See [release notes](docs/RELEASE_0.4.md). API keys are not included in distribution archives.

Version 0.5 makes college conversation the default: ready phrases for class, the college office and peers; separate two-way text; large rotated display; opt-in browser captions and optional Gemini phrase assistance. See [product and release notes](docs/RELEASE_0.5.md). Conversation text stays in memory until reload; explicitly saved favorite phrases stay in this browser. Text conversation needs no API key or camera.
