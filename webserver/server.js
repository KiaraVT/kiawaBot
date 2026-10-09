import express from "express"
import jsonfile from "jsonfile"
import path from "path"
import fs from "fs"

const app = express();
const port = process.env.WEB_PORT || 8081;

// Data file paths - look in parent directory's data folder
const quote_Path = path.join(import.meta.dirname, '..', 'data', 'quotes.json');
const streak_Path = path.join(import.meta.dirname, '..', 'data', 'streaks.json');
const command_Path = path.join(import.meta.dirname, '..', 'data', 'command_List.json');
function getIncentivePath() {
    return process.env.INCENTIVE_PATH || path.join(import.meta.dirname, '..', 'data', 'incentives.json');
}

// Ensure data directory exists
const dataDir = path.join(import.meta.dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    console.log('Web Server: Creating data directory...');
    fs.mkdirSync(dataDir, { recursive: true });
}

// Helper function to safely read JSON files
function safeReadJSON(filePath, defaultValue = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            console.log(`Web Server: Creating default ${filePath}...`);
            jsonfile.writeFileSync(filePath, defaultValue, { spaces: 2, EOL: "\n" });
            return defaultValue;
        }
        return jsonfile.readFileSync(filePath);
    } catch (error) {
        console.error(`Web Server: Error reading ${filePath}:`, error);
        return defaultValue;
    }
}

// Helper function to escape HTML to prevent XSS
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// Web endpoint to serve streaks data
app.get("/api/streaks", (req, res) => {
    try {
        const streaksData = safeReadJSON(streak_Path, {});
        res.setHeader('Content-Type', 'application/json');
        res.json(streaksData);
    } catch (error) {
        console.error('Error reading streaks file:', error);
        res.status(500).json({ error: 'Failed to read streaks data' });
    }
});

// Web endpoint to serve quotes data
app.get("/api/quotes", (req, res) => {
    try {
        const quotesData = safeReadJSON(quote_Path, []);
        res.setHeader('Content-Type', 'application/json');
        res.json(quotesData);
    } catch (error) {
        console.error('Error reading quotes file:', error);
        res.status(500).json({ error: 'Failed to read quotes data' });
    }
});

// Web endpoint to serve commands data
app.get("/api/commands", (req, res) => {
    try {
        const commandsData = safeReadJSON(command_Path, []);
        res.setHeader('Content-Type', 'application/json');
        res.json(commandsData);
    } catch (error) {
        console.error('Error reading commands file:', error);
        res.status(500).json({ error: 'Failed to read commands data' });
    }
});

// Web endpoint to serve incentives data
app.get("/api/incentives", async (req, res) => {
    const defaultIncentive = {
        incentive: {
            command: '!update',
            amount: 0,
            goal: 0
        }
    };
    const MAX_INCENTIVE_FILE_SIZE = 1024 * 1024;
    try {
        let rawContent = null;
        const currentIncentivePath = getIncentivePath();
        try {
            const stat = await fs.promises.stat(currentIncentivePath);
            if (stat.size > MAX_INCENTIVE_FILE_SIZE) {
                console.error(`Incentive file exceeds allowed size limit (${stat.size} > ${MAX_INCENTIVE_FILE_SIZE})`);
                return res.status(413).json({ error: 'Incentive file exceeds allowed size limit' });
            }
            rawContent = await fs.promises.readFile(currentIncentivePath, 'utf8');
        } catch (readErr) {
            if (readErr.code !== 'ENOENT') {
                throw readErr;
            }
        }

        let incentiveData = defaultIncentive;
        if (rawContent) {
            try {
                incentiveData = JSON.parse(rawContent);
            } catch (parseErr) {
                console.error('Incentive file contains malformed JSON:', parseErr.message);
                return res.status(500).json({ error: 'Incentive file contains malformed JSON', details: parseErr.message });
            }
        }

        const validated = {
            incentive: {
                command: typeof incentiveData?.incentive?.command === 'string' ? incentiveData.incentive.command : '!update',
                amount: typeof incentiveData?.incentive?.amount === 'number' ? incentiveData.incentive.amount : 0,
                goal: typeof incentiveData?.incentive?.goal === 'number' ? incentiveData.incentive.goal : 0
            }
        };
        res.setHeader('Content-Type', 'application/json');
        res.json(validated);
    } catch (error) {
        console.error('Error reading incentive file:', error.message);
        res.status(500).json({ error: 'Failed to read incentive data' });
    }
});

