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

import type * as dropboxT from "dropbox";
declare let Dropbox: typeof dropboxT;

import * as ser from "./serializer";
import * as util from "./util";

interface DropboxData {
    promise: Promise<unknown>;
    dbx: dropboxT.Dropbox;
    dir: string;
}

type LocalforageDropbox = typeof localforageT & {
    _dbx: DropboxData;
};

async function _initStorage(
    this: LocalforageDropbox,
    options: any
) {
    try {
        // Load the library
        if (typeof Dropbox === "undefined")
            await util.loadScript("https://cdn.jsdelivr.net/npm/dropbox@10.34.0");

        const url = new URL(document.location.href);
        const dbx = new Dropbox.Dropbox({clientId: options.dropbox.clientId});
        const auth: dropboxT.DropboxAuth = (<any> dbx).auth;

        // Get the authentication URL
        url.pathname = url.pathname.replace(/\/[^\/]*$/, "/oauth2-login.html");
        url.search = "";
        url.hash = "";
        const state = Math.random().toString(36) + Math.random().toString(36) +
            Math.random().toString(36);
        const aurl = await auth.getAuthenticationUrl(
            url.toString(), state, "code", "offline", void 0, "none", true
        );

        let accessTokenInfo: any = null;

        // Try using the saved code
        if (options.localforage &&
            (!options.nonlocalforage || !options.nonlocalforage.forcePrompt)) {
            try {
                const savedAT = await options.localforage.getItem("dropbox-access-token");
                const savedRT = await options.localforage.getItem("dropbox-refresh-token");
                if (savedAT && savedRT) {
                    auth.setAccessToken(savedAT);
                    auth.setRefreshToken(savedRT);

                    // Check if it works
                    await dbx.filesListFolder({path: ""});

                    accessTokenInfo = {
                        result: {
                            access_token: savedAT,
                            refresh_token: savedRT,
                            expires_in: 0
                        }
                    };
                }
            } catch (ex) {}
        }

        // If we didn't authenticate, get a new code
        if (!accessTokenInfo) {
            await options.nonlocalforage.transientActivation();

            // Open an authentication iframe
            const authWin = window.open(
                url.toString(), "", "popup,width=480,height=640"
            )!;
            await new Promise((res, rej) => {
                authWin.onload = res;
                authWin.onerror = rej;
                authWin.onclose = rej;
            });
            authWin.postMessage({
                dropbox: true,
                authUrl: aurl
            });

            // Wait for the access token
            const code: string = await new Promise((res, rej) => {
                function onmessage(ev: MessageEvent) {
                    if (ev.data && ev.data.oauth2 && ev.data.state === state) {
                        removeEventListener("message", onmessage);
                        res(ev.data.code);
                    }
                }

                addEventListener("message", onmessage);
                authWin.onclose = rej;
            });

            authWin.onclose = null;
            authWin.close();

            accessTokenInfo = await auth.getAccessTokenFromCode(
                url.toString(), code
            );
            auth.setAccessToken(accessTokenInfo.result.access_token);
            auth.setRefreshToken(accessTokenInfo.result.refresh_token);

            if (options.localforage) {
                await options.localforage.setItem("dropbox-access-token", accessTokenInfo.result.access_token);
                await options.localforage.setItem("dropbox-refresh-token", accessTokenInfo.result.refresh_token);
            }
        }

        // Create the store path
        const path = util.cloudDirectory(options);
        let curDir = "";
        for (const part of path.split("/")) {
            const files = await dbx.filesListFolder({path: curDir});
            // Check if it already exists
            let exists = false;
            for (const file of files.result.entries) {
                if (file[".tag"] === "folder" && file.name === part) {
                    exists = true;
                    break;
                }
            }
            curDir = `${curDir}/${part}`;
            if (!exists) {
                await dbx.filesCreateFolderV2({
                    path: curDir
                });
            }
        }

        this._dbx = {
            promise: Promise.all([]),
            dbx, dir: curDir
        };

        // And prepare for token refresh
        const refreshToken = () => {
            this._dbx.promise = this._dbx.promise.catch(console.error).then(async () => {
                await auth.refreshAccessToken();
                setTimeout(
                    refreshToken,
                    auth.getAccessTokenExpiresAt().getTime() - new Date().getTime() - 600000
                );
            });
        };
        setTimeout(refreshToken, (accessTokenInfo.expires_in - 600) * 1000);

    } catch (ex: any) {
        console.error(`${ex}\n${ex.stack}`);
        throw ex;

    }
}

