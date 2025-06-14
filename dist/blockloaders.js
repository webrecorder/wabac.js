import { AuthNeededError, AccessDeniedError, RangeError, sleep, MAX_FULL_DOWNLOAD_SIZE, } from "./utils";
import { initAutoIPFS } from "./ipfs";
import { concatChunks } from "warcio";
// todo: make configurable
const HELPER_PROXY = "https://helper-proxy.webrecorder.workers.dev";
// ===========================================================================
export async function createLoader(opts) {
    const { url } = opts;
    if (opts.extra?.arrayBuffer) {
        return new ArrayBufferLoader(opts.extra.arrayBuffer);
    }
    const scheme = url.split(":", 1)[0];
    // built-in loaders
    switch (scheme) {
        case "blob":
            return new BlobCacheLoader(opts);
        case "http":
        case "https":
            return new FetchRangeLoader(opts);
        case "file":
            return new FileHandleLoader(opts);
        case "googledrive":
            return new GoogleDriveLoader(opts);
        case "ipfs":
            return new IPFSRangeLoader(opts);
    }
    // if URL has same scheme as current origin, use regular http fetch
    try {
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (self.location && scheme === self.location.protocol.split(":")[0]) {
            return new FetchRangeLoader(opts);
        }
    }
    catch (_) {
        // likely no self and self.location, so ignore
    }
    // see if the specified scheme is generally fetchable
    try {
        await fetch(`${scheme}://localhost`, { method: "HEAD" });
        // if reached here, scheme is supported, so use fetch loader
        // first, check if URL is valid, if not, check if Windows path-related, and convert
        try {
            new URL(url);
        }
        catch (_) {
            // will convert C:\path\to\file -> C//path/to/file to be valid URL
            let newUrl = url.replace(":\\", "//");
            newUrl = newUrl.replaceAll("\\", "/");
            opts.url = newUrl;
        }
        return new FetchRangeLoader(opts);
    }
    catch (_) {
        // if raised exception, scheme not supported, don't use fetch loader
    }
    // custom provided loaders
    throw new Error("Invalid URL: " + url);
}
// ===========================================================================
export class BaseLoader {
    canLoadOnDemand = true;
    headers = {};
    length = null;
    canDoNegativeRange = false;
    constructor(canLoadOnDemand) {
        this.canLoadOnDemand = canLoadOnDemand;
    }
    async getRangeFromEnd(length, streaming, signal) {
        if (!this.canDoNegativeRange) {
            const totalLength = await this.getLength();
            length = Math.min(length, totalLength);
            return await this.getRange(totalLength - length, length, streaming, signal);
        }
        else {
            return await this.getRange(0, -length, streaming, signal);
        }
    }
    getFullBuffer() {
        return null;
    }
}
// ===========================================================================
class FetchRangeLoader extends BaseLoader {
    url;
    length;
    isValid = false;
    ipfsAPI = null;
    loadingIPFS = null;
    arrayBuffer = null;
    constructor({ url, headers, length = null, canLoadOnDemand = false, }) {
        super(canLoadOnDemand);
        this.url = url;
        this.headers = headers || {};
        this.length = length;
        this.canLoadOnDemand = canLoadOnDemand;
        this.canDoNegativeRange = true;
    }
    async doInitialFetch(tryHead, skipRange = false) {
        const headers = new Headers(this.headers);
        if (!skipRange) {
            headers.set("Range", "bytes=0-");
        }
        this.isValid = false;
        let abort = null;
        let response = null;
        if (tryHead) {
            try {
                response = await this.retryFetch(this.url, {
                    headers,
                    method: "HEAD",
                    cache: "no-store",
                });
                if (response.status === 200 || response.status == 206) {
                    this.canLoadOnDemand =
                        response.status === 206 ||
                            response.headers.get("Accept-Ranges") === "bytes";
                    this.isValid = true;
                }
            }
            catch (_) {
                // ignore fetch failure, considered invalid
            }
        }
        if (!this.isValid || !this.canLoadOnDemand) {
            abort = new AbortController();
            const signal = abort.signal;
            response = await this.retryFetch(this.url, {
                headers,
                signal,
                cache: "no-store",
            });
            this.canLoadOnDemand =
                response.status === 206 ||
                    response.headers.get("Accept-Ranges") === "bytes";
            this.isValid = response.status === 206 || response.status === 200;
            // if emulating HEAD, abort here
            if (tryHead) {
                abort.abort();
                abort = null;
            }
        }
        if (this.length === null && response) {
            this.length = Number(response.headers.get("Content-Length"));
            if (!this.length && response.status === 206) {
                this.parseLengthFromContentRange(response.headers);
            }
        }
        if (this.length === null) {
            // attempt to get length via proxy
            try {
                const resp = await fetch(`${HELPER_PROXY}/c/${this.url}`);
                const json = await resp.json();
                if (json.size) {
                    this.length = json.size;
                }
            }
            catch (e) {
                console.log("Error fetching from helper: " + e);
            }
        }
        this.length = Number(this.length || 0);
        // even if no range requests, support buffering small enough files
        if (!this.canLoadOnDemand &&
            this.isValid &&
            this.length > 0 &&
            this.length <= MAX_FULL_DOWNLOAD_SIZE) {
            const resp = await this.retryFetch(this.url, {
                headers,
                cache: "no-store",
            });
            if (resp.ok) {
                this.arrayBuffer = new ArrayBufferLoader(new Uint8Array(await resp.arrayBuffer()));
                this.canLoadOnDemand = true;
                this.canDoNegativeRange = false;
            }
        }
        return { response: response, abort };
    }
    async getLength() {
        if (this.length === null) {
            const { abort } = await this.doInitialFetch(true);
            if (abort) {
                abort.abort();
            }
        }
        return this.length || 0;
    }
    async getRange(offset, length, streaming = false, signal = null) {
        if (this.arrayBuffer) {
            return await this.arrayBuffer.getRange(offset, length, streaming);
        }
        const headers = new Headers(this.headers);
        if (length < 0) {
            headers.set("Range", `bytes=${length}`);
        }
        else {
            headers.set("Range", `bytes=${offset}-${offset + length - 1}`);
        }
        const cache = "no-store";
        const options = { signal, headers, cache };
        let resp;
        try {
            resp = await this.retryFetch(this.url, options);
        }
        catch (_) {
            throw new RangeError(this.url);
        }
        if (resp.status != 206) {
            if (length < 0) {
                // attempt to get full length and try non-negative range
                const totalLength = await this.getLength();
                if (-length > totalLength) {
                    length = -totalLength;
                }
                return await this.getRange(totalLength + length, -length, streaming, signal);
            }
            const info = { url: this.url, status: resp.status, resp };
            if (resp.status === 401) {
                throw new AuthNeededError(info);
            }
            else if (resp.status == 403) {
                throw new AccessDeniedError(info);
            }
            else {
                throw new RangeError(info);
            }
        }
        if (this.length === null) {
            this.parseLengthFromContentRange(resp.headers);
        }
        if (streaming) {
            return resp.body || new Uint8Array();
        }
        else {
            return new Uint8Array(await resp.arrayBuffer());
        }
    }
    async retryFetch(url, options) {
        let backoff = 1000;
        for (let count = 0; count < 20; count++) {
            const resp = await fetch(url, options);
            if (resp.status !== 429 && resp.status !== 503) {
                return resp;
            }
            await sleep(backoff);
            backoff += 2000;
        }
        throw new Error("retryFetch failed");
    }
    parseLengthFromContentRange(headers) {
        const range = headers.get("Content-Range");
        if (range) {
            const rangeParts = range.split("/");
            if (rangeParts.length === 2) {
                // @ts-expect-error [TODO] - TS2345 - Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
                this.length = parseInt(rangeParts[1]);
            }
        }
    }
    getFullBuffer() {
        return this.arrayBuffer?.getFullBuffer() ?? null;
    }
}
// ===========================================================================
class GoogleDriveLoader extends BaseLoader {
    fileId;
    apiUrl;
    // @ts-expect-error [TODO] - TS4114 - This member must have an 'override' modifier because it overrides a member in the base class 'BaseLoader'.
    length;
    publicUrl = null;
    isValid = false;
    constructor({ url, headers, size, extra, }) {
        super(true);
        this.fileId = url.slice("googledrive://".length);
        this.apiUrl = `https://www.googleapis.com/drive/v3/files/${this.fileId}?alt=media`;
        this.headers = headers || {};
        if (extra?.publicUrl) {
            this.publicUrl = extra.publicUrl;
        }
        this.length = size || 0;
    }
    async getLength() {
        return this.length;
    }
    async doInitialFetch(tryHead) {
        let loader = null;
        let result = null;
        if (this.publicUrl) {
            loader = new FetchRangeLoader({
                url: this.publicUrl,
                length: this.length,
            });
            try {
                result = await loader.doInitialFetch(tryHead);
            }
            catch (_) {
                // catch and ignore, considered invalid
            }
            if (!loader.isValid) {
                if (result?.abort) {
                    result.abort.abort();
                }
                if (await this.refreshPublicUrl()) {
                    loader = new FetchRangeLoader({
                        url: this.publicUrl,
                        length: this.length,
                    });
                    try {
                        result = await loader.doInitialFetch(tryHead);
                    }
                    catch (_) {
                        // catch and ignore, considered invalid
                    }
                    if (!loader.isValid && result?.abort) {
                        result.abort.abort();
                    }
                }
            }
        }
        if (!loader?.isValid) {
            this.publicUrl = null;
            loader = new FetchRangeLoader({
                url: this.apiUrl,
                headers: this.headers,
                length: this.length,
            });
            result = await loader.doInitialFetch(tryHead);
        }
        this.isValid = loader.isValid;
        if (!this.length && loader.length) {
            this.length = loader.length;
        }
        return result;
    }
    async getRange(offset, length, streaming = false, signal) {
        let loader = null;
        if (this.publicUrl) {
            loader = new FetchRangeLoader({
                url: this.publicUrl,
                length: this.length,
            });
            try {
                return await loader.getRange(offset, length, streaming, signal);
            }
            catch (_) {
                if (await this.refreshPublicUrl()) {
                    loader = new FetchRangeLoader({
                        url: this.publicUrl,
                        length: this.length,
                    });
                    try {
                        return await loader.getRange(offset, length, streaming, signal);
                    }
                    catch (_) {
                        // ignore fetch failure, considered invalid
                    }
                }
            }
            //disable public mode?
            this.publicUrl = null;
        }
        loader = new FetchRangeLoader({
            url: this.apiUrl,
            headers: this.headers,
            length: this.length,
        });
        let backoff = 50;
        while (backoff < 2000) {
            try {
                return await loader.getRange(offset, length, streaming, signal);
            }
            catch (e) {
                if (e instanceof AccessDeniedError &&
                    e.info["resp"]?.headers
                        .get("content-type")
                        .startsWith("application/json")) {
                    const err = await e.info["resp"].json();
                    if (err.error?.errors &&
                        err.error.errors[0].reason === "userRateLimitExceeded") {
                        console.log(`Exponential backoff, waiting for: ${backoff}`);
                        await sleep(backoff);
                        backoff *= 2;
                        continue;
                    }
                }
                throw e;
            }
        }
        throw new RangeError("not found");
    }
    async refreshPublicUrl() {
        try {
            const resp = await fetch(`${HELPER_PROXY}/g/${this.fileId}`);
            const json = await resp.json();
            if (json.url) {
                this.publicUrl = json.url;
                return true;
            }
        }
        catch (_) {
            // ignore, return false
        }
        return false;
    }
}
// ===========================================================================
class ArrayBufferLoader extends BaseLoader {
    arrayBuffer;
    size;
    constructor(arrayBuffer) {
        super(true);
        this.arrayBuffer = arrayBuffer;
        this.size = arrayBuffer.length;
        this.length = this.size;
    }
    get isValid() {
        return !!this.arrayBuffer;
    }
    async getLength() {
        return this.size;
    }
    async doInitialFetch(tryHead = false) {
        const stream = tryHead
            ? null
            : getReadableStreamFromArray(this.arrayBuffer);
        const response = new Response(stream);
        return { response, abort: null };
    }
    async getRange(offset, length, streaming = false /*, signal*/) {
        const range = this.arrayBuffer.slice(offset, offset + length);
        return streaming ? getReadableStreamFromArray(range) : range;
    }
    getFullBuffer() {
        return this.arrayBuffer;
    }
}
// ===========================================================================
class BlobCacheLoader extends BaseLoader {
    url;
    blob;
    size;
    arrayBuffer = null;
    constructor({ url, blob = null, size = null, }) {
        super(true);
        this.url = url;
        this.blob = blob;
        this.size = this.blob ? this.blob.size : size || 0;
        this.length = this.size;
    }
    get isValid() {
        return !!this.blob;
    }
    async getLength() {
        if (!this.blob?.size) {
            const response = await fetch(this.url);
            this.blob = await response.blob();
            this.size = this.blob.size;
            this.length = this.size;
        }
        return this.size;
    }
    async doInitialFetch(tryHead = false) {
        if (!this.blob) {
            try {
                const response = await fetch(this.url);
                this.blob = await response.blob();
                this.size = this.blob.size;
                this.length = this.size;
            }
            catch (e) {
                console.warn(e);
                throw e;
            }
        }
        // [TODO]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const arrayBuffer = this.blob.arrayBuffer
            ? await this.blob.arrayBuffer()
            : await this._getArrayBuffer();
        this.arrayBuffer = new Uint8Array(arrayBuffer);
        const stream = tryHead
            ? null
            : getReadableStreamFromArray(this.arrayBuffer);
        const response = new Response(stream);
        return { response, abort: null };
    }
    async getRange(offset, length, streaming = false /*, signal*/) {
        if (!this.arrayBuffer) {
            await this.doInitialFetch(true);
        }
        const range = this.arrayBuffer.slice(offset, offset + length);
        return streaming ? getReadableStreamFromArray(range) : range;
    }
    async _getArrayBuffer() {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onloadend = () => {
                if (fr.result instanceof ArrayBuffer) {
                    resolve(fr.result);
                }
                else {
                    reject(fr.result);
                }
            };
            if (this.blob) {
                fr.readAsArrayBuffer(this.blob);
            }
        });
    }
}
// ===========================================================================
class FileHandleLoader extends BaseLoader {
    url;
    file;
    size;
    fileHandle;
    constructor({ blob, size, extra, url, }) {
        super(true);
        this.url = url;
        this.file = null;
        this.size = blob ? blob.size : size || 0;
        this.length = this.size;
        this.fileHandle = extra.fileHandle;
    }
    get isValid() {
        return !!this.file;
    }
    async getLength() {
        if (this.size === undefined) {
            await this.initFileObject();
        }
        return this.size;
    }
    async initFileObject() {
        const options = { mode: "read" };
        const curr = await this.fileHandle.queryPermission(options);
        if (curr !== "granted") {
            const requested = await this.fileHandle.requestPermission(options);
            if (requested !== "granted") {
                throw new AuthNeededError({ fileHandle: this.fileHandle });
            }
        }
        this.file = await this.fileHandle.getFile();
        this.size = this.file.size;
        this.length = this.size;
    }
    async doInitialFetch(tryHead = false) {
        if (!this.file) {
            await this.initFileObject();
        }
        const stream = tryHead ? null : this.file.stream();
        const response = new Response(stream);
        return { response, abort: null };
    }
    async getRange(offset, length, streaming = false /*, signal*/) {
        if (!this.file) {
            await this.initFileObject();
        }
        const fileSlice = this.file.slice(offset, offset + length);
        return streaming
            ? fileSlice.stream()
            : new Uint8Array(await fileSlice.arrayBuffer());
    }
}
// ===========================================================================
class IPFSRangeLoader extends BaseLoader {
    url;
    opts;
    length;
    isValid = false;
    constructor({ url, headers, ...opts }) {
        super(true);
        this.url = url;
        this.opts = opts;
        // let inx = url.lastIndexOf("#");
        // if (inx < 0) {
        //   inx = undefined;
        // }
        this.headers = headers || {};
        this.length = null;
    }
    async getLength() {
        if (this.length === null) {
            await this.doInitialFetch(true);
        }
        return this.length;
    }
    async doInitialFetch(tryHead) {
        const autoipfsClient = await initAutoIPFS(this.opts);
        try {
            this.length = await autoipfsClient.getSize(this.url);
            this.isValid = this.length !== null;
        }
        catch (e) {
            console.warn(e);
            this.length = null;
            this.isValid = false;
        }
        let status = 206;
        if (!this.isValid) {
            status = 404;
        }
        const abort = new AbortController();
        const signal = abort.signal;
        let body;
        if (tryHead || !this.isValid) {
            body = new Uint8Array([]);
        }
        else {
            const iter = autoipfsClient.get(this.url, {
                signal,
            });
            body = getReadableStreamFromIter(iter);
        }
        const response = new Response(body, { status });
        return { response, abort };
    }
    async getRange(offset, length, streaming = false, signal = null) {
        const autoipfsClient = await initAutoIPFS(this.opts);
        const iter = autoipfsClient.get(this.url, {
            start: offset,
            end: offset + length - 1,
            signal,
        });
        if (streaming) {
            return getReadableStreamFromIter(iter);
        }
        else {
            const chunks = [];
            let size = 0;
            for await (const chunk of iter) {
                chunks.push(chunk);
                size += chunk.byteLength;
            }
            return concatChunks(chunks, size);
        }
    }
}
export function getReadableStreamFromIter(stream) {
    return new ReadableStream({
        start: async (controller) => {
            try {
                for await (const chunk of stream) {
                    controller.enqueue(chunk);
                }
            }
            catch (e) {
                console.log(e);
            }
            controller.close();
        },
    });
}
export function getReadableStreamFromArray(array) {
    return new ReadableStream({
        start(controller) {
            controller.enqueue(array);
            controller.close();
        },
    });
}
//# sourceMappingURL=blockloaders.js.map