import { URL, URLSearchParams } from "node:url";

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
    const sensitiveKeys = ["client_secret", "refresh_token", "code", "access_token", "state", "code_verifier"];
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
        return rawUrl.replace(/(^|[?&#/])(client_secret|refresh_token|code|access_token|state|code_verifier)=([^&]*)/gi, "$1$2=[REDACTED]");
    }
}

/**
 * Redacts sensitive authentication tokens and secrets from request body or params.
 *
 * @param {any} data
 * @returns {any}
 */
export function redactSensitiveData(data) {
    if (!data) {
        return data;
    }

    const sensitiveKeys = ["client_secret", "refresh_token", "code", "access_token", "state", "code_verifier"];

    if (typeof data === "string") {
        try {
            const parsed = JSON.parse(data);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const cloned = { ...parsed };
                let mutated = false;
                for (const key of sensitiveKeys) {
                    if (Object.prototype.hasOwnProperty.call(cloned, key)) {
                        cloned[key] = "[REDACTED]";
                        mutated = true;
                    }
                }
                return mutated ? JSON.stringify(cloned) : data;
            }
        } catch {
            return data.replace(
                /(^|[?&#/])(client_secret|refresh_token|code|access_token|state|code_verifier)=([^&#]*)/gi,
                "$1$2=[REDACTED]"
            );
        }
    }

    if (typeof data === "object") {
        if (typeof data.get === "function" && typeof data.set === "function") {
            const cloned = new URLSearchParams(data.toString());
            for (const key of sensitiveKeys) {
                if (cloned.has(key)) {
                    cloned.set(key, "[REDACTED]");
                }
            }
            return cloned;
        }

        const cloned = { ...data };
        for (const key of sensitiveKeys) {
            if (Object.prototype.hasOwnProperty.call(cloned, key)) {
                cloned[key] = "[REDACTED]";
            }
        }
        return cloned;
    }

    return data;
}

/**
 * Sanitizes an Axios request/response config to prevent leaking credentials in logs or errors.
 *
 * @param {any} config
 * @param {object} [options]
 * @param {boolean} [options.clone=false]
 * @returns {any}
 */
export function sanitizeAxiosConfig(config, options = {}) {
    if (!config || typeof config !== "object") {
        return config;
    }
    const target = options.clone ? { ...config } : config;
    if (target.url) {
        target.url = redactSensitiveUrl(target.url);
    }
    if (target.data) {
        target.data = redactSensitiveData(target.data);
    }
    if (target.params) {
        target.params = redactSensitiveData(target.params);
    }
    return target;
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

    const config = sanitizeAxiosConfig(error.config, { clone: true });

    const message = error.message || "Error";
    const method = config?.method ? config.method.toUpperCase() : "";
    const rawUrl = config?.url || "";
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
