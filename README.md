# KiaraBot

KiaraBot is an integrated stream companion bot, live overlay, and web dashboard designed for Twitch and YouTube streaming. It provides chat moderation, custom commands, live quote management, viewer streak tracking, donation goal tracking, and an animated OBS browser overlay powered by WebSockets.

---

## Architecture Overview

KiaraBot is built on Node.js 22 (ESM) and consists of four primary components:

```
+-------------------------------------------------------------+
|                     start.js (Supervisor)                   |
+------------------------------+------------------------------+
                               |
            +------------------+------------------+
            |                                     |
            v                                     v
+-------------------------------------+             +-----------------------+
|         Kiara_bot.js (Core)         |             |  webserver/server.js  |
| - Twitch EventSub & Helix API       |             | - Express 5.2.1 REST  |
| - YouTube API Polling               |             | - Web Dashboard Views |
| - WebSocket Broadcaster             |             | - OBS Overlay Host    |
| - Quote / Goal State                |             | - Healthcheck (/health|
+------------------+------------------+             +-----------+-----------+
            |                                     |
            |            WebSocket Feed           |
            +------------------------------------>+
                                                  |
                                                  v
                                      +-----------------------+
                                      | webserver/www/        |
                                      | chatwidget.html (OBS) |
                                      +-----------------------+
```

### 1. Process Supervisor (`start.js`)
Coordinates the application services as managed child processes:
- Spawns and supervises `webserver/server.js` and `Kiara_bot.js`.
- Forwards and prefixes stdout and stderr streams for centralized logging.
- Manages graceful shutdown across all processes upon receiving `SIGTERM` or `SIGINT`.

### 2. Bot Core (`Kiara_bot.js`)
Handles stream platform integration and chat interactivity:
- **Twitch EventSub WebSocket & Helix API**: Ingests chat messages (`channel.chat.message`) and event subscriptions via EventSub WebSocket (`tesjs`) and dispatches bot responses via Twitch Helix REST API (`POST /helix/chat/messages`).
- **Twitch OAuth Lifecycle**: Manages access tokens and automatic refresh routines with `AuthDataHelper.js`.
- **YouTube Data API**: Polls live broadcast status and stream metrics.
- **Overlay Broadcast**: Runs a WebSocket server (`ws`) broadcasting formatted messages, emotes, and badge metadata to connected overlay clients.

### 3. Web Dashboard and REST API (`webserver/server.js`)
Runs an Express 5 web service on port `8081` (configurable via `WEB_PORT`):
- Serves responsive HTML dashboards for inspecting runtime stream state.
- Exposes RESTful JSON endpoints for external tools and automation.
- Hosts the browser source chat overlay for OBS Studio (`/chatwidget`).
- Provides container health monitoring at `/health`.

### 4. OBS Chat Overlay (`webserver/www/chatwidget.html`)
A browser overlay client that connects to the bot WebSocket server, rendering Twitch emotes, subscriber badges, and chatter messages in real time.

---

## Chat Commands Reference

KiaraBot supports built-in and user-defined chat commands:

| Command | Arguments | Permissions | Description |
|---|---|---|---|
| `!quote` | `[id]` | Everyone | Retrieves a random quote, or a specific quote by numerical ID. |
| `!addquote` | `<text>` | Mods / Streamer | Adds a new quote to the database with an auto-incrementing ID. |
| `!editquote` | `<id> <text>` | Mods / Streamer | Updates the text of an existing quote by ID. |
| `!removequote` | `<id>` | Mods / Streamer | Deletes a quote from the database by ID. |
| `!addcommand` | `<tag> <response>` | Mods / Streamer | Registers a new custom command (invoked via `!<tag>`). |
| `!editcommand` | `<tag> <response>` | Mods / Streamer | Updates an existing custom command's response text. |
| `!so` | `<channel>` | VIPs / Mods | Generates a shoutout link for a featured streamer. |
| `!duel` | `[user]` | Everyone | Initiates or accepts a chat minigame duel between viewers. |
| `!addincentive` | `<amount>` | Mods / Streamer | Adds a contribution amount toward the active stream goal. |
| `!updateincentive` | `<command> <goal>` | Mods / Streamer | Configures the incentive trigger command name and target amount. |

---

## Web Dashboard and API Endpoints

The web server (`http://127.0.0.1:8081`) exposes the following endpoints:

| Endpoint | Method | Format | Description |
|---|---|---|---|
| `/` | `GET` | HTML | Main navigation dashboard. |
| `/streaks` | `GET` | HTML | Viewer attendance streak tracker view. |
| `/quotes` | `GET` | HTML | Quote database dashboard view. |
| `/commands` | `GET` | HTML | Registered custom chat commands view. |
| `/incentives` | `GET` | HTML | Live stream donation goal tracker view (auto-refreshes every 10s). |
| `/chatwidget` | `GET` | HTML | OBS Studio browser source chat overlay. |
| `/health` | `GET` | JSON | Container and service healthcheck (`{ "status": "ok" }`). |
| `/api/streaks` | `GET` | JSON | Programmatic access to streak data (`streaks.json`). |
| `/api/quotes` | `GET` | JSON | Programmatic access to quote records (`quotes.json`). |
| `/api/commands` | `GET` | JSON | Programmatic access to custom command list (`command_List.json`). |

---

## OBS Studio Overlay Setup

