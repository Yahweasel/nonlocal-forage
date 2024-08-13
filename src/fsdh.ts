// SPDX-License-Identifier: ISC
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

import * as nlfOptions from "./nlf-options";
import * as ser from "./serializer";
import * as util from "./util";

export interface FSDHData {
    promise: Promise<unknown>;
    root: FileSystemDirectoryHandle,
    path: string,
    dir: FileSystemDirectoryHandle & {
        keys: ()=>AsyncIterator<string>
    }
}

type LocalforageFSDH = typeof localforageT & {
    _fsdh: FSDHData;
};

async function _initStorage(
    this: LocalforageFSDH,
    options: any
) {
    try {
        const nlfOpts: nlfOptions.NonlocalforageOptions = options.nonlocalforage;
        let dir: FileSystemDirectoryHandle = options.directoryHandle;

        // Create the store path
        const path = util.cloudDirectory(options);
        for (const part of path.split("/"))
            dir = await dir.getDirectoryHandle(part, {create: true});

        this._fsdh = {
            promise: Promise.all([]),
            root: options.directoryHandle,
            path,
            dir: <any> dir
        };

    } catch (ex: any) {
        console.error(`${ex}\n${ex.stack}`);
        throw ex;

    }
}

function iterate(
    this: LocalforageFSDH,
    iteratorCallback: (key: string) => any,
    successCallback: () => unknown
) {
    const p = this._fsdh.promise.catch(console.error).then(async () => {
        const it = this._fsdh.dir.keys();
        while (true) {
            const file = await it.next();
            if (file.done) break;
            iteratorCallback(ser.unsafeify(file.value));
        }
        if (successCallback)
            successCallback();
    });
    this._fsdh.promise = p;
    return p;
}

function getItem(
    this: LocalforageFSDH,
    key: string, callback?: (value: any)=>unknown
) {
    const p = this._fsdh.promise.catch(console.error).then(async () => {
        // Try to fetch the file
        let value: any = null;
        try {
            const file = await this._fsdh.dir.getFileHandle(
                ser.safeify(key)
            );
            const blob = await file.getFile();
            value = ser.deserialize(new Uint8Array(await blob.arrayBuffer()));
        } catch (ex) {}

        if (callback)
            callback(value);

        return value;
    });
    this._fsdh.promise = p;
    return p;
}

function setItem(
    this: LocalforageFSDH,
    key: string, value: any, callback?: ()=>unknown
) {
    const p = this._fsdh.promise.catch(console.error).then(async () => {
        // Serialize the value
        const valSer = ser.serialize(value);

        // Create the file
        const file = await this._fsdh.dir.getFileHandle(
            ser.safeify(key),
            {create: true}
        );
        const wr = await file.createWritable();
        await wr.write(valSer);
        await wr.close();

        if (callback)
            callback();
    });
    this._fsdh.promise = p;
    return p;
}

function removeItem(
    this: LocalforageFSDH,
    key: string, callback?: ()=>unknown
) {
    const p = this._fsdh.promise.catch(console.error).then(async () => {
        try {
            await this._fsdh.dir.removeEntry(ser.safeify(key));
        } catch (ex) {}
        if (callback)
            callback();
    });
    this._fsdh.promise = p;
    return p;
}

function clear(
    this: LocalforageFSDH,
    callback?: ()=>unknown
) {
    const p = this._fsdh.promise.catch(console.error).then(async () => {
        const dir = this._fsdh.dir;
        const files: string[] = [];
        const it = dir.keys();
        while (true) {
            const file = await it.next();
            if (file.done) break;
            files.push(file.value);
        }
        for (const file of files)
            await dir.removeEntry(file);
        if (callback)
            callback();
    });
    this._fsdh.promise = p;
    return p;
}

function length(
    this: LocalforageFSDH,
    callback?: (len: number)=>unknown
) {
    const p = this._fsdh.promise.catch(console.error).then(async () => {
        let len = 0;
        const it = this._fsdh.dir.keys();
        while (true) {
            const file = await it.next();
            if (file.done) break;
            len++;
        }
        if (callback)
            callback(len);
        return len;
    });
    this._fsdh.promise = p;
    return p;
}

async function key(
    this: LocalforageFSDH,
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
    this: LocalforageFSDH,
    callback?: (keys: string[])=>unknown
) {
    const p = this._fsdh.promise.catch(console.error).then(async () => {
        const keys: string[] = [];
        const it = this._fsdh.dir.keys();
        while (true) {
            const file = await it.next();
            if (file.done) break;
            keys.push(ser.unsafeify(file.value));
        }
        if (callback)
            callback(keys);
        return keys;
    });
    this._fsdh.promise = p;
    return p;
}

function dropInstance(
    this: LocalforageFSDH,
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    if (typeof options === "function") {
        // This API was made by clowns
        callback = <any> options;
        options = void 0;
    }

    const p = this._fsdh.promise.catch(console.error).then(async () => {
        // Figure out which directory to delete
        const toDelete = util.dropInstanceDirectory(this._fsdh.path, options);
        const pathParts = toDelete.split("/");
        let dir = this._fsdh.root;
        for (const part of pathParts.slice(0, pathParts.length - 1))
            dir = await dir.getDirectoryHandle(part);
        await dir.removeEntry(pathParts[pathParts.length-1], {recursive: true});
        if (callback)
            callback();
    });
    this._fsdh.promise = p;
    return p;
}

export const fsdhLocalForage = {
    _driver: "FileSystemDirectoryHandle",
    _support: (
        typeof FileSystemDirectoryHandle !== "undefined" &&
        !!(<any> FileSystemDirectoryHandle.prototype).keys
    ),
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
