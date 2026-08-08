# Security Policy

## Supported Versions

Only the latest version on the `main` branch is actively supported with security updates.

## Security Architecture

- **Network Isolation:** The built-in Express webserver is designed for OBS browser sources. Bind it to a private network, a loopback interface (127.0.0.1), or run it within a zero-trust mesh VPN environment like Tailscale. Never expose it to the public internet.
- **Secret Management:** Manage OAuth tokens and API keys via a local `.env` file. Automated Continuous Integration scans prevent credential leakage.
- **Access Control:** Privileged commands enforce strict role verification using Twitch API badge tags. Regex input validation prevents command injection.

## Reporting a Vulnerability

Do not open public issues for security vulnerabilities.

Report issues privately to the maintainer via GitHub Private Message or Discord Private DM.

## Live Testing Consequences

This bot operates for a public streamer. Publicly attempting to break the bot, escalate privileges, or inject code while live on air is strictly prohibited unless you have the explicit permission of the streamer. Such actions may result in severe consequences, up to and including a permanent ban from the stream and community.
