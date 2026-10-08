import fs from "fs"

export default class IncentiveHelper {

    //this runs when we create a new instance of the class
    constructor() {
        this.data = null;
        this.dataPath = './data/incentives.json';
        this.defaultData = {
            incentive: {
                command: '!update',
                amount: 0,
                goal: 700
            }
        }
        this.statusCallback = null;
        this.autoSaveTimeout = null;
    }

    //load data from the file, create it if it doesn't exist
    loadData() {
        if (!fs.existsSync(this.dataPath))
            fs.writeFileSync(this.dataPath, JSON.stringify(this.defaultData));
        this.data = JSON.parse(fs.readFileSync(this.dataPath, "utf8"));
        if (this.statusCallback) this.statusCallback("loaded");
    }

    //save the data back to the file
    saveData() {
        try {
            fs.writeFileSync(this.dataPath, JSON.stringify(this.data));
            return true;
        } catch (err) {
            console.log('Error writing Auth Data file:' + err.message);
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

        pathArr.forEach((pathItem) => {
            if (!focusObject.hasOwnProperty(pathItem)) return false;
            focusObject = focusObject[pathItem];
        });

        if (!focusObject.hasOwnProperty(targetItem)) return false;
        return true;
    }

    //read a given field from the data file
    read(field) {
        let pathArr = field.split(".");
        let targetItem = pathArr.pop();
        let focusObject = this.data;

        pathArr.forEach((pathItem) => {
            if (!focusObject.hasOwnProperty(pathItem)) return undefined;
            focusObject = focusObject[pathItem];
        });

        if (!focusObject.hasOwnProperty(targetItem)) return undefined;
        return focusObject[targetItem];
    }

    //update a given field, optionally creating it if it doesn't exist
    update(field, value, create = false) {
        let pathArr = field.split(".");
        let targetField = pathArr.pop();
        let focusObject = this.data;

        pathArr.forEach((pathItem) => {
            if (!focusObject.hasOwnProperty(pathItem)) {
                if (!create) return false;
                focusObject[pathItem] = {};
            }
            focusObject = focusObject[pathItem];
        });

        if (!focusObject.hasOwnProperty(targetField)) {
            if (!create) return false;
            focusObject[targetField] = {};
        }

        focusObject[targetField] = value;
        this.touchAutosave();
        return true;
    }

    //remove a field from the data file
    delete(field) {
        let pathArr = field.split(".");
        let targetItem = pathArr.pop();
        let focusObject = this.data;

        pathArr.forEach((pathItem) => {
            if (!focusObject.hasOwnProperty(pathItem)) return false;
            focusObject = focusObject[pathItem];
        });

        if (!focusObject.hasOwnProperty(targetItem)) return false;
        delete focusObject[targetItem];
        this.touchAutosave();
        return true;
    }

    //get an object representing the entire structure of the data file
    getAllData() {
        return this.data;
    }

}
