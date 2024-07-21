/*
 * Copyright (c) 2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

import type * as localforageT from "localforage";

declare var WebDAV: any;

import * as nlfOptions from "./nlf-options";
import * as ser from "./serializer";
import * as util from "./util";

interface WebDAVData {
    promise: Promise<unknown>;
    dav: any;
    dir: string;
}

type LocalforageWebDAV = typeof localforageT & {
    _dav: WebDAVData;
};

async function _initStorage(
    this: LocalforageWebDAV,
    options: any
) {
    try {
        const nlfOpts: nlfOptions.NonlocalforageOptions = options.nonlocalforage;

        // Load the library
        if (typeof WebDAV === "undefined")
            await util.loadScript("https://cdn.jsdelivr.net/npm/webdav@4.11.3/web/index.js");

        const dav = WebDAV.createClient(
            options.webDAV.server,
            {
                username: options.webDAV.username,
                password: options.webDAV.password
            }
        );

        // Create the store path
        const path = util.cloudDirectory(options);
        let curDir = "";
        for (const part of path.split("/")) {
            curDir = `${curDir}/${part}`;
            if (!(await dav.exists(curDir)))
                await dav.createDirectory(curDir);
        }

        this._dav = {
            promise: Promise.all([]),
            dav, dir: curDir
        };

    } catch (ex: any) {
        console.error(`${ex}\n${ex.stack}`);
        throw ex;

    }
}

function iterate(
    this: LocalforageWebDAV,
    iteratorCallback: (key: string) => any,
    successCallback: () => unknown
) {
    const p = this._dav.promise.catch(console.error).then(async () => {
        const files: any[] = await this._dav.dav.getDirectoryContents(this._dav.dir);
        for (const file of files)
            iteratorCallback(ser.unsafeify(file.basename));
        if (successCallback)
            successCallback();
    });
    this._dav.promise = p;
    return p;
}

function getItem(
    this: LocalforageWebDAV,
    key: string, callback?: (value: any)=>unknown
) {
    const p = this._dav.promise.catch(console.error).then(async () => {
        // Try to download the file
        let value: any = null;
        try {
            const dl = await this._dav.dav.getFileContents(
                `${this._dav.dir}/${ser.safeify(key)}`
            );
            value = ser.deserialize(new Uint8Array(dl));
        } catch (ex) {}

        if (callback)
            callback(value);

        return value;
    });
    this._dav.promise = p;
    return p;
}

function setItem(
    this: LocalforageWebDAV,
    key: string, value: any, callback?: ()=>unknown
) {
    const p = this._dav.promise.catch(console.error).then(async () => {
        // Serialize the value
        const valSer = ser.serialize(value);

        // Create the file
        await this._dav.dav.putFileContents(
            `${this._dav.dir}/${ser.safeify(key)}`,
            valSer.buffer
        );

        if (callback)
            callback();
    });
    this._dav.promise = p;
    return p;
}

function removeItem(
    this: LocalforageWebDAV,
    key: string, callback?: ()=>unknown
) {
    const p = this._dav.promise.catch(console.error).then(async () => {
        const dav: any = this._dav.dav;
        const name =
            `${this._dav.dir}/${ser.safeify(key)}`;
        if (await dav.exists(name))
            await dav.deleteFile(name);
        if (callback)
            callback();
    });
    this._dav.promise = p;
    return p;
}

function clear(
    this: LocalforageWebDAV,
    callback?: ()=>unknown
) {
    const p = this._dav.promise.catch(console.error).then(async () => {
        const {dav, dir} = this._dav;
        await dav.deleteFile(dir);
        await dav.createDirectory(dir);
        if (callback)
            callback();
    });
    this._dav.promise = p;
    return p;
}

function length(
    this: LocalforageWebDAV,
    callback?: (len: number)=>unknown
) {
    const p = this._dav.promise.catch(console.error).then(async () => {
        const files = await this._dav.dav.getDirectoryContents(this._dav.dir);
        if (callback)
            callback(files.length);
        return files.length;
    });
    this._dav.promise = p;
    return p;
}

async function key(
    this: LocalforageWebDAV,
    index: number, callback?: (key: string)=>unknown
) {
    const key = (await keys.call(this))[index];
    if (key) {
        if (callback)
            callback(key);
        return key;
    }
    throw new Error("Key does not exist");
}

function keys(
    this: LocalforageWebDAV,
    callback?: (keys: string[])=>unknown
) {
    const p = this._dav.promise.catch(console.error).then(async () => {
        const files: any[] = await this._dav.dav.getDirectoryContents(this._dav.dir);
        const keys = files.map(x => ser.unsafeify(x.basename));
        if (callback)
            callback(keys);
        return keys;
    });
    this._dav.promise = p;
    return p;
}

function dropInstance(
    this: LocalforageWebDAV,
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    if (typeof options === "function") {
        // This API was made by clowns
        callback = <any> options;
        options = void 0;
    }

    const p = this._dav.promise.catch(console.error).then(async () => {
        // Figure out which directory to delete
        const toDelete = util.dropInstanceDirectory(this._dav.dir, options);
        await this._dav.dav.deleteFile(toDelete);
        if (callback)
            callback();
    });
    this._dav.promise = p;
    return p;
}

export const webDAVLocalForage = {
    _driver: "webDAV",
    _support: true,
    _initStorage,
    iterate,
    getItem,
    setItem,
    removeItem,
    clear,
    length,
    key,
    keys,
    dropInstance
};
