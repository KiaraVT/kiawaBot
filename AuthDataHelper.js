import fs from "fs"
import path from "path"
import crypto from "node:crypto"

/**
 * Recursively merges source object into target object.
 * Null source values preserve target safely without wiping target or sibling keys.
 * Note on array semantics: Array properties from source replace target arrays completely
 * (elements are deep cloned) rather than concatenating or merging by index. This prevents
 * stale scopes or duplicate credential entries when configuration arrays are updated.
 *
 * @param {any} target
 * @param {any} source
 * @returns {any}
 */
function deepMerge(target, source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        if (Array.isArray(source)) {
            return source.map(item => (item && typeof item === "object" && !Array.isArray(item)) ? deepMerge({}, item) : Array.isArray(item) ? [...item] : item);
        }
        return source === null ? target : (source !== undefined ? source : target);
    }
    const output = { ...(target && typeof target === "object" && !Array.isArray(target) ? target : {}) };
    for (const key of Object.keys(source)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
            continue;
        }
        const sourceVal = source[key];
        const targetVal = output[key];
        if (sourceVal && typeof sourceVal === "object" && !Array.isArray(sourceVal)) {
            const baseTarget = targetVal && typeof targetVal === "object" && !Array.isArray(targetVal) ? targetVal : {};
            output[key] = deepMerge(baseTarget, sourceVal);
        } else if (Array.isArray(sourceVal)) {
            output[key] = sourceVal.map(item => (item && typeof item === "object" && !Array.isArray(item)) ? deepMerge({}, item) : Array.isArray(item) ? [...item] : item);
        } else if (sourceVal !== undefined && sourceVal !== null) {
            output[key] = sourceVal;
        }
    }
    return output;
}

function safeSetPermission(targetPath, mode) {
    try {
        fs.chmodSync(targetPath, mode);
    } catch (err) {
        if (process.platform === "win32" && (err.code === "EPERM" || err.code === "ENOSYS")) {
            return;
        }
        console.warn(`[AuthDataHelper] Unable to set permissions on ${targetPath}:`, err.message);
    }
}

export { deepMerge, safeSetPermission };


export default class AuthDataHelper {

    //this runs when we create a new instance of the class
    constructor() {
        this.data = null;
        this.dataPath = './data/auth-data.json';
        this.legacyPath = './auth-data.json';
        this.defaultData = {
            twitch: {
                access_token: "",
                refresh_token: ""
            },
            twitchBroadcaster: {
                access_token: "",
                refresh_token: ""
            },
            twitchBot: {
                access_token: "",
                refresh_token: ""
            },
            youtube: {
                access_token: "",
                refresh_token: ""  
            }
        }
        this.statusCallback = null;
        this.autoSaveTimeout = null;
    }

