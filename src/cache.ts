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

interface CacheForage {
    localPromise: Promise<unknown>,
    nonlocalPromise: Promise<unknown>,
    local: typeof localforageT,
    nonlocal: typeof localforageT
}

type LocalforageCacheForage = typeof localforageT & {
    cacheForage: CacheForage
};

async function _initStorage(
    this: LocalforageCacheForage,
    options: any
) {
    this.cacheForage = {
        localPromise: Promise.all([]),
        nonlocalPromise: Promise.all([]),
        local: options.cacheForage.local,
        nonlocal: options.cacheForage.nonlocal
    };
}

async function iterate(
    this: LocalforageCacheForage,
    iteratorCallback: (key: string) => any,
    successCallback: () => unknown
) {
    const cf = this.cacheForage;

    const promise = cf.nonlocalPromise.then(async () => {
        await cf.local.iterate(iteratorCallback);
        await cf.nonlocal.iterate(iteratorCallback);
    });
    cf.nonlocalPromise = promise.catch(console.error);
    await promise;

    if (successCallback)
        successCallback();
}

async function getItem(
    this: LocalforageCacheForage,
    key: string, callback?: (value:any)=>unknown
) {
    const cf = this.cacheForage;
    const localPromise = cf.localPromise.then(() => {
        return cf.local.getItem(key);
    });
    cf.localPromise = localPromise.catch(console.error);
    let value = await localPromise;

    if (value === null) {
        // Not present in local, try nonlocal
        const promise = cf.nonlocalPromise.then(async () => {
            return await cf.nonlocal.getItem(key);
        });
        cf.nonlocalPromise = promise.catch(console.error);
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
    const cf = this.cacheForage;
    const localPromise = cf.localPromise.then(() =>  {
        return cf.local.setItem(key, value);
    });
    cf.localPromise = localPromise.catch(console.error);
    await localPromise;

    cf.nonlocalPromise = cf.nonlocalPromise.then(async () => {
        await cf.nonlocal.setItem(key, value);
        await cf.local.removeItem(key);
    }).catch(console.error);

    if (callback)
        callback();
}

async function removeItem(
    this: LocalforageCacheForage,
    key: string, callback?: ()=>unknown
) {
    const cf = this.cacheForage;

    const lp = cf.localPromise.then(() => {
        return cf.local.removeItem(key);
    });
    cf.localPromise = lp.catch(console.error);
    const nlp = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.removeItem(key);
    });
    cf.nonlocalPromise = nlp.catch(console.error);

    await lp;
    await nlp;

    if (callback)
        callback();
}

async function clear(
    this: LocalforageCacheForage,
    callback?: ()=>unknown
) {
    const cf = this.cacheForage;

    const lp = cf.localPromise.then(() => {
        return cf.local.clear();
    });
    cf.localPromise = lp.catch(console.error);
    const nlp = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.clear();
    });
    cf.nonlocalPromise = nlp.catch(console.error);

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
    const cf = this.cacheForage;
    const lkeysP = cf.localPromise.then(() => {
        return cf.local.keys();
    });
    cf.localPromise = lkeysP.catch(console.error);
    const nlkeysP = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.keys();
    });
    cf.nonlocalPromise = nlkeysP.catch(console.error);

    return (await lkeysP).concat(await nlkeysP);
}

async function dropInstance(
    this: LocalforageCacheForage,
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    const cf = this.cacheForage;
    const lp = cf.localPromise.then(() => {
        return cf.local.dropInstance(options);
    });
    cf.localPromise = lp.catch(console.error);
    const nlp = cf.nonlocalPromise.then(() => {
        return cf.nonlocal.dropInstance(options);
    });
    cf.nonlocalPromise = nlp.catch(console.error);

    await lp;
    await nlp;

    if (callback)
        callback();
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
    dropInstance
};
