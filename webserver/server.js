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
const incentive_Path = path.join(import.meta.dirname, '..', 'data', 'incentives.json');

// Ensure data directory exists
const dataDir = path.join(import.meta.dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    console.log('Web Server: Creating data directory...');
    fs.mkdirSync(dataDir, { recursive: true });
}

// Helper function to safely read JSON files
function safeReadJSON(filePath, defaultValue = {}) {
    try {
        const base = path.resolve(import.meta.dirname, '..');
        const target = path.resolve(base, filePath);
        const relative = path.relative(base, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            console.error(`Web Server: Invalid file path`);
            return defaultValue;
        }
        if (!fs.existsSync(target)) {
            console.log(`Web Server: Creating default ${target}...`);
            jsonfile.writeFileSync(target, defaultValue, { spaces: 2, EOL: "\n" });
            return defaultValue;
        }
        return jsonfile.readFileSync(target);
    } catch (error) {
        console.error(`Web Server: Error reading ${filePath}:`, error);
        return defaultValue;
    }
}

// Default file shapes - must match the bot's defaultFiles initialization in Kiara_bot.js,
// since whichever process starts first creates these files for both.
const defaultQuotesData = [{ Quote_Count: "0" }];
const defaultCommandsData = [{ Command_Count: "0" }];

// Add CORS middleware for web endpoints
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

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
        const quotesData = safeReadJSON(quote_Path, defaultQuotesData);
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
        const commandsData = safeReadJSON(command_Path, defaultCommandsData);
        res.setHeader('Content-Type', 'application/json');
        res.json(commandsData);
    } catch (error) {
        console.error('Error reading commands file:', error);
        res.status(500).json({ error: 'Failed to read commands data' });
    }
});

// Default shape for the incentive file - must match IncentiveHelper's defaultData in the bot,
// since both processes read and write the same file.
const defaultIncentiveData = { incentive: { command: '!update', amount: 0, goal: 700 } };

// Web endpoint to serve incentives data
app.get("/api/incentives", (req, res) => {
    try {
        const incentiveData = safeReadJSON(incentive_Path, defaultIncentiveData);
        res.setHeader('Content-Type', 'application/json');
        res.json(incentiveData);
    } catch (error) {
        console.error('Error reading incentives file:', error);
        res.status(500).json({ error: 'Failed to read incentives data' });
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
            <pre>${JSON.stringify(streaksData, null, 2)}</pre>
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
        const quotesData = safeReadJSON(quote_Path, defaultQuotesData);
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
            <pre>${JSON.stringify(quotesData, null, 2)}</pre>
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
        const commandsData = safeReadJSON(command_Path, defaultCommandsData);
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
            <pre>${JSON.stringify(commandsData, null, 2)}</pre>
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
        const incentiveData = safeReadJSON(incentive_Path, defaultIncentiveData);
        if (!incentiveData?.incentive) {
            res.status(500).send('<h1>Error</h1><p>Incentive data is missing or malformed</p>');
            return;
        }
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
            <pre>${incentiveData.incentive.command} $${incentiveData.incentive.amount.toFixed(2)} / $${incentiveData.incentive.goal.toFixed(0)}</pre>
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
    res.sendFile(path.join(import.meta.dirname, "www/chatwidget.html"))
})

app.listen(port, '127.0.0.1', () => {
    console.log(`Kiara Bot Web Server running on port ${port}`);
    console.log(`Dashboard available at: http://127.0.0.1:${port}`);
    console.log(`Server listening on 127.0.0.1:${port} (local only)`);
});

export { app }