// Simple HTML page to display the data
app.get("/streaks", (req, res) => {
    try {
        const streaksData = safeReadJSON(streak_Path, {});
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Kiara Bot - Streaks Data</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow: auto; }
                h1 { color: #333; }
                .nav { margin: 20px 0; }
                .nav a { margin-right: 15px; color: #0066cc; text-decoration: none; }
                .nav a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>Kiara Bot - Data Dashboard</h1>
            <div class="nav">
                <a href="/streaks">Streaks</a>
                <a href="/quotes">Quotes</a>
                <a href="/commands">Commands</a>
                <a href="/incentives">Incentives</a>
                <a href="/api/streaks">Streaks API</a>
                <a href="/api/quotes">Quotes API</a>
                <a href="/api/commands">Commands API</a>
                <a href="/api/incentives">Incentives API</a>
            </div>
            <h2>Streaks Data</h2>
            <pre>${escapeHtml(JSON.stringify(streaksData, null, 2))}</pre>
        </body>
        </html>`;
        res.send(html);
    } catch (error) {
        console.error('Error reading streaks file:', error);
        res.status(500).send('<h1>Error</h1><p>Failed to read streaks data</p>');
    }
});

// Simple HTML page to display quotes
app.get("/quotes", (req, res) => {
    try {
        const quotesData = safeReadJSON(quote_Path, []);
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Kiara Bot - Quotes Data</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow: auto; }
                h1 { color: #333; }
                .nav { margin: 20px 0; }
                .nav a { margin-right: 15px; color: #0066cc; text-decoration: none; }
                .nav a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>Kiara Bot - Data Dashboard</h1>
            <div class="nav">
                <a href="/streaks">Streaks</a>
                <a href="/quotes">Quotes</a>
                <a href="/commands">Commands</a>
                <a href="/incentives">Incentives</a>
                <a href="/api/streaks">Streaks API</a>
                <a href="/api/quotes">Quotes API</a>
                <a href="/api/commands">Commands API</a>
                <a href="/api/incentives">Incentives API</a>
            </div>
            <h2>Quotes Data</h2>
            <pre>${escapeHtml(JSON.stringify(quotesData, null, 2))}</pre>
        </body>
        </html>`;
        res.send(html);
    } catch (error) {
        console.error('Error reading quotes file:', error);
        res.status(500).send('<h1>Error</h1><p>Failed to read quotes data</p>');
    }
});

// Simple HTML page to display commands
app.get("/commands", (req, res) => {
    try {
        const commandsData = safeReadJSON(command_Path, []);
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Kiara Bot - Commands Data</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow: auto; }
                h1 { color: #333; }
                .nav { margin: 20px 0; }
                .nav a { margin-right: 15px; color: #0066cc; text-decoration: none; }
                .nav a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>Kiara Bot - Data Dashboard</h1>
            <div class="nav">
                <a href="/streaks">Streaks</a>
                <a href="/quotes">Quotes</a>
                <a href="/commands">Commands</a>
                <a href="/incentives">Incentives</a>
                <a href="/api/streaks">Streaks API</a>
                <a href="/api/quotes">Quotes API</a>
                <a href="/api/commands">Commands API</a>
                <a href="/api/incentives">Incentives API</a>
            </div>
            <h2>Commands Data</h2>
            <pre>${escapeHtml(JSON.stringify(commandsData, null, 2))}</pre>
        </body>
        </html>`;
        res.send(html);
    } catch (error) {
        console.error('Error reading commands file:', error);
        res.status(500).send('<h1>Error</h1><p>Failed to read commands data</p>');
    }
});
// Simple HTML page to display incentive
app.get("/incentives", (req, res) => {
    try {
        const defaultIncentive = {
            incentive: {
                command: '!update',
                amount: 0,
                goal: 0
            }
        };
        const rawData = safeReadJSON(getIncentivePath(), defaultIncentive);
        const incentive = (rawData && typeof rawData === 'object' && rawData.incentive) ? rawData.incentive : defaultIncentive.incentive;
        const command = incentive.command || '!update';
        const amount = typeof incentive.amount === 'number' ? incentive.amount : 0;
        const goal = typeof incentive.goal === 'number' ? incentive.goal : 0;
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="refresh" content="10">
            <title>Kiara Bot - Incentive Data</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                pre { background: #ffffff00; padding: 15px; border-radius: 5px; overflow: auto; color: #FFFFFF;
                font-family: sans-serif; font-weight: 600; font-size: 10rem;}
                h1 { color: #000000; }
                .nav { margin: 20px 0; }
                .nav a { margin-right: 15px; color: #0066cc; text-decoration: none; }
                .nav a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>Kiara Bot - Data Dashboard</h1>
            <div class="nav">
                <a href="/streaks">Streaks</a>
                <a href="/quotes">Quotes</a>
                <a href="/commands">Commands</a>
                <a href="/incentives">Incentives</a>
                <a href="/api/streaks">Streaks API</a>
                <a href="/api/quotes">Quotes API</a>
                <a href="/api/commands">Commands API</a>
                <a href="/api/incentives">Incentives API</a>
            </div>
            <h2>Incentive Data</h2>
            <pre>${escapeHtml(command)} $${amount.toFixed(2)} / $${goal.toFixed(0)}</pre>
        </body>
        </html>`;
        res.send(html);
    } catch (error) {
        console.error('Error reading incentive file:', error);
        res.status(500).send('<h1>Error</h1><p>Failed to read incentive data</p>');
    }
});
// Root endpoint with navigation
app.get("/", (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Kiara Bot - Data Dashboard</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .nav { margin: 20px 0; }
            .nav a { 
                display: block; 
                margin: 10px 0; 
                color: #0066cc; 
                text-decoration: none; 
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 5px;
                width: 200px;
            }
            .nav a:hover { 
                background: #f0f0f0; 
                text-decoration: underline; 
            }
            h1 { color: #333; }
        </style>
    </head>
    <body>
        <h1>Kiara Bot - Data Dashboard</h1>
        <p>Welcome to the Kiara Bot data dashboard. Select a data type to view:</p>
        <div class="nav">
            <a href="/streaks">View Streaks Data</a>
            <a href="/quotes">View Quotes Data</a>
            <a href="/commands">View Commands Data</a>
            <a href="/incentives">Incentives</a>
            <hr style="margin: 20px 0;">
            <a href="/api/streaks">Streaks JSON API</a>
            <a href="/api/quotes">Quotes JSON API</a>
            <a href="/api/commands">Commands JSON API</a>
            <a href="/api/incentives">Incentives JSON API</a>
        </div>
    </body>
    </html>`;
    res.send(html);
});

// Health check endpoint
app.get("/health", (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get("/chatwidget", (_req, res) => {
    res.sendFile("chatwidget.html", { root: path.join(import.meta.dirname, "www") });
});

// Centralized error handling middleware
function errorHandler(err, req, res, next) {
    void next;
    console.error('Web Server: Unhandled error:', err?.message || String(err));
    if (req.accepts(['html', 'json']) === 'html') {
        res.status(500).type('text/html').send('<h1>500 Internal Server Error</h1><p>An unexpected error occurred.</p>');
    } else {
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

app.use(errorHandler);

const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Kiara Bot Web Server running on port ${port}`);
    console.log(`Dashboard available at: http://127.0.0.1:${port}`);
    console.log(`Server listening on 127.0.0.1:${port} (local only)`);
});

export { app, server, errorHandler }