To display the chat widget in OBS Studio:
1. Ensure the web server is running (`npm start` or Docker).
2. In OBS Studio, add a new **Browser Source**.
3. Set the **URL** to:
   ```
   http://127.0.0.1:8081/chatwidget
   ```
4. Set the recommended dimensions (e.g., Width: `450`, Height: `700`).
5. Check **Shutdown source when not visible** and click **OK**.

---

## Prerequisites

- **Node.js**: 22.0.0 or higher
- **npm**: 10.0.0 or higher
- **Python**: 3.12 or higher (for CI verification scripts and security tooling)
- **Docker & Docker Compose**: Optional, for containerized deployments

---

## Installation and Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/KiaraVT/kiawaBot.git
   cd kiawaBot
   ```

2. **Install locked dependencies**:
   ```bash
   npm ci
   ```

3. **Configure Environment Variables**:
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in the required credentials:

   | Variable | Description |
   |---|---|
   | `CLIENT_ID` | Twitch Developer Application Client ID |
   | `CLIENT_SECRET` | Twitch Developer Application Client Secret |
   | `BOT_NAME` | Twitch username of the bot account |
   | `BOT_ID` | Twitch user ID of the bot account |
   | `BROADCASTER_NAME` | Twitch channel name where the bot operates |
   | `BROADCASTER_ID` | Twitch channel user ID |
   | `WEB_PORT` | Port for the dashboard and overlay server (default: `8081`) |
   | `NODE_ENV` | Runtime environment (`production` or `development`) |

---

## Running KiaraBot

### Local Development

Run both the bot and web server under the supervisor:
```bash
npm start
```

Run only the web server with live reload:
```bash
npm run webserver:dev
```

Run only the web server directly:
```bash
npm run webserver
```

### Docker Deployment

Build the container image:
```bash
npm run docker:build
# or: docker build -t kiara-bot .
```

Run with Docker Compose:
```bash
npm run compose:up
```

Stop Docker Compose services:
```bash
npm run compose:down
```

---

## Testing and Quality Verification

The repository enforces automated unit testing, linting, and security audits:

```bash
# Run Node.js unit and integration test suite
npm test

# Run ESLint validation
npm run lint

# Run Python CI verification test suite
python -m unittest discover tests

# Verify dependency security against npm audit baseline
python scripts/check_npm_audit.py

# Run heuristic secret detection on tracked files
python scripts/check_secrets_heuristic.py

# Verify review policies against the upstream agents-personas specifications
python scripts/check_policy_drift.py
```

---

## Automated Pull Request Reviews (agents-personas)

Reviewer personas run on the shared review engine in [abuzucom/agents-personas](https://github.com/abuzucom/agents-personas), pinned at commit `1649e5c9710fd85d6cca12006e344af27a5404a6`. The engine resolves the pull request, builds the review case, calls the model, and publishes one check run and one comment per persona.

### Always-on personas

`.github/workflows/persona-review.yml` evaluates every pull request after CI completes:

| Persona | Check name | Policy | Documentation |
|---|---|---|---|
| `euler` | `euler / quality` | `reviewers/euler/QUALITY.md` | [docs/pr-quality-review.md](docs/pr-quality-review.md) |
| `foucault` | `foucault / security` | `reviewers/foucault/AUDIT.md` | [docs/pr-security-review.md](docs/pr-security-review.md) |

Both personas run for every pull request CI outcome. A pull request author cannot suppress a review by changing the CI workflow.

### Label-triggered personas

`.github/workflows/persona-review-labels.yml` evaluates a pull request when a maintainer adds the matching scan label:

| Persona | Check name | Scan label | Policy | Documentation |
|---|---|---|---|---|
| `generay` | `generay / time` | `generay-scan-requested` | `reviewers/generay/TIME.md` and `reviewers/generay/SYNC.md` | [docs/pr-time-review.md](docs/pr-time-review.md) |
| `adorno` | `adorno / ui` | `adorno-scan-requested` | `reviewers/adorno/bundles/ui-full.md` | [docs/pr-ui-review.md](docs/pr-ui-review.md) |
| `havel` | `havel / privacy` | `havel-scan-requested` | `reviewers/havel/bundles/all-full.md` | [docs/pr-privacy-review.md](docs/pr-privacy-review.md) |

Only a person with triage access or higher can add a label. A new push to a labeled pull request reviews again. The `stop-requested` label pauses every persona, and removing it reviews the current head again. The havel persona declares no legal scope, so the review applies the baseline privacy classes alone.

### Model Authentication
The engine supplies its own model adapter. The callers map either `OLLAMA_API_KEY` or `MODEL_API_KEY` to the engine secret `MODEL_API_KEY`.

### Review Gating
Every review runs through the protected `fork-review` GitHub environment. A maintainer approves the deployment before the provider key reaches a job. The environment holds no secrets. The provider key is the repository-level `OLLAMA_API_KEY` secret.

Pull request files reach the engine as git objects and never execute. The engine reads the pull request title, description, and diff as untrusted text.

### Review Scope
The always-on personas skip pull requests that change only `CHANGELOG.md`, `README.md`, or `docs/**`. The `euler-scan-requested` and `foucault-scan-requested` labels override that filter.

A BLOCK verdict fails the check. A NEEDS-HUMAN verdict warns and concludes neutral.

### Policy Drift Verification
Local policy documentation incorporates exact upstream specifications. Run the drift check script to verify SHA-256 integrity:
```bash
python scripts/check_policy_drift.py
```

