import fs from "fs";
import jsonfile from "jsonfile";
import {
    formatQuoteTimestamp,
    getUtcNowIsoString,
    parseIsoDateTime,
    parseQuoteTimestamp,
    QUOTE_UNDO_WINDOW_MS,
    QUOTE_TRASH_RETENTION_MS,
} from "./timeUtils.js";

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
 * @property { string } Date - Original creation timestamp in UTC quote format.
 * @property { string } [Creation_Sequence] - Monotonic creation order used for same-second tie-breaking.
 */

/**
 * The contents of quotes.json, which is a single array.
 * The first element is a metadata object, the rest are actual quotes.
 * @typedef { [QuoteCounter, ...Quote[]] } Quotes
 */

/**
 * A deleted quote retained in the trash for restoration.
 * @typedef { Object } TrashedQuote
 * @property { string } Trash_ID
 * @property { string } Original_Index
 * @property { string } [Quote_Text]
 * @property { string } [Submitter]
 * @property { string } [Category]
 * @property { string } Original_Date - Original quote creation timestamp in UTC quote format.
 * @property { string } [Creation_Sequence] - Monotonic creation order used for same-second tie-breaking.
 * @property { string } Deleted_At - UTC ISO-8601 timestamp for the trash event.
 * @property { string } [Date] - Legacy input field normalized to Original_Date when loaded.
 * @property { string } [Restored_At] - UTC ISO-8601 timestamp for the restore event.
 * @property { string } [Restored_Index]
 */

/**
 * @typedef { Object } UndoAddResult
 * @property { "removed" | "not-found" | "not-owner" | "expired" | "unparsable-date" | "invalid-reference-time" } status
 * @property { Quote } [quote]
 */

