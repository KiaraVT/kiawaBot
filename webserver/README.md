# Kiara Bot Web Server

A standalone web server component for accessing Kiara Bot data through a web dashboard and REST API. Runs alongside the bot in the same Docker container.

## Features

- **Web Dashboard**: View streaks, quotes, and commands data in a user-friendly interface
- **REST API**: JSON endpoints for programmatic access to bot data
- **Integrated**: Runs alongside the bot in a single Docker container
- **Read-only Access**: Safely serves data without modifying bot files

## Endpoints

### Web Dashboard
- `http://127.0.0.1:8081/` - Main dashboard with navigation
- `http://127.0.0.1:8081/streaks` - Streaks data page
- `http://127.0.0.1:8081/quotes` - Quotes data page  
- `http://127.0.0.1:8081/commands` - Commands data page

### REST API
- `http://127.0.0.1:8081/api/streaks` - Get streaks data as JSON
- `http://127.0.0.1:8081/api/quotes` - Get quotes data as JSON
- `http://127.0.0.1:8081/api/commands` - Get commands data as JSON
- `http://127.0.0.1:8081/health` - Health check endpoint

## Running

### With Docker Compose (Recommended)
```bash
npm run compose:up
```
Both the bot and web server will run in a single container.

### Standalone Development
```bash
# Run just the web server
npm run webserver

# Run web server with auto-reload
npm run webserver:dev

# Run both bot and web server locally
npm start        # Bot only
npm run webserver # Web server in another terminal
```

## Environment Variables

- `WEB_PORT` - Port to run the web server on (default: 8081)
- `NODE_ENV` - Environment (production/development)

## Docker

Both the bot and web server run in a single container with:
- Shared access to bot data files
- Health checks via web server endpoint
- Non-root user for security
- Ports 3000 (OAuth) and 8081 (web) exposed

## Data Access

The web server accesses bot data files from the shared `data/` directory:
- `../data/streaks.json` - User streak information
- `../data/quotes.json` - Bot quotes
- `../data/command_List.json` - Custom commands