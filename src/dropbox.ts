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
import * as bgoauth2 from "@badgateway/oauth2-client";

import type * as dropboxT from "dropbox";
declare let Dropbox: typeof dropboxT;

import * as oauth2 from "./oauth2";
import * as nlfOptions from "./nlf-options";
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
        const nlfOpts: nlfOptions.NonlocalforageOptions = options.nonlocalforage;

        // Load the library
        if (typeof Dropbox === "undefined")
            await util.loadScript("https://cdn.jsdelivr.net/npm/dropbox@10.34.0");

        const dbx = new Dropbox.Dropbox({clientId: options.dropbox.clientId});
        const auth: dropboxT.DropboxAuth = (<any> dbx).auth;

        // Get the authentication URL
        const oauth2Client = new bgoauth2.OAuth2Client({
            clientId: options.dropbox.clientId,
            server: "https://www.dropbox.com/",
            discoveryEndpoint: "/.well-known/openid-configuration"
        });
        const codeVerifier = await bgoauth2.generateCodeVerifier();
        const state = Math.random().toString(36) + Math.random().toString(36) +
            Math.random().toString(36);
        const authUrl = await oauth2Client.authorizationCode.getAuthorizeUri({
            redirectUri: oauth2.redirectUrl.toString(),
            state,
            codeVerifier,
            scope: [
                "account_info.read",
                "files.metadata.read",
                "files.metadata.write",
                "files.content.read",
                "files.content.write"
            ],
            extraParams: {
                token_access_type: "offline"
            }
        });

        let tokenInfo: bgoauth2.OAuth2Token | null = null;

        // Try using the saved code
        if (options.localforage && !nlfOpts.forcePrompt) {
            try {
                const savedAT = await options.localforage.getItem("dropbox-access-token");
                const savedRT = await options.localforage.getItem("dropbox-refresh-token");
                if (savedAT && savedRT) {
                    tokenInfo = await oauth2Client.refreshToken({
                        accessToken: savedAT,
                        refreshToken: savedRT,
                        expiresAt: new Date().getTime()
                    });
                    auth.setAccessToken(tokenInfo.accessToken);
                    auth.setRefreshToken(tokenInfo.refreshToken!);

                    // Check if it works
                    await dbx.filesListFolder({path: ""});

                    await options.localforage.setItem("dropbox-access-token", tokenInfo.accessToken);
                    await options.localforage.setItem("dropbox-refresh-token", tokenInfo.refreshToken!);
                }
            } catch (ex) {
                tokenInfo = null;
            }
        }

        // If we didn't authenticate, get a new code
        if (!tokenInfo) {
            await nlfOpts.transientActivation();

            // Wait for the access token
            const codeInfo = await oauth2.authWin(nlfOpts, authUrl, state);

            tokenInfo = await oauth2Client.authorizationCode.getToken({
                redirectUri: oauth2.redirectUrl.toString(),
                state,
                code: codeInfo.code,
                codeVerifier
            });
            auth.setAccessToken(tokenInfo.accessToken);
            auth.setRefreshToken(tokenInfo.refreshToken!);

            if (options.localforage) {
                await options.localforage.setItem("dropbox-access-token", tokenInfo.accessToken);
                await options.localforage.setItem("dropbox-refresh-token", tokenInfo.refreshToken!);
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
        const refresh = () => {
            this._dbx.promise = this._dbx.promise.catch(console.error).then(async () => {
                const refreshToken = tokenInfo!.refreshToken;
                tokenInfo = await oauth2Client.refreshToken(tokenInfo!);
                tokenInfo.refreshToken = tokenInfo.refreshToken || refreshToken;
                if (options.localforage) {
                    options.localforage.setItem("dropbox-access-token", tokenInfo.accessToken);
                    options.localforage.setItem("dropbox-refresh-token", tokenInfo.refreshToken!);
                }
                console.log(tokenInfo);
                setTimeout(
                    refresh,
                    tokenInfo.expiresAt! - new Date().getTime() - 600000
                );
            });
        };
        setTimeout(refresh, tokenInfo.expiresAt! - new Date().getTime() - 600000);

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
