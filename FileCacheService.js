import { default as fs } from "fs";
import { default as path } from "path";

const caches = new Map();

function readFileJson(absolutePath) {
	if (fs.existsSync(absolutePath)) {
		// file exists, let's try to read and parse it
		let content;
		// read it
		try {
			content = fs.readFileSync(absolutePath, "utf-8");
		} catch (e) {
			// Reading failed, but the file DID exist.  Maybe file permission issues?  Can't continue in this case without clobbering the file.
			console.log(`File ${absolutePath} exists but could not be read.`, e);
			throw e;
		}
		
		let data;
		try {
			data = JSON.parse(content);
		} catch (e) {
			// File does not contain valid JSON.
			console.log(`File ${absolutePath} is not valid JSON.`, e);
			throw e;
		}

		return data;
	} else {
		// File doesn't exist.  Initialize it to make sure file permissions will work later.
		console.log(`File ${absolutePath} not found; initializing file with empty object.`);
		const data = {};
		writeFileJson(absolutePath, data);
		return data;
	}
}

function writeFileJson(absolutePath, data) {
	fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), "utf-8");
}

export function buildFileCache(filePath) {
	// turn any relative path like "something.json" into "C:\Users\anyia\path\to\kiawaBot\something.json"
	const absolutePath = path.resolve(path.dirname("."), filePath);
	
	// if we don't already have a file cache created for this path, make one
	if (!caches.has(absolutePath)) {
		// read the data that's already in the file, to start with
		const initialData = readFileJson(absolutePath);

		// make a method wrapper that also writes any data changes to the filesystem
		function buildFileCachingHook(method) {
			return function fileCachingHook() {
				const result = Reflect[method].apply(cache, arguments); // do the original method call
				writeFileJson(absolutePath, cache); // write the updated cache object out to disk
				return result; // return whatever the original method would have returned
			};
		}

		const cache = new Proxy(initialData, {
			set: buildFileCachingHook("set"), // when setting a property directly on the cache, write it to disk
			deleteProperty: buildFileCachingHook("deleteProperty"), // when deleting a property directly from the cache, write it to disk
		});

		caches.set(absolutePath, cache); // save the cache for later, so anyone using the equivalent path will share the same Proxy
	}

	return caches.get(absolutePath); // return the cached Proxy
}