    //load data from the file, create it if it doesn't exist
    loadData() {
        const dir = path.dirname(this.dataPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
        safeSetPermission(dir, 0o700);

        if (!fs.existsSync(this.dataPath)) {
            if (this.legacyPath && fs.existsSync(this.legacyPath)) {
                fs.copyFileSync(this.legacyPath, this.dataPath);
                safeSetPermission(this.dataPath, 0o600);
            } else {
                fs.writeFileSync(this.dataPath, JSON.stringify(this.defaultData, null, 2), { mode: 0o600 });
            }
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error("Auth data must be a plain JSON object");
            }
            this.data = deepMerge(this.defaultData, parsed);
        } catch (err) {
            const timestamp = `${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;
            const corruptedPath = `${this.dataPath}.corrupted.${timestamp}`;
            const tempPath = `${this.dataPath}.tmp.${timestamp}`;
            try {
                if (fs.existsSync(this.dataPath)) {
                    let diskValid = false;
                    let parsedDisk = null;
                    try {
                        const raw = fs.readFileSync(this.dataPath, "utf8");
                        parsedDisk = JSON.parse(raw);
                        if (parsedDisk && typeof parsedDisk === "object" && !Array.isArray(parsedDisk)) {
                            diskValid = true;
                        }
                    } catch {
                        diskValid = false;
                    }

                    if (diskValid) {
                        this.data = deepMerge(this.defaultData, parsedDisk);
                        if (this.statusCallback) this.statusCallback("loaded");
                        return;
                    }

                    fs.writeFileSync(tempPath, JSON.stringify(this.defaultData, null, 2), { mode: 0o600 });
                    safeSetPermission(tempPath, 0o600);

                    fs.renameSync(this.dataPath, corruptedPath);

                    try {
                        fs.renameSync(tempPath, this.dataPath);
                    } catch (replaceErr) {
                        if (fs.existsSync(corruptedPath)) {
                            fs.renameSync(corruptedPath, this.dataPath);
                        }
                        throw replaceErr;
                    }
                    safeSetPermission(this.dataPath, 0o600);
                    console.error(`Error parsing Auth Data file (${err.message}). Preserved corrupted file as ${corruptedPath} and initialized default file.`);
                }
            } catch (backupErr) {
                if (fs.existsSync(tempPath)) {
                    try {
                        fs.unlinkSync(tempPath);
                    } catch (unlinkErr) {
                        console.warn("[AuthDataHelper] Failed to clean up temp file:", unlinkErr.message);
                    }
                }
                console.error(`Error preserving corrupted Auth Data file: ${backupErr.message}`);
            }
            this.data = deepMerge({}, this.defaultData);
        }

        if (this.statusCallback) this.statusCallback("loaded");
    }


    //save the data back to the file
    saveData() {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            }
            safeSetPermission(dir, 0o700);
            fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), { mode: 0o600 });
            safeSetPermission(this.dataPath, 0o600);
            return true;
        } catch (err) {
            console.error('Error writing Auth Data file:' + err.message);
            return false;
        }
    }

    //"touch" the autosave mechanism to reset the 1-second timer between the last data change and saving the file
    touchAutosave() {
        if (this.statusCallback) this.statusCallback("changed");
        clearTimeout(this.autoSaveTimeout);
        this.autoSaveTimeout = setTimeout(() => {
            if (this.statusCallback) this.statusCallback("saving");
            this.saveData();
            if (this.statusCallback) this.statusCallback("saved");
        }, 1000);
    }

    //check if the data file contains a given field
    has(field) {
        if (!field || typeof field !== "string") return false;
        let pathArr = field.split(".");
        if (pathArr.some(key => key === "__proto__" || key === "constructor" || key === "prototype")) {
            return false;
        }
        let targetItem = pathArr.pop();
        let focusObject = this.data;

        for (const pathItem of pathArr) {
            if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, pathItem)) return false;
            focusObject = focusObject[pathItem];
        }

        if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, targetItem)) return false;
        return true;
    }

    //read a given field from the data file
    read(field) {
        if (!field || typeof field !== "string") return undefined;
        let pathArr = field.split(".");
        if (pathArr.some(key => key === "__proto__" || key === "constructor" || key === "prototype")) {
            return undefined;
        }
        let targetItem = pathArr.pop();
        let focusObject = this.data;

        for (const pathItem of pathArr) {
            if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, pathItem)) return undefined;
            focusObject = focusObject[pathItem];
        }

        if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, targetItem)) return undefined;
        return focusObject[targetItem];
    }

    //update a given field, optionally creating it if it doesn't exist
    update(field, value, create = true, immediate = false) {
        if (!field || typeof field !== "string") return false;
        let pathArr = field.split(".");
        if (pathArr.some(key => key === "__proto__" || key === "constructor" || key === "prototype")) {
            return false;
        }
        const topLevelKey = pathArr[0];
        const knownKeys = Object.keys(this.defaultData);
        if (!knownKeys.includes(topLevelKey)) {
            console.warn(`[AuthDataHelper] Updating unknown top-level key '${topLevelKey}'. Ensure schema alignment.`);
        }

        let targetField = pathArr.pop();
        let focusObject = this.data;

        for (const pathItem of pathArr) {
            if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, pathItem)) {
                if (!create) return false;
                focusObject[pathItem] = {};
            }
            focusObject = focusObject[pathItem];
        }

        if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, targetField)) {
            if (!create) return false;
            focusObject[targetField] = {};
        }

        focusObject[targetField] = value;
        if (immediate) {
            this.saveDataImmediate();
        } else {
            this.touchAutosave();
        }
        return true;
    }

    //save data immediately without debounce
    saveDataImmediate() {
        clearTimeout(this.autoSaveTimeout);
        return this.saveData();
    }

    //remove a field from the data file
    delete(field) {
        if (!field || typeof field !== "string") return false;
        let pathArr = field.split(".");
        if (pathArr.some(key => key === "__proto__" || key === "constructor" || key === "prototype")) {
            return false;
        }
        let targetItem = pathArr.pop();
        let focusObject = this.data;

        for (const pathItem of pathArr) {
            if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, pathItem)) return false;
            focusObject = focusObject[pathItem];
        }

        if (!focusObject || !Object.prototype.hasOwnProperty.call(focusObject, targetItem)) return false;
        delete focusObject[targetItem];
        this.touchAutosave();
        return true;
    }

    //get an object representing the entire structure of the data file
    getAllData() {
        return this.data;
    }

}
