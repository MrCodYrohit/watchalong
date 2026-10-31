# SyncStream — Real-Time Watch-Along Web Application (100% GitHub Pages / Serverless P2P)

A peer-to-peer watch party web application that allows friends to sync up and watch content together from YouTube, Netflix, Prime Video, or any browser tab/screen with crystal-clear 1080p/4K video, browser tab audio, WebRTC webcam/mic feeds, and live chat.

**Runs 100% serverless directly on GitHub Pages! No backend server, no database, and no hosting costs required.**

---

## Features

- **100% Serverless & GitHub Pages Ready**: Zero backend required. Signaling runs through encrypted public WebSockets, and media streams 100% peer-to-peer directly between browsers.
- **Passcode-Protected Room Creation & Entry**: Gatekeeper requiring the secret passcode (`Rohit ko baap bol 15`).
- **Instant Invite Links**: Generate direct invite links that allow friends to bypass the secret code and jump straight into the room.
- **Ultra High-Definition Screen Sharing**: Tuned WebRTC pipeline with 25 Mbps bandwidth, `contentHint = "detail"`, and `degradationPreference = "maintain-resolution"` for crisp subtitles and text.
- **Tab & System Audio Streaming**: Captures browser audio alongside video so everyone hears the show.
- **Webcam & Microphone Feeds**: Floating participant tiles with live video and audio.
- **Real-Time Text Chat & Reactions**: Live chat room with animated floating emoji reactions.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion, Vite
- **P2P Signaling**: Serverless Encrypted WebSocket Broker (zero server needed)
- **Streaming**: Native browser WebRTC Mesh with 25 Mbps SDP bandwidth boost

---

## Quick Start (Local Development)

```bash
# 1. Install dependencies
npm install

# 2. Run local development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## How to Deploy to GitHub Pages (Automated & 100% Free)

This repository includes a pre-configured GitHub Actions workflow (`.github/workflows/deploy.yml`) that builds and deploys your watch party automatically whenever you push to GitHub!

### Step 1: Push Code to Your GitHub Repository

```bash
git init
git add .
git commit -m "Deploy SyncStream to GitHub Pages"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```

### Step 2: Enable GitHub Pages in your Repository Settings

1. Open your repository on GitHub.
2. Go to **Settings** → **Pages** (under the "Code and automation" section on the left sidebar).
3. Under **Build and deployment** → **Source**, select **GitHub Actions**.
4. That's it! GitHub will automatically run the deployment workflow and give you your live URL:
   ```
   https://<your-username>.github.io/<your-repo-name>/
   ```

---

## Optional: Deploying as a Node.js Service (Render / Railway / Cloud Run)

If you prefer to run a dedicated Node.js service instead of GitHub Pages, this repository also includes `server.ts`:
- **Build**: `npm run build`
- **Start**: `npm start`
- **Environment Variable**: `SECRET_CODE="Rohit ko baap bol 15"`
