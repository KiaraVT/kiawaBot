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
    const url = error.config?.url || "";
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
