import jsonfile from "jsonfile";

/**
 * The first element in quotes.json.  Not a quote itself, just metadata.
 * @typedef { Object } QuoteCounter
 * @property { string } Quote_Count
 */

/**
 * @typedef { Object } Quote
 * @property { string } Index - The quote's unique ID. Stored as a string, not a number, so math won't work on them.
 * Not necessarily the same as the quote's index in the array, since deleted quotes are a thing.
 * @property { string } Quote_Text
 * @property { string } Submitter
 * @property { string } Category
 * @property { string } Date
 */

/**
 * The contents of quotes.json, which is a single array.
 * The first element is a metadata object, the rest are actual quotes.
 * @typedef { [QuoteCounter, ...Quote[]] } Quotes
 */

/**
 * Convert input ID to a rounded positive integer, or 0 if invalid.
 * Parses the input with Number, rounds with Math.round, and returns the positive integer or 0.
 * @param {string|number} id
 * @param {boolean} [logWarning=false]
 * @returns { number }
 */
export function castIdToNumber(id, logWarning = false) {
    try {
        const number = Math.round(Number(id));
        if (number > 0) {
            return number;
        }
    }
    catch (e) {
        // no-op
    }
    if (logWarning) {
        console.log(`Could not convert ${id} to a positive integer.`)
    }
    return 0;
}

/** @returns { string } */
export function castIdToString(id, logWarning = false) {
    const number = castIdToNumber(id, logWarning);
    return number > 0 ? String(number) : "";
}

export default class QuoteHelper {

    // writeFile is passed in from the bot so we can reuse the new atomic write function
    constructor(dataPath, writeFile) {
        /** @type {Quotes} */
        this.quotes = [{Quote_Count: "0"}];

        // reread the file for freshness.
        // defined in the constructor just to avoid extra instance variables for dataPath.
        this.load = () => {
            this.quotes = jsonfile.readFileSync(dataPath);
        }

        // use the provided write function to save updated quotes.
        // defined in the constructor just to avoid extra instance variables for dataPath and writeFile.
        this.save = () => {
            writeFile(dataPath, this.quotes, { spaces: 2 });
        }
    }

    /** @returns {number} the largest quote ID in use */
    getMaxIndex() {
        this.load();
        const indexes = this.quotes.map(quote => castIdToNumber(quote.Index));
        return Math.max(0, ...indexes);
    }

    /**
     * @param { any } id
     * @returns { Quote | undefined }
     */
    findByIndex(id) {
        const index = castIdToString(id);
        if (id) {
            this.load();
            return this.quotes.find(quote => quote.Index === index);
        }
        return undefined;
    }
    
    /** @returns { Quote | undefined } */
    findRandom() {
        this.load();
        /** @type Quote[] */
        const validQuotes = this.quotes.filter(quote => !!quote.Index);
        const position = Math.floor(Math.random() * validQuotes.length);
        return validQuotes[position];
    }

    /**
     * @param { string } text
     * @param { string } submitter
     * @param { string } category
     * @returns { Quote }
     */
    add(text, submitter, category) {
        
        // this.load(); // not harmful, but not needed because this.getMaxIndex() will do it

        const newIndex = this.getMaxIndex() + 1;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        const date = now.getDate();
        let hour = now.getHours();
        let ampm = "AM";
        if (hour > 12) {
            hour -= 12;
            ampm = "PM";
        }
        if (hour === 0) {
            hour = 12;
        }
        const minutes = now.getMinutes().toString().padStart(2, "0");

        const formatted = `${year}/${month}/${date} ${hour}:${minutes} ${ampm}`;

        // Generate JSON format data object to add to the file.
        // All fields are stringified, even if they were probably strings already.
        /** @type Quote */
        const newQuote = {
            Index: `${newIndex}`,
            Quote_Text: `${text}`,
            Submitter: `${submitter}`,
            Category: `${category}`,
            Date: `${formatted}`,
        };

        // Update the quote count in the initial/metadata array element
        const metadataElement = this.quotes.find(quote => quote.Quote_Count);
        if (metadataElement) {
            metadataElement.Quote_Count = `${newIndex}`;
        }

        this.quotes.push(newQuote)
        this.save();

        // Hand back what got added so the bot can tell chat about it
        return newQuote;
    }

    /**
     * @param { any } id
     * @param { string } text
     * @returns { Quote | undefined } the updated Quote, if any
     */
    edit(id, text) {
        // this.load(); // not harmful, but not needed because this.findByIndex() will do it

        const quote = this.findByIndex(id);
        // if the quote for that ID exists
        if (quote) {
            quote.Quote_Text = text;
            this.save();
            // Hand back what got updated so the bot can tell chat about it
            return quote;
        }
        return undefined;
    }

    /**
     * @param { any } id
     * @returns { Quote | undefined } the removed Quote, if any
     */
    remove(id) {
        const index = castIdToString(id);
        if (id) {
            this.load();
            const quoteIndex = this.quotes.findIndex(quote => quote.Index === index);
            if (quoteIndex !== -1) {
                const removedQuote = this.quotes.splice(quoteIndex, 1)[0];
                
                // Atomically re-index all quotes to perfectly sequential numbering
                let newId = 1;
                for (let i = 0; i < this.quotes.length; i++) {
                    if (this.quotes[i].Index !== undefined) { // Skip metadata element
                        this.quotes[i].Index = String(newId);
                        newId++;
                    }
                }
                
                // Update the Quote_Count metadata element
                const metadataElement = this.quotes.find(quote => quote.Quote_Count !== undefined);
                if (metadataElement) {
                    metadataElement.Quote_Count = String(newId - 1);
                }

                this.save();
                return removedQuote;
            }
        }
        return undefined;
    }

}