/**
 * Convert input ID to a rounded positive integer, or 0 if invalid.
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
    catch (parseError) {
        if (logWarning) {
            console.warn(`[QuoteHelper] Error parsing ID "${id}":`, parseError?.message || parseError);
        }
    }
    if (logWarning) {
        console.log(`Could not convert ${id} to a positive integer.`);
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
    constructor(dataPath, writeFile, trashDataPath = "./data/quotes-trash.json") {
        /** @type {Quotes} */
        this.quotes = [{Quote_Count: "0"}];
        /** @type {TrashedQuote[]} */
        this.trashQuotes = [];
        this.trashDataPath = trashDataPath;

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

        this.loadTrash = (now = getUtcNowIsoString()) => {
            const nowDateTime = parseIsoDateTime(now);
            if (!nowDateTime) {
                throw new Error("Quote trash reference time must be a valid UTC timestamp");
            }
            if (!fs.existsSync(this.trashDataPath)) {
                this.trashQuotes = [];
                return 0;
            }
            const trashQuotes = jsonfile.readFileSync(this.trashDataPath);
            if (!Array.isArray(trashQuotes)) {
                throw new Error("Quote trash data must be an array");
            }

            const classifiedEntries = trashQuotes.map(entry => {
                if (this.isValidTrashEntry(entry)) {
                    const normalized = this.normalizeTrashEntry(entry);
                    return { type: "entry", entry: normalized.entry, changed: normalized.changed };
                }
                if (this.isValidTrashMetadata(entry)) {
                    return { type: "metadata", entry, changed: false };
                }
                return { type: "dropped", entry, changed: true };
            });
            const validEntries = classifiedEntries
                .filter(classified => classified.type === "entry")
                .map(classified => classified.entry);
            const validMetadata = classifiedEntries
                .filter(classified => classified.type === "metadata")
                .map(classified => classified.entry);
            const droppedEntries = classifiedEntries
                .filter(classified => classified.type === "dropped")
                .map(classified => classified.entry);
            const maxSeenTrashId = this.calculateMaxTrashIndex(trashQuotes);
            const retainedEntries = [];
            const futureDatedEntries = [];
            const expiredEntries = [];
            for (const entry of validEntries) {
                const deletedAt = parseIsoDateTime(entry.Deleted_At);
                const entryAgeMs = nowDateTime.diff(deletedAt).as("milliseconds");
                if (entryAgeMs < 0) {
                    futureDatedEntries.push(entry);
                } else if (entryAgeMs >= QUOTE_TRASH_RETENTION_MS) {
                    expiredEntries.push(entry);
                } else {
                    retainedEntries.push(entry);
                }
            }
            const prunedEntryCount = futureDatedEntries.length + expiredEntries.length;
            const droppedEntryCount = droppedEntries.length;
            const maxRetainedEntryId = this.calculateMaxTrashIndex(retainedEntries);
            const needsLastTrashId = maxSeenTrashId > maxRetainedEntryId;
            const hasMatchingLastTrashId = validMetadata.some(metadata => (
                castIdToNumber(metadata.Last_Trash_ID) === maxSeenTrashId
            ));
            let trashChanged = classifiedEntries.some(classified => classified.changed);

            if (needsLastTrashId && !hasMatchingLastTrashId) {
                this.trashQuotes = [
                    { Last_Trash_ID: String(maxSeenTrashId) },
                    ...retainedEntries,
                ];
                trashChanged = true;
            } else {
                this.trashQuotes = [...validMetadata, ...retainedEntries];
            }

            if (droppedEntryCount > 0) {
                const droppedIds = this.collectTrashIds(droppedEntries);
                console.warn(
                    `[QuoteHelper] Dropped ${droppedEntryCount} malformed quote trash entries: ${droppedIds.join(", ")}`
                );
            }
            if (futureDatedEntries.length > 0) {
                const futureDatedIds = this.collectTrashIds(futureDatedEntries);
                console.warn(
                    `[QuoteHelper] Pruned ${futureDatedEntries.length} future-dated quote trash entries: ${futureDatedIds.join(", ")}`
                );
            }
            if (expiredEntries.length > 0) {
                const expiredIds = this.collectTrashIds(expiredEntries);
                console.warn(
                    `[QuoteHelper] Pruned ${expiredEntries.length} expired quote trash entries: ${expiredIds.join(", ")}`
                );
            }
            if (prunedEntryCount > 0) {
                trashChanged = true;
            }
            if (trashChanged) {
                this.saveTrash();
            }
            return prunedEntryCount;
        }

        this.saveTrash = () => {
            writeFile(this.trashDataPath, this.trashQuotes, { spaces: 2 });
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
     * Assigns stable creation sequences to legacy quotes that lack them.
     * @returns {boolean} whether any sequence changed
     */
    ensureCreationSequences() {
        const usedSequences = new Set(
            this.quotes
                .map(quote => castIdToNumber(quote.Creation_Sequence))
                .filter(sequence => sequence > 0)
        );
        let nextSequence = 1;
        let changed = false;
        for (const quote of this.quotes) {
            if (!quote.Index || quote.Creation_Sequence) {
                continue;
            }
            while (usedSequences.has(nextSequence)) {
                nextSequence += 1;
            }
            quote.Creation_Sequence = String(nextSequence);
            usedSequences.add(nextSequence);
            nextSequence += 1;
            changed = true;
        }
        return changed;
    }

    /**
     * @returns {number} the next unused creation sequence
     */
    getNextCreationSequence() {
        const highestSequence = this.quotes.reduce((maximum, quote) => (
            Math.max(maximum, castIdToNumber(quote.Creation_Sequence))
        ), 0);
        return highestSequence + 1;
    }

    /**
     * @param { Quote } quote
     * @param { number } fallbackIndex
     * @returns {number}
     */
    getCreationSequence(quote, fallbackIndex) {
        return castIdToNumber(quote.Creation_Sequence) || fallbackIndex;
    }

    /**
     * @param { string } text
     * @param { string } submitter
     * @param { string } category
     * @returns { Quote | undefined }
     */
    add(text, submitter, category) {
        if (typeof text !== "string" || !text.trim()) {
            return undefined;
        }

        const newIndex = this.getMaxIndex() + 1;
        this.ensureCreationSequences();
        const creationSequence = this.getNextCreationSequence();

        const formattedQuoteTimestamp = formatQuoteTimestamp();

        // Generate JSON format data object to add to the file.
        // All fields are stringified, even if they were probably strings already.
        /** @type Quote */
        const newQuote = {
            Index: `${newIndex}`,
            Quote_Text: `${text}`,
            Submitter: `${submitter}`,
            Category: `${category}`,
            Date: `${formattedQuoteTimestamp}`,
            Creation_Sequence: `${creationSequence}`,
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
                this.ensureCreationSequences();
                const removedQuote = this.quotes[quoteIndex];
                const trashId = this.getMaxTrashIndex() + 1;
                const trashEntry = {
                    Trash_ID: String(trashId),
                    Original_Index: removedQuote.Index,
                    Quote_Text: removedQuote.Quote_Text,
                    Submitter: removedQuote.Submitter,
                    Category: removedQuote.Category,
                    Original_Date: removedQuote.Date,
                    Creation_Sequence: removedQuote.Creation_Sequence,
                    Deleted_At: getUtcNowIsoString(),
                };

                // Save the recoverable copy before changing the active collection.
                this.trashQuotes.push(trashEntry);
                this.saveTrash();
                this.quotes.splice(quoteIndex, 1);

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
                return { ...removedQuote, Trash_ID: trashEntry.Trash_ID };
            }
        }
        return undefined;
    }

    /**
     * @returns {number} the largest trash ID in use
     */
    getMaxTrashIndex() {
        this.loadTrash();
        return this.calculateMaxTrashIndex(this.trashQuotes);
    }

    /**
     * @param { TrashedQuote[] } trashQuotes
     * @returns {number}
     */
    calculateMaxTrashIndex(trashQuotes) {
        return trashQuotes.reduce((maximumId, quote) => Math.max(
            maximumId,
            castIdToNumber(quote.Trash_ID),
            castIdToNumber(quote.Last_Trash_ID),
        ), 0);
    }

    /**
     * @param { any } entry
     * @returns { boolean }
     */
    isValidTrashEntry(entry) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return false;
        }
        if (castIdToNumber(entry.Trash_ID) <= 0) {
            return false;
        }
        const originalDate = entry.Original_Date ?? entry.Date;
        if (typeof originalDate !== "string" || !originalDate.trim()) {
            return false;
        }
        if (!parseIsoDateTime(entry.Deleted_At)) {
            return false;
        }
        return ["Quote_Text", "Submitter", "Category"].every(field => (
            entry[field] === undefined || typeof entry[field] === "string"
        ));
    }

    /**
     * @param { TrashedQuote } entry
     * @returns {{ entry: TrashedQuote, changed: boolean }}
     */
    normalizeTrashEntry(entry) {
        const changed = Object.prototype.hasOwnProperty.call(entry, "Date") ||
            entry.Original_Date === undefined ||
            entry.Quote_Text === undefined ||
            entry.Submitter === undefined ||
            entry.Category === undefined;
        const normalizedEntry = {
            ...entry,
            Original_Date: entry.Original_Date ?? entry.Date,
            Quote_Text: entry.Quote_Text ?? "",
            Submitter: entry.Submitter ?? "",
            Category: entry.Category ?? "",
        };
        delete normalizedEntry.Date;
        return { entry: normalizedEntry, changed };
    }

    /**
     * @param { TrashedQuote[] } entries
     * @returns {string[]}
     */
    collectTrashIds(entries) {
        return entries.map(entry => (
            castIdToString(entry.Trash_ID) || "unidentified"
        ));
    }

    /**
     * @param { any } entry
     * @returns { boolean }
     */
    isValidTrashMetadata(entry) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.Trash_ID) {
            return false;
        }
        return typeof entry.Last_Trash_ID === "string" && /^\d+$/.test(entry.Last_Trash_ID);
    }

    /**
     * @param { string } [now]
     * @returns {number} the number of expired trash entries removed
     */
    pruneExpiredTrash(now = getUtcNowIsoString()) {
        return this.loadTrash(now);
    }

    /**
     * @returns {number} the number of trash entries removed
     */
    clearTrash() {
        this.loadTrash();
        const clearedCount = this.trashQuotes.filter(quote => quote.Trash_ID).length;
        const lastTrashId = this.calculateMaxTrashIndex(this.trashQuotes);
        this.trashQuotes = [{ Last_Trash_ID: String(lastTrashId) }];
        this.saveTrash();
        return clearedCount;
    }

    /**
     * Moves a caller's eligible quote to trash.
     * Without an ID, selects the caller's most recently added quote.
     *
     * @param { string } submitter
     * @param { any } [id]
     * @param { string } [now]
     * @returns { UndoAddResult }
     */
    undoAdd(submitter, id = null, now = getUtcNowIsoString()) {
        const nowDateTime = parseIsoDateTime(now);
        if (!nowDateTime) {
            return { status: "invalid-reference-time" };
        }

        const normalizedSubmitter = String(submitter || "").toLowerCase();
        this.load();
        if (id !== null && id !== undefined && id !== "") {
            const quoteId = castIdToString(id);
            const quote = this.quotes.find(candidate => candidate.Index === quoteId);
            return this.removeUndoableQuote(quote, normalizedSubmitter, nowDateTime);
        }

        let latestEligibleQuote;
        let latestEligibleAt;
        let latestEligibleSequence;
        let latestOwnedQuote;
        let latestOwnedAt;
        let latestOwnedSequence;
        let foundUnparsableDate = false;
        for (const [candidateIndex, candidate] of this.quotes.entries()) {
            if (!candidate.Index || String(candidate.Submitter || "").toLowerCase() !== normalizedSubmitter) {
                continue;
            }
            const submittedAt = parseQuoteTimestamp(candidate.Date);
            if (!submittedAt) {
                foundUnparsableDate = true;
                continue;
            }
            const creationSequence = this.getCreationSequence(candidate, candidateIndex);
            if (this.isLaterCreation(
                submittedAt,
                creationSequence,
                latestOwnedAt,
                latestOwnedSequence
            )) {
                latestOwnedQuote = candidate;
                latestOwnedAt = submittedAt;
                latestOwnedSequence = creationSequence;
            }
            if (!this.isQuoteUndoable(submittedAt, nowDateTime)) {
                continue;
            }
            if (this.isLaterCreation(
                submittedAt,
                creationSequence,
                latestEligibleAt,
                latestEligibleSequence
            )) {
                latestEligibleQuote = candidate;
                latestEligibleAt = submittedAt;
                latestEligibleSequence = creationSequence;
            }
        }

        if (latestEligibleQuote) {
            const removedQuote = this.remove(latestEligibleQuote.Index);
            return removedQuote ? { status: "removed", quote: removedQuote } : { status: "not-found" };
        }
        if (foundUnparsableDate) {
            return { status: "unparsable-date" };
        }
        if (latestOwnedQuote) {
            return { status: "expired" };
        }
        return { status: "not-found" };
    }

    /**
     * @param { Quote | undefined } quote
     * @param { string } normalizedSubmitter
     * @param { import("luxon").DateTime } nowDateTime
     * @returns { UndoAddResult }
     */
    removeUndoableQuote(quote, normalizedSubmitter, nowDateTime) {
        if (!quote) {
            return { status: "not-found" };
        }
        if (String(quote.Submitter || "").toLowerCase() !== normalizedSubmitter) {
            return { status: "not-owner" };
        }
        const submittedAt = parseQuoteTimestamp(quote.Date);
        if (!submittedAt) {
            return { status: "unparsable-date" };
        }
        if (!this.isQuoteUndoable(submittedAt, nowDateTime)) {
            return { status: "expired" };
        }
        const removedQuote = this.remove(quote.Index);
        return removedQuote ? { status: "removed", quote: removedQuote } : { status: "not-found" };
    }

    /**
     * @param { import("luxon").DateTime } candidateAt
     * @param { number } candidateSequence
     * @param { import("luxon").DateTime } [latestAt]
     * @param { number } [latestSequence]
     * @returns { boolean }
     */
    isLaterCreation(candidateAt, candidateSequence, latestAt, latestSequence) {
        if (!latestAt) {
            return true;
        }
        const timestampDifference = candidateAt.toMillis() - latestAt.toMillis();
        if (timestampDifference !== 0) {
            return timestampDifference > 0;
        }
        return candidateSequence >= (latestSequence || 0);
    }

    /**
     * @param { import("luxon").DateTime } submittedAt
     * @param { import("luxon").DateTime } nowDateTime
     * @returns { boolean }
     */
    isQuoteUndoable(submittedAt, nowDateTime) {
        const quoteAgeMs = nowDateTime.diff(submittedAt).as("milliseconds");
        return quoteAgeMs >= 0 && quoteAgeMs < QUOTE_UNDO_WINDOW_MS;
    }

    /**
     * @param { any } id
     * @returns { Quote | undefined } the restored Quote, if any
     */
    restore(id) {
        const trashId = castIdToString(id);
        if (!trashId) {
            return undefined;
        }

        this.loadTrash();
        const trashIndex = this.trashQuotes.findIndex(quote => (
            quote.Trash_ID === trashId && !quote.Restored_At
        ));
        if (trashIndex === -1) {
            return undefined;
        }

        const trashEntry = this.trashQuotes[trashIndex];
        this.load();
        this.ensureCreationSequences();
        const restoredSequence = castIdToNumber(trashEntry.Creation_Sequence) || this.getNextCreationSequence();
        const nextQuoteIndex = this.quotes.reduce((maximum, quote) => (
            Math.max(maximum, castIdToNumber(quote.Index))
        ), 0) + 1;
        const restoredQuote = {
            Index: String(nextQuoteIndex),
            Quote_Text: trashEntry.Quote_Text ?? "",
            Submitter: trashEntry.Submitter ?? "",
            Category: trashEntry.Category ?? "",
            Date: trashEntry.Original_Date,
            Creation_Sequence: String(restoredSequence),
        };
        this.quotes.push(restoredQuote);

        const metadataElement = this.quotes.find(quote => quote.Quote_Count !== undefined);
        if (metadataElement) {
            metadataElement.Quote_Count = restoredQuote.Index;
        }

        // Save the active quote before marking the trash entry to avoid data loss.
        this.save();
        trashEntry.Restored_At = getUtcNowIsoString();
        trashEntry.Restored_Index = restoredQuote.Index;
        this.saveTrash();
        return restoredQuote;
    }

}