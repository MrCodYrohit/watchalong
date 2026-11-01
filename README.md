# SyncStream — Real-Time Peer-to-Peer Watch Party

> Ultra-low-latency, high-definition watch party application for streaming Netflix, YouTube, Prime Video, Disney+, or local movies together with friends — complete with synchronized tab audio, live webcam/mic feeds, interactive emoji reactions, and passcode-gated rooms.

**Supports two deployment models:**
1. **100% Serverless on GitHub Pages** (Zero backend, zero costs, serverless encrypted MQTT signaling).
2. **Full-Stack Node.js / Docker** (Express + Socket.IO server).

---

## 🌟 Key Features

- 🔊 **Synchronized Tab Audio**: Captures crystal-clear browser tab audio alongside video so everyone hears the movie in real time.
- 📺 **Ultra High-Definition Video (25 Mbps)**: Custom WebRTC SDP bitrate booster with `contentHint="detail"` and `degradationPreference="maintain-resolution"` to keep subtitles sharp and prevent blur.
- 🔒 **Passcode-Protected Gatekeeper**: Room creation is locked behind a secret room passcode (configured in `.env`).
- 🔗 **Smart Invite Links with Auto-Expiration**:
  - Friends join via direct invite links without needing the secret passcode.
  - **Auto-Invalidation**: Once everyone leaves the party, the invite link expires automatically. Nobody can recreate or reopen an empty room without knowing the secret passcode.
- 🎙️ **Full-Mesh WebRTC Video & Audio**: Live face cams and microphones with real-time waveform equalizer bars and speaking detection.
- 🔔 **Room-Wide Audio Soundcheck**: Play a synchronized 4-tone chime across all participants' speakers to verify audio output before starting the movie.
- 🚀 **Built-in Master Audio Booster**: Amplify quiet movie audio up to **200%** using the Web Audio API gain booster.
- 💬 **Live Chat & Floating Reactions**: Real-time room text chat and animated floating emoji reactions (🍿, ❤️, 😂, 🔥, 👏, 😱).
- 🎬 **DRM & Cinema Guide**: In-app instructions to bypass DRM black screens on streaming platforms (Chrome Settings → Turn off Hardware Acceleration).

---

## 🏛️ High-Level Design (HLD) & Architecture

SyncStream is designed around a **Decoupled Signaling & Peer-to-Peer Media Architecture**. Signaling carries lightweight room metadata, while all heavy video and audio streams flow directly peer-to-peer between user browsers via encrypted WebRTC.

```
                     ┌──────────────────────────────────────────────┐
                     │          Passcode Gatekeeper                 │
                     │  (VITE_SECRET_ROOM_CODE / Secret Validation) │
                     └──────────────────────┬───────────────────────┘
                                            │
                                            ▼
                     ┌──────────────────────────────────────────────┐
                     │                 Room Lobby                   │
                     │  - Camera/Mic Hardware Preview               │
                     │  - Avatar Selection & Display Name           │
                     │  - Host vs Invited Guest Role Check          │
                     └──────────────────────┬───────────────────────┘
                                            │
               ┌────────────────────────────┴───────────────────────────┐
               ▼                                                         ▼
 ┌───────────────────────────┐                             ┌───────────────────────────┐
 │   Signaling Layer (P2P)   │                             │   Full-Stack Signaling    │
 │   - Public MQTT over WSS  │◄──────[Default / GH Pages]─►│   - Express / Socket.IO   │
 │   - Zero-server overhead  │                             │   - Node.js backend       │
 └─────────────┬─────────────┘                             └─────────────┬─────────────┘
               │                                                         │
               └────────────────────────────┬────────────────────────────┘
                                            │ Exchange SDP Offers/Answers & ICE
                                            ▼
                 ┌─────────────────────────────────────────────────────┐
                 │          Full-Mesh WebRTC Media Network             │
                 │                                                     │
                 │   Host Browser                      Guest Browser   │
                 │   ┌───────────────┐                 ┌─────────────┐ │
                 │   │ Tab Video/Aud ├────────────────►│ Display /   │ │
                 │   │ Webcam / Mic  │◄───────────────►│ Speakers    │ │
                 │   └───────────────┘  Direct P2P     └─────────────┘ │
                 │                     Encrypted Media                 │
                 └─────────────────────────────────────────────────────┘
```

### Component Breakdown

| Layer | Files | Purpose |
| :--- | :--- | :--- |
| **Passcode Gate** | `src/components/LandingGate.tsx`, `src/config.ts` | Authenticates room creators against the secret code before allowing room hosting. |
| **Lobby Setup** | `src/components/Lobby.tsx` | Provides live webcam/mic preview, volume level metering, and enforces guest restrictions. |
| **Watch Party Hub** | `src/components/WatchPartyRoom.tsx` | Main theatre layout with screen stage, remote tiles, floating reactions, soundcheck, and chat. |
| **Media Tiles** | `src/components/ParticipantTile.tsx` | Renders webcam feeds with live equalizer audio activity and autoplay unblocking. |
| **WebRTC Mesh** | `src/services/webrtc.ts` | Manages RTCPeerConnections, transceivers, SDP bitrate boost (25 Mbps), and dynamic stream cloning. |
| **Signaling Engine** | `src/services/serverlessSignaling.ts` | Serverless signaling over secure WebSockets via MQTT broker with direct peer channel fallback. |
| **Audio Synthesizer**| `src/services/sound.ts` | Procedural Web Audio API sound generator for soundcheck chimes and interaction feedback. |