function iterate(
    this: LocalforageDropbox,
    iteratorCallback: (key: string) => any,
    successCallback: () => unknown
) {
    const p = this._dbx.promise.catch(console.error).then(async () => {
        const dbx = <dropboxT.Dropbox> this._dbx.dbx;
        const files = await dbx.filesListFolder({
            path: this._dbx.dir
        });
        for (const file of files.result.entries)
            iteratorCallback(ser.unsafeify(file.name));
        if (successCallback)
            successCallback();
    });
    this._dbx.promise = p;
    return p;
}

function getItem(
    this: LocalforageDropbox,
    key: string, callback?: (value: any)=>unknown
) {
    const p = this._dbx.promise.catch(console.error).then(async () => {
        const dbx = <dropboxT.Dropbox> this._dbx.dbx;

        // Try to download the file
        let value: any = null;
        try {
            const dl = await dbx.filesDownload({
                path: `${this._dbx.dir}/${ser.safeify(key)}`
            });
            const fileBlob = <Blob> (<any> dl).result.fileBlob;
            const fileU8 = new Uint8Array(await fileBlob.arrayBuffer());
            value = ser.deserialize(fileU8);
        } catch (ex) {}

        if (callback)
            callback(value);

        return value;
    });
    this._dbx.promise = p;
    return p;
}

function setItem(
    this: LocalforageDropbox,
    key: string, value: any, callback?: ()=>unknown
) {
    const p = this._dbx.promise.catch(console.error).then(async () => {
        // Serialize the value
        const valSer = ser.serialize(value);

        // Create the file
        const dbx = <dropboxT.Dropbox> this._dbx.dbx;
        await dbx.filesUpload({
            path: `${this._dbx.dir}/${ser.safeify(key)}`,
            contents: valSer,
            mode: {
                ".tag": "overwrite"
            }
        });

        if (callback)
            callback();
    });
    this._dbx.promise = p;
    return p;
}

function removeItem(
    this: LocalforageDropbox,
    key: string, callback?: ()=>unknown
) {
    const p = this._dbx.promise.catch(console.error).then(async () => {
        const dbx = <dropboxT.Dropbox> this._dbx.dbx;
        await dbx.filesDeleteV2({
            path: `${this._dbx.dir}/${ser.safeify(key)}`
        });
        if (callback)
            callback();
    });
    this._dbx.promise = p;
    return p;
}

function clear(
    this: LocalforageDropbox,
    callback?: ()=>unknown
) {
    const p = this._dbx.promise.catch(console.error).then(async () => {
        const dbx = <dropboxT.Dropbox> this._dbx.dbx;
        await dbx.filesDeleteV2({
            path: this._dbx.dir
        });
        await dbx.filesCreateFolderV2({
            path: this._dbx.dir
        });
        if (callback)
            callback();
    });
    this._dbx.promise = p;
    return p;
}

function length(
    this: LocalforageDropbox,
    callback?: (len: number)=>unknown
) {
    const p = this._dbx.promise.catch(console.error).then(async () => {
        const dbx = <dropboxT.Dropbox> this._dbx.dbx;
        const files = await dbx.filesListFolder({
            path: this._dbx.dir
        });
        if (callback)
            callback(files.result.entries.length);
        return files.result.entries.length;
    });
    this._dbx.promise = p;
    return p;
}

async function key(
    this: LocalforageDropbox,
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
    this: LocalforageDropbox,
    callback?: (keys: string[])=>unknown
) {
    const p = this._dbx.promise.catch(console.error).then(async () => {
        const dbx = <dropboxT.Dropbox> this._dbx.dbx;
        const files = await dbx.filesListFolder({
            path: this._dbx.dir
        });
        const keys = files.result.entries.map(x => ser.unsafeify(x.name));
        if (callback)
            callback(keys);
        return keys;
    });
    this._dbx.promise = p;
    return p;
}

function dropInstance(
    this: LocalforageDropbox,
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    if (typeof options === "function") {
        // This API was made by clowns
        callback = <any> options;
        options = void 0;
    }

    const p = this._dbx.promise.catch(console.error).then(async () => {
        // Figure out which directory to delete
        const toDelete = util.dropInstanceDirectory(this._dbx.dir, options);

        const dbx = <dropboxT.Dropbox> this._dbx.dbx;
        await dbx.filesDeleteV2({
            path: toDelete
        });

        if (callback)
            callback();
    });
    this._dbx.promise = p;
    return p;
}

export const dropboxLocalForage = {
    _driver: "dropbox",
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
