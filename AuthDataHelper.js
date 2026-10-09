import fs from "fs"
import path from "path"

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
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(this.dataPath)) {
            if (this.legacyPath && fs.existsSync(this.legacyPath)) {
                fs.copyFileSync(this.legacyPath, this.dataPath);
            } else {
                fs.writeFileSync(this.dataPath, JSON.stringify(this.defaultData, null, 2));
            }
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
            this.data = {
                ...this.defaultData,
                ...parsed,
                twitch: { ...this.defaultData.twitch, ...(parsed?.twitch || {}) },
                twitchBroadcaster: { ...this.defaultData.twitchBroadcaster, ...(parsed?.twitchBroadcaster || {}) },
                twitchBot: { ...this.defaultData.twitchBot, ...(parsed?.twitchBot || {}) },
                youtube: { ...this.defaultData.youtube, ...(parsed?.youtube || {}) }
            };
        } catch (err) {
            const timestamp = Date.now();
            const corruptedPath = `${this.dataPath}.corrupted.${timestamp}`;
            try {
                if (fs.existsSync(this.dataPath)) {
                    fs.renameSync(this.dataPath, corruptedPath);
                }
                fs.writeFileSync(this.dataPath, JSON.stringify(this.defaultData, null, 2));
                console.error(`Error parsing Auth Data file (${err.message}). Preserved corrupted file as ${corruptedPath} and initialized default file.`);
            } catch (backupErr) {
                console.error(`Error preserving corrupted Auth Data file: ${backupErr.message}`);
            }
            this.data = { ...this.defaultData };
        }

        if (this.statusCallback) this.statusCallback("loaded");
    }

    //save the data back to the file
    saveData() {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2));
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
        let pathArr = field.split(".");
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
        let pathArr = field.split(".");
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
        let pathArr = field.split(".");
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
        let pathArr = field.split(".");
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