---

## 🔒 Security & Access Control Flow

```
                      User Opens App
                            │
               Has ?room=<id> invite link?
                     ┌──────┴──────┐
                    YES            NO
                     │              │
                     ▼              ▼
             Join via Invite   Must Enter Secret Passcode
                     │         (VITE_SECRET_ROOM_CODE)
                     ▼              │
             Room has peers?        ▼
               ┌─────┴─────┐   Valid Passcode?
              YES          NO   ┌───┴───┐
               │           │   YES      NO
               ▼           ▼    │        │
          Enter Room    EXPIRED │      Denied
          (Can Watch)   (Go to Gate)   (Retry)
```

1. **Host Access**: Anyone wanting to host or start a new party **must** supply the configured secret passcode.
2. **Guest Access**: Invited guests opening an invite link bypass the secret gate directly into the room.
3. **Empty Room Invalidation**: When everyone leaves a party, the invite link becomes expired. If someone clicks an expired link, the system checks peer presence, rejects the join attempt, and prompts for the secret passcode.

---

## 💻 Local Setup & Development

Follow these steps to run the application on your computer.

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Google Chrome / Chromium-based browser** (recommended for screen sharing with tab audio)

### Step 1: Clone the Repository

```bash
git clone <your-repository-url>
cd syncstream
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

Copy the example configuration to `.env`:

```bash
cp .env.example .env
```

Open `.env` in your text editor and customize the secret room passcode:

```env
# Secret code required for room creation and host access
VITE_SECRET_ROOM_CODE="your-secret-passcode-here"
SECRET_ROOM_CODE="your-secret-passcode-here"
PORT=3000
```

### Step 4: Start the Local Development Server

```bash
npm run dev
```

Open your browser to [http://localhost:3000](http://localhost:3000).

---

## 🧪 Testing Locally (Multi-User Simulation)

You can easily test the watch party on a single computer:

1. **Host Tab**:
   - Open [http://localhost:3000](http://localhost:3000).
   - Enter your secret passcode.
   - Click **Start Watch Party**.
   - Copy the shareable invite link from the top bar (e.g. `http://localhost:3000/?room=party-xyz`).
2. **Guest Tab (Incognito or Second Browser)**:
   - Open an **Incognito Window** or a second browser (Edge/Brave/Firefox).
   - Paste the invite link.
   - Notice you bypass the passcode gate directly to the Lobby!
   - Click **Join Watch Party**.
3. **Screen Sharing & Tab Audio**:
   - On the Host tab, click **Share Screen with Sound**.
   - Select **Chrome Tab**, choose a YouTube/Netflix video, and make sure **"Also share tab audio"** is checked.
   - The video and sound will immediately sync to the guest!
4. **Soundcheck Chime**:
   - Click the **Soundcheck** button on either tab — the resonant 4-tone chime will ring across both browsers!

---

## 🚢 Production Deployment Options

### Option A: 100% Serverless on GitHub Pages (Free)

The repository includes a ready-to-use GitHub Actions workflow (`.github/workflows/deploy.yml`).

1. Push your code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Deploy to GitHub Pages"
   git branch -M main
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```
2. In your repository on GitHub:
   - Go to **Settings** → **Secrets and variables** → **Actions**.
   - Add a repository secret `VITE_SECRET_ROOM_CODE` with your desired secret passcode.
   - Go to **Settings** → **Pages** → under **Source**, select **GitHub Actions**.
3. Your watch party is live at `https://<username>.github.io/<repo>/`!

### Option B: Node.js Server (Render / Railway / Cloud Run / VPS)

```bash
# Build the client and compile server
npm run build

# Start the production server
npm start
```

Set the environment variables in your hosting provider's dashboard:
- `SECRET_ROOM_CODE`: Your secret room passcode
- `PORT`: `3000` (or the port assigned by your provider)

---

## 💡 Streaming Tips & Troubleshooting

- **How to Stream Netflix / Prime Video without a Black Screen**:
  Due to DRM hardware protection, streaming services render a black screen by default when captured.
  To fix: Open Chrome Settings → Search **"Graphics Acceleration"** → Turn **OFF** *"Use graphics acceleration when available"* → Relaunch Chrome.
- **Audio Soundcheck**:
  Before playing the movie, click the **Soundcheck** button in the bottom dock to ensure all remote viewers have their speakers active.
- **Boost Volume**:
  Use the volume slider in the top bar to amplify quiet movie dialogue up to **200%**.
