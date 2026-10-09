/**
 * Redact sensitive query parameters from URLs.
 * Prevents logging tokens, secrets, or auth codes in error dumps.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function redactSensitiveUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") {
        return "";
    }
    const sensitiveKeys = ["client_secret", "refresh_token", "code", "access_token", "state"];
    try {
        const dummyBase = "https://example.com";
        const parsed = new URL(rawUrl, dummyBase);
        let changed = false;
        for (const key of sensitiveKeys) {
            if (parsed.searchParams.has(key)) {
                parsed.searchParams.set(key, "REDACTED");
                changed = true;
            }
        }
        if (parsed.hash) {
            for (const key of sensitiveKeys) {
                const hashRegex = new RegExp(`([#&?])${key}=([^&]*)`, "gi");
                if (hashRegex.test(parsed.hash)) {
                    parsed.hash = parsed.hash.replace(hashRegex, `$1${key}=REDACTED`);
                    changed = true;
                }
            }
        }
        if (!changed) {
            return rawUrl;
        }
        let result = "";
        if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            result = parsed.toString();
        } else {
            result = parsed.pathname + parsed.search + (parsed.hash || "");
        }
        return result.replace(/=REDACTED/g, "=[REDACTED]");
    } catch {
        return rawUrl.replace(/(^|[?&#/])(client_secret|refresh_token|code|access_token|state)=([^&#]*)/gi, "$1$2=[REDACTED]");
    }
}

/**
 * Format an Axios or generic Error into a concise single-line string.
 * Prevents dumping internal socket buffers, headers, and circular references.
 *
 * @param {any} error
 * @returns {string}
 */
export function formatAxiosError(error) {
    if (!error) {
        return "[Error] Unknown error";
    }
    if (typeof error === "string") {
        return error;
    }

    const message = error.message || "Error";
    const method = error.config?.method ? error.config.method.toUpperCase() : "";
    const rawUrl = error.config?.url || "";
    const url = redactSensitiveUrl(rawUrl);
    const endpointDesc = (method || url) ? ` (${method ? method + " " : ""}${url})` : "";

    if (error.response) {
        const status = error.response.status || "";
        const statusText = error.response.statusText || "";
        const dataMessage = error.response.data?.message
            || (typeof error.response.data === "string" ? error.response.data : "");
        const details = [status, statusText].filter(Boolean).join(" ");
        const extra = dataMessage ? `: ${dataMessage}` : "";
        return `[Axios] ${message}${endpointDesc} -> ${details}${extra}`;
    }

    if (error.config || error.code) {
        return `[Axios] ${message}${endpointDesc} -> no response`;
    }

    return `[Error] ${message}`;
}
