const jsonfile = require('jsonfile');

class QuoteManager {
    constructor(client, channelName, quotePath, allowList) {
        this.client = client;
        this.channelName = channelName;
        this.quotePath = quotePath;
        this.allowList = allowList;
    }

    handleAddQuote(tags, args) {
        if (this.allowList.includes(tags.username) || tags.mod === true || tags.vip === true) {
            jsonfile.readFile(this.quotePath, (err, quote_List) => {
                if (err) {
                    console.error(err);
                    return;
                }

                const quote_Count = quote_List.find(search => search.Quote_Count);
                const quote_Text = args.slice(1).join(' ');

                if (!quote_Text.trim()) {
                    this.client.say(this.channelName, `Please provide text for the quote!`);
                    return;
                }

                const newQuoteNumber = Number(quote_Count.Quote_Count) + 1;
                const newQuote = {
                    "Quote_Number": newQuoteNumber,
                    "Quote_Text": quote_Text
                };

                quote_List.push(newQuote);
                quote_Count.Quote_Count = newQuoteNumber;

                jsonfile.writeFile(this.quotePath, quote_List, { spaces: 2 }, (err) => {
                    if (err) console.error(err);
                });

                this.client.say(this.channelName, `Added Quote #${newQuoteNumber}: ${quote_Text}`);
            });
        } else {
            this.client.say(this.channelName, `@${tags.username}, you don't have permission to add quotes!`);
        }
    }

    handleQuote(tags, args) {
        jsonfile.readFile(this.quotePath, (err, quote_List) => {
            if (err) {
                console.error(err);
                return;
            }

            const quote_Count = quote_List.find(search => search.Quote_Count);
            const totalQuotes = Number(quote_Count.Quote_Count);

            if (totalQuotes === 0) {
                this.client.say(this.channelName, `No quotes available!`);
                return;
            }

            let quote_Request = args[1];
            let selectedQuote;

            if (quote_Request && !isNaN(quote_Request)) {
                // Specific quote number requested
                const quoteNumber = Number(quote_Request);
                if (quoteNumber <= totalQuotes && quoteNumber > 0) {
                    selectedQuote = quote_List.find(quote => quote.Quote_Number === quoteNumber);
                } else {
                    this.client.say(this.channelName, `Quote #${quoteNumber} doesn't exist! Available quotes: 1-${totalQuotes}`);
                    return;
                }
            } else {
                // Random quote
                const randomNumber = Math.floor(Math.random() * totalQuotes) + 1;
                selectedQuote = quote_List.find(quote => quote.Quote_Number === randomNumber);
            }

            if (selectedQuote) {
                this.client.say(this.channelName, `Quote #${selectedQuote.Quote_Number}: ${selectedQuote.Quote_Text}`);
            } else {
                this.client.say(this.channelName, `Error retrieving quote!`);
            }
        });
    }

    handleEditQuote(tags, args) {
        if (this.allowList.includes(tags.username) || tags.mod === true || tags.vip === true) {
            jsonfile.readFile(this.quotePath, (err, quote_List) => {
                if (err) {
                    console.error(err);
                    return;
                }

                const quote_Count = quote_List.find(search => search.Quote_Count);
                const totalQuotes = Number(quote_Count.Quote_Count);

                try {
                    const quote_Request = args[1];
                    const quote_Edited = args.slice(2).join(' ');

                    if (!quote_Request || isNaN(quote_Request)) {
                        this.client.say(this.channelName, `Please provide a valid quote number!`);
                        return;
                    }

                    if (!quote_Edited.trim()) {
                        this.client.say(this.channelName, `Please provide new text for the quote!`);
                        return;
                    }

                    const quoteNumber = Number(quote_Request);

                    if (quoteNumber <= totalQuotes && quoteNumber > 0) {
                        const quoteToEdit = quote_List.find(quote => quote.Quote_Number === quoteNumber);
                        if (quoteToEdit) {
                            quoteToEdit.Quote_Text = quote_Edited;

                            jsonfile.writeFile(this.quotePath, quote_List, { spaces: 2 }, (err) => {
                                if (err) console.error(err);
                            });

                            this.client.say(this.channelName, `Updated Quote #${quote_Request}: ${quote_Edited}`);
                        } else {
                            this.client.say(this.channelName, `Error finding quote #${quote_Request}`);
                        }
                    } else {
                        this.client.say(this.channelName, `Quote #${quote_Request} doesn't exist! Available quotes: 1-${totalQuotes}`);
                    }
                } catch (err) {
                    console.error(err);
                    this.client.say(this.channelName, `Error processing quote edit request!`);
                }
            });
        } else {
            this.client.say(this.channelName, `@${tags.username}, you don't have permission to edit quotes!`);
        }
    }
}

module.exports = QuoteManager;