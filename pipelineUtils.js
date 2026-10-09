/**
 * Pipeline and resilience utilities for auth, retries, and streak management.
 */

/**
 * Creates a single-flight mutex runner.
 * Ensures concurrent callers await the active in-flight operation
 * instead of triggering duplicate requests.
 *
 * @returns {(fn: () => Promise<any>) => Promise<any>}
 */
export function createSingleFlightMutex() {
    let inFlight = null;
    return function execute(fn) {
        if (!inFlight) {
            inFlight = Promise.resolve()
                .then(() => fn())
                .finally(() => {
                    inFlight = null;
                });
        }
        return inFlight;
    };
}

/**
 * Executes an async operation with exponential backoff for transient failures.
 *
 * @param {(attempt: number) => Promise<any>} operation
 * @param {object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {(err: any) => boolean} [options.isTransient]
 * @param {(err: any, attempt: number, delayMs: number) => void} [options.onRetry]
 * @param {number} [options.baseDelayMs=1000]
 * @returns {Promise<any>}
 */
export async function executeWithBackoff(operation, options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const isTransient = options.isTransient ?? ((err) => {
        const status = err?.response?.status;
        return !err?.response || [429, 500, 502, 503, 504].includes(status);
    });
    const onRetry = options.onRetry ?? (() => {});

    let attempt = 0;
    while (true) {
        try {
            return await operation(attempt);
        } catch (error) {
            if (attempt < maxRetries && isTransient(error)) {
                attempt += 1;
                const delayMs = Math.pow(2, attempt) * baseDelayMs;
                onRetry(error, attempt, delayMs);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }
            throw error;
        }
    }
}

/**
 * Update streaks safely upon stream start.
 *
 * @param {string} streakPath
 * @param {string} startedAtStr
 * @param {object} [io]
 * @param {(path: string) => any} [io.readFn]
 * @param {(path: string, data: any, opts?: any) => void} [io.writeFn]
 * @param {() => void} [io.onStreakReset]
 * @returns {{ updated: boolean, reason?: string }}
 */
export function processStreamStartStreak(streakPath, startedAtStr, io = {}) {
    if (!startedAtStr || typeof startedAtStr !== "string") {
        return { updated: false, reason: "missing_started_at" };
    }
    const currentStartDate = new Date(startedAtStr);
    const currentStart = currentStartDate.getTime();
    if (isNaN(currentStart)) {
        return { updated: false, reason: "invalid_started_at_date" };
    }

    let streakList = null;
    if (io.readFn) {
        try {
            streakList = io.readFn(streakPath);
        } catch (e) {
            // Read error handled by initializing new structure
            void e;
        }
    }

    const writeFn = io.writeFn || (() => {});

    if (!streakList || typeof streakList !== "object") {
        const initial = {
            Last_Stream: { Start: startedAtStr, End: "" },
            Current_Stream: { Start: startedAtStr },
            Users: {}
        };
        writeFn(streakPath, initial, { spaces: 2, EOL: "\n" });
        return { updated: true, reason: "initialized_new_file" };
    }

    if (!streakList.Last_Stream) {
        streakList.Last_Stream = { Start: startedAtStr, End: "" };
    }
    if (!streakList.Current_Stream) {
        streakList.Current_Stream = { Start: startedAtStr };
    }
    if (!streakList.Users) {
        streakList.Users = {};
    }

    const currentStreamStart = new Date(streakList.Current_Stream.Start || 0).getTime();
    if (!isNaN(currentStreamStart) && (currentStart - currentStreamStart) < 5 * 60 * 60 * 1000) {
        return { updated: false, reason: "restarted_within_window" };
    }

    const lastStart = new Date(streakList.Last_Stream.Start || 0).getTime();
    const lastEnd = new Date(streakList.Last_Stream.End || 0).getTime();
    const backupEnd = new Date(streakList.Last_Stream.Backup_End || 0).getTime();

    if (!lastEnd || isNaN(lastEnd)) {
        streakList.Last_Stream.Start = streakList.Current_Stream.Start;
        streakList.Current_Stream.Start = startedAtStr;
        writeFn(streakPath, streakList, { spaces: 2, EOL: "\n" });
        return { updated: true, reason: "null_last_end" };
    }

    if (!isNaN(backupEnd) && (currentStart - backupEnd) < 5 * 60 * 60 * 1000) {
        return { updated: false, reason: "started_shortly_after_last" };
    }

    if (!isNaN(backupEnd) && !isNaN(lastStart) && backupEnd < lastStart) {
        streakList.Last_Stream.End = "";
        streakList.Last_Stream.Start = streakList.Current_Stream.Start;
        streakList.Current_Stream.Start = startedAtStr;
        writeFn(streakPath, streakList, { spaces: 2, EOL: "\n" });
        return { updated: true, reason: "end_detection_failed" };
    }

    streakList.Last_Stream.Start = streakList.Current_Stream.Start;
    streakList.Current_Stream.Start = startedAtStr;
    streakList.Last_Stream.End = streakList.Last_Stream.Backup_End || "";
    if (io.onStreakReset) {
        io.onStreakReset();
    }
    writeFn(streakPath, streakList, { spaces: 2, EOL: "\n" });
    return { updated: true, reason: "standard_update" };
}

/**
 * Validates command arguments safely without throwing or producing NaN.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {{ valid: boolean, error?: string, [key: string]: any }}
 */
export function validateCommandArguments(command, args) {
    if (!Array.isArray(args)) {
        return { valid: false, error: "invalid_arguments" };
    }

    if (command === "!addcommand" || command === "!editcommand") {
        if (!args[1] || args.length < 3) {
            return { valid: false, error: `Usage: ${command} <tag> <response>` };
        }
        const tag = args[1].toLowerCase().replace(/^!/, "");
        const text = args.slice(2).join(" ");
        if (!tag || !text.trim()) {
            return { valid: false, error: `Usage: ${command} <tag> <response>` };
        }
        return { valid: true, tag, text };
    }

    if (command === "!updateincentive") {
        if (!args[1] || args.length < 3) {
            return { valid: false, error: "Usage: !updateincentive <command> <goal>" };
        }
        const identifier = "!" + args[1].toLowerCase().replace(/^!/, "");
        const goal = Number(args.slice(2).join(" "));
        if (!Number.isFinite(goal) || goal <= 0) {
            return { valid: false, error: "Incentive goal must be a positive number." };
        }
        return { valid: true, identifier, goal };
    }

    if (command === "!addincentive") {
        if (!args[1]) {
            return { valid: false, error: "Usage: !addincentive <amount>" };
        }
        const amount = Number(args.slice(1).join(" "));
        if (!Number.isFinite(amount)) {
            return { valid: false, error: "Incentive amount must be a valid number." };
        }
        return { valid: true, amount };
    }

    return { valid: true };
}
