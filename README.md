# 1 Million Checkboxes

A real-time, multiplayer grid of one million checkboxes that anyone on the internet can click — inspired by the viral "One Million Checkboxes" concept. Every checkbox toggle is synced instantly to every connected client over WebSockets, backed by a Redis bitfield so the entire board state lives in a single, compact 125 KB structure.

Click a box and watch it flip live for every other visitor, see who's currently online, watch a running global click counter, and hover any checkbox to see who checked it and how long a guest's claim on it has left before it resets.

## How it works

- **State storage** — all 1,000,000 checkbox states are packed into a single Redis **bitfield** (`SETBIT`/`GETBIT`) under one key, so the whole board can be fetched as a base64-encoded buffer in one round trip.
- **Real-time sync** — a Socket.IO server broadcasts every toggle to all connected clients, and a Redis pub/sub channel keeps multiple backend instances in sync with each other (so the app can scale horizontally).
- **Atomic toggles** — checkbox ownership and state changes are applied via a single Lua script executed atomically inside Redis, preventing race conditions when many users click the same box at once.
- **Guests vs. authenticated users** — anyone can click as a guest, but a guest's claim on a checkbox expires after a short TTL (via Redis keyspace notifications) and can be overwritten by anyone else. Signing in with Google makes your checkbox claims permanent and exclusive to you.
- **Client rendering** — the frontend uses `react-window`'s virtualization (`Grid`) plus a plain `Uint8Array` for checkbox state so a million checkboxes can render and update without triggering a full React re-render on every toggle.

## Features

- 1,000,000 individually clickable, virtualized checkboxes rendered smoothly in the browser
- Real-time updates across all connected clients via Socket.IO
- Live "active users online" counter
- Live global click counter
- Hover tooltips showing a checkbox's current owner and time remaining before a guest claim expires
- Google Sign-In (SSO) for permanent, personally-owned checkbox claims
- Guest mode with temporary (auto-expiring) claims, so the board doesn't get permanently "used up"
- Horizontally scalable backend via Redis pub/sub — run multiple API instances behind a load balancer and they'll stay in sync

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, `react-window` for grid virtualization |
| Realtime transport | Socket.IO (client + server) |
| Backend | Node.js, Express 5 |
| Data store | Redis / Valkey (bitfields, pub/sub, keyspace notifications, Lua scripting) |
| Auth | Google Sign-In (`google-auth-library`), signed session cookies |
| Deployment | Docker, Caddy (reverse proxy), Traefik labels for the author's production setup |

## Prerequisites

- Node.js 20+
- Docker (to run Redis/Valkey locally), or a Redis instance you already have
- A Google Cloud OAuth 2.0 Client ID/Secret if you want Google Sign-In enabled (optional — the app falls back to guest-only mode without it)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/MEHULARORA11/1-Million-CheckBoxes.git
cd 1-Million-CheckBoxes
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start Redis (Valkey)

The repo ships a `docker-compose.yml` that spins up a local Valkey (Redis-compatible) instance on port `6379`:

```bash
docker compose up -d
```

### 4. Configure environment variables

Create a `.env` file in the project root:

```env
# Redis connection string used by the backend
VITE_REDIS_URL=redis://localhost:6379

# URL of the frontend, used for CORS on the backend
VITE_FRONTEND_URL=http://localhost:5173

# Port the Express/Socket.IO backend listens on
VITE_PORT=8000

# Google Sign-In (optional — omit to run in guest-only mode)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

The frontend also reads its own environment variable (Vite convention, so it can go in the same `.env` at the project root or a `.env` picked up by Vite):

```env
# URL of the backend API/Socket.IO server, used by the React app
VITE_BACKEND_URL=http://localhost:8000
```

### 5. Run the backend

```bash
npm start
```

This starts the Express + Socket.IO server (`index.js`) on `VITE_PORT` (default `8000`).

### 6. Run the frontend

In a separate terminal:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to see the board.

## Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite dev server for the React frontend |
| `npm run build` | Build the frontend for production |
| `npm run preview` | Preview the production frontend build locally |
| `npm start` | Start the Express + Socket.IO backend (`node index.js`) |
| `npm run lint` | Run ESLint |

## Project structure

```
index.js                     # Express + Socket.IO backend: auth, checkbox toggle API, realtime sync
redis-connection.js          # Redis/Valkey client, publisher, and subscriber connections
constant.js                  # Shared constants: checkbox count, Redis keys, guest TTL
components/
  activeUserCounter.jsx      # Live "users online" display
  globalClickCounter.jsx     # Live global click counter display
src/
  App.jsx                    # Main frontend app: virtualized checkbox grid, sockets, hover/tooltip logic
  App.css                    # Styles
  main.jsx                   # React entry point
public/                      # Static assets (favicon, icons)
docker-compose.yml           # Local Redis/Valkey for development
docker-compose.server.yml    # Production deployment compose file (Traefik + Caddy) used by the author
Caddyfile                    # Reverse proxy config for production deployment
Dockerfile                   # Container image for the backend
```

## Deployment

`Dockerfile` builds a production image for the backend. `docker-compose.server.yml` and `Caddyfile` reflect the author's own production setup (behind Traefik with TLS and a Caddy reverse proxy) — you don't need them for local development, but they're a useful reference if you're deploying this yourself.

## License

No license has been specified for this repository. All rights reserved by the author unless a license file is added.