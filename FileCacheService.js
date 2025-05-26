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
	// convert data to JSON
	const json = JSON.stringify(data, null, 2);
	// write JSON to file, clobbering it
	fs.writeFileSync(absolutePath, json, "utf-8");
}

function buildFileProxy(absolutePath) {
	// read the data that's already in the file, to start with
	const initialData = readFileJson(absolutePath);

	// make a method wrapper that also writes any data changes to the filesystem
	function buildFileCachingHook(method) {
		return function fileCachingHook() {
			// do the original method call
			const result = Reflect[method].apply(cache, arguments);
			// write the updated cache object out to disk
			writeFileJson(absolutePath, cache);
			// return whatever the original method would have returned
			return result;
		};
	}

	// create a Proxy starting from the original file data
	const cache = new Proxy(initialData, {
		// when setting a property directly on the Proxy, write it to disk
		set: buildFileCachingHook("set"),
		// when deleting a property directly from the Proxy, write it to disk
		deleteProperty: buildFileCachingHook("deleteProperty"),
	});
	
	return cache;
}

export function getFileCache(filePath) {
	// turn any relative path like "something.json" into "C:\Users\anyia\path\to\kiawaBot\something.json"
	const absolutePath = path.resolve(path.dirname("."), filePath);
	
	
	if (!caches.has(absolutePath)) {
		// if we don't already have a file cache created for this path, make one
		const cache = buildFileProxy(absolutePath);
		// save the cache for later, so anyone using the equivalent path will share the same Proxy
		caches.set(absolutePath, cache);
	}

	// return the cached Proxy
	return caches.get(absolutePath);
}