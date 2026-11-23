# Hyphan Breath

A zero-dependency, offline-first **Wim Hof–style breathing Progressive Web App (PWA)** designed specifically for **iPad 10** (portrait & landscape, full-screen Home Screen app).

## Features

- **3-Phase Guided Protocol**
  - **Power Breathing**: Configurable rounds (`1–10`), breaths per round (`15–60`, quick presets `20 / 30 / 40 / 50`), and a continuous **Breathing Pace slider** (`5.0s` slower to `1.8s` faster per breath) adjustable both before and live during a round.
  - **Breath Retention**: Passive exhale hold stopwatch with Screen Wake Lock, optional 30-second milestone chimes, optional ambient retention drone, and a prominent **Breathe In** button (or tap the orb / press `Space`).
  - **Untimed Recovery Inhale & Full Hold**: Continuous, seamlessly crossfaded inhale sound while you fill your lungs at your own pace, followed by a dedicated **Start 15s Hold** (configurable `10–30s`) button.
- **Eyes-Closed Audio & Voice Cues**
  - 100% synthesized offline Web Audio (no external MP3s).
  - Rising harmonic + subtle bell cue on the **final 3 breaths** of each round.
  - Optional calm spoken **Voice Prompts** (Web Speech API) for last breath, holds, minute milestones, and release.
  - **Master Volume** slider, independent toggles, and a **Test Audio** button.
- **iPad-Focused UI**
  - **Dim / Night Mode** (`#000000` low-glare theme for dark rooms or bedtime).
  - Distraction-free active session chrome.
  - Local session history, per-round retention bars, personal best tracking, and trend chart stored in `localStorage`.

## Safety Notice

> **Important:** Always practice sitting or lying down in a safe environment. **Never** practice in or near water (bath, pool, ocean), while driving, or standing up. Tingling and lightheadedness are normal; stop immediately if you feel unwell.

## Install on iPad 10

### Recommended: Host via HTTPS (Hostinger, GitHub Pages, Cloudflare Pages, Netlify)
HTTPS unlocks **iPadOS Screen Wake Lock** and **100% offline Service Worker caching**.
1. Deploy this repository (all paths are relative, so it works at a root domain, subdomain, or subfolder).
2. Open the `https://` URL in **Safari** on your iPad.
3. Tap **Share** → **Add to Home Screen**.
4. Launch **Hyphan Breath** full-screen from your Home Screen (ensure iPad Silent Mode is off if you don't hear audio).

### Local Wi-Fi Preview
```powershell
python -m http.server 8080 --directory .
```
Then open `http://<your-computer-ip>:8080` in Safari on your iPad.

## Project Structure

```text
├── index.html            # Standalone PWA markup & views
├── styles.css            # iPad responsive layout, aurora & night mode themes
├── app.js                # Breathing state machine, Wake Lock, settings & history
├── audio.js              # Offline Web Audio synthesizer & voice cues
├── manifest.webmanifest  # iPadOS / PWA standalone configuration
├── sw.js                 # Offline Service Worker cache
└── icons/                # Custom SVG & PNG Home Screen icons (180, 192, 512)
```
