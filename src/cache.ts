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

import * as ser from "./serializer";

import type * as localforageT from "localforage";
import * as lkf from "lockable-forage";

export interface CacheForage {
    localPromise: Promise<unknown>,
    nonlocalPromise: Promise<unknown>,
    local: lkf.LockableForage,
    nonlocal: typeof localforageT,
    error: any,
    cachedSize: number
}

type LocalforageCacheForage = typeof localforageT & {
    _cf: CacheForage
};

async function _initStorage(
    this: LocalforageCacheForage,
    options: any
) {
    this._cf = {
        localPromise: Promise.all([]),
        nonlocalPromise: Promise.all([]),
        local: new lkf.LockableForage(options.cacheForage.local),
        nonlocal: options.cacheForage.nonlocal,
        error: null,
        cachedSize: 0
    };
}

async function iterate(
    this: LocalforageCacheForage,
    iteratorCallback: (key: string) => any,
    successCallback: () => unknown
) {
    const cf = this._cf;
    if (cf.error)
        throw cf.error;

    const promise = cf.nonlocalPromise.then(async () => {
        await cf.local.localforage.iterate(iteratorCallback);
        await cf.nonlocal.iterate(iteratorCallback);
    });
    cf.nonlocalPromise = promise.catch(x => cf.error = x);
    await promise;

    if (successCallback)
        successCallback();
}

async function getItem(
    this: LocalforageCacheForage,
    key: string, callback?: (value:any)=>unknown
) {
    const cf = this._cf;
    if (cf.error)
        throw cf.error;

    const localPromise = cf.localPromise.then(() => {
        return cf.local.localforage.getItem(key);
    });
    cf.localPromise = localPromise.catch(x => cf.error = x);
    let value = await localPromise;

    if (value === null) {
        // Not present in local, try nonlocal
        const promise = cf.nonlocalPromise.then(async () => {
            return await cf.nonlocal.getItem(key);
        });
        cf.nonlocalPromise = promise.catch(x => cf.error = x);
        value = await promise;
    }

    if (callback)
        callback(value);
    return value;
}

async function setItem(
    this: LocalforageCacheForage,
    key: string, value: any, callback?: ()=>unknown
) {
    const cf = this._cf;
    if (cf.error)
        throw cf.error;

    const sz = ser.approxSize(value);
    this._cf.cachedSize += sz;

    const localPromise = cf.localPromise.then(async () =>  {
        await cf.local.lock(key, async () => {
            await cf.local.localforage.setItem(key, value);
        });
    });
    cf.localPromise = localPromise.catch(x => cf.error = x);
    await localPromise;
    value = null;

    cf.nonlocalPromise = cf.nonlocalPromise.then(async () => {
        await cf.local.lock(key, async () => {
            const value = await cf.local.localforage.getItem(key);
            if (value !== null)
                await cf.nonlocal.setItem(key, value);
            await cf.local.localforage.removeItem(key);
        });
        this._cf.cachedSize -= sz;
    }).catch(x => cf.error = x);

    if (callback)
        callback();
}

async function removeItem(
    this: LocalforageCacheForage,
    key: string, callback?: ()=>unknown
) {
    const cf = this._cf;
    if (cf.error)
        throw cf.error;

    const lp = cf.localPromise.then(async () => {
        await cf.local.lock(key, async () => {
            await cf.local.localforage.removeItem(key);
        });
    });
    cf.localPromise = lp.catch(x => cf.error = x);
    const nlp = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.removeItem(key);
    });
    cf.nonlocalPromise = nlp.catch(x => cf.error = x);

    await lp;
    await nlp;

    if (callback)
        callback();
}

async function clear(
    this: LocalforageCacheForage,
    callback?: ()=>unknown
) {
    const cf = this._cf;
    if (cf.error)
        throw cf.error;

    const lp = cf.localPromise.then(() => {
        return cf.local.localforage.clear();
    });
    cf.localPromise = lp.catch(x => cf.error = x);
    const nlp = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.clear();
    });
    cf.nonlocalPromise = nlp.catch(x => cf.error = x);

    await lp;
    await nlp;

    if (callback)
        callback();
}

async function length(
    this: LocalforageCacheForage,
    callback?: (len: number)=>unknown
) {
    const len = (await keys.call(this)).length;
    if (callback)
        callback(len);
    return len;
}

async function key(
    this: LocalforageCacheForage,
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

async function keys(
    this: LocalforageCacheForage,
    callback?: (keys: string[])=>unknown
) {
    const cf = this._cf;
    if (cf.error)
        throw cf.error;

    const lkeysP = cf.localPromise.then(() => {
        return cf.local.localforage.keys();
    });
    cf.localPromise = lkeysP.catch(x => cf.error = x);
    const nlkeysP = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.keys();
    });
    cf.nonlocalPromise = nlkeysP.catch(x => cf.error = x);

    return (await lkeysP).concat(await nlkeysP);
}

async function dropInstance(
    this: LocalforageCacheForage,
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    const cf = this._cf;
    if (cf.error)
        throw cf.error;

    const lp = cf.localPromise.then(() => {
        return cf.local.localforage.dropInstance(options);
    });
    cf.localPromise = lp.catch(x => cf.error = x);
    const nlp = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.dropInstance(options);
    });
    cf.nonlocalPromise = nlp.catch(x => cf.error = x);

    await lp;
    await nlp;

    if (callback)
        callback();
}

function cachedSize(this: LocalforageCacheForage) {
    return this._cf.cachedSize;
}

function nonlocalPromise(this: LocalforageCacheForage) {
    return this._cf.nonlocalPromise;
}

export const cacheForage = {
    _driver: "cacheForage",
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
    dropInstance,
    cachedSize,
    nonlocalPromise
};
