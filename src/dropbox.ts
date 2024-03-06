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

import * as dropbox from "dropbox";

import * as ser from "./serializer";
import * as util from "./util";

async function _initStorage(options: any) {
    // Check for an access token in the URL
    const url = new URL(document.location.href);
    let dbx: dropbox.Dropbox | null = null;
    let hashParams: URLSearchParams | null = null;
    try {
        hashParams = new URLSearchParams(url.hash.slice(1));
    } catch (ex) {}

    let savedToken: string | null = null;
    if (options.localforage)
        savedToken = await options.localforage.getItem("dropbox-token");

    if (savedToken) {
        // Try to use the existing token
        dbx = new dropbox.Dropbox({accessToken: savedToken});

        // Check if the token works
        try {
            await dbx.filesListFolder({
                path: ""
            });
        } catch (ex) {
            dbx = null;
        }
    }

    if (!dbx) {
        dbx = new dropbox.Dropbox({clientId: options.dropbox.clientId});

        // Need to authenticate
        url.pathname = url.pathname.replace(/\/[^\/]*$/, "/dropbox-login.html");
        url.search = "";
        url.hash = "";
        const aurl = await (<any> dbx).auth.getAuthenticationUrl(url.toString());

        await options.dropbox.requestLogin();

        // Open an authentication iframe
        const authWin = window.open(url.toString(), "", "popup");
        await new Promise(res => {
            authWin.onload = res;
        });
        authWin.postMessage({
            dropbox: true,
            authUrl: aurl
        });

        // Wait for the access token
        const accessToken: string = await new Promise(res => {
            function onmessage(ev: MessageEvent) {
                if (ev.data && ev.data.dropbox && ev.data.accessToken) {
                    removeEventListener("message", onmessage);
                    res(ev.data.accessToken);
                }
            }

            addEventListener("message", onmessage);
        });

        authWin.close();

        dbx = new dropbox.Dropbox({accessToken});
        if (options.localforage)
            await options.localforage.setItem("dropbox-token", accessToken);
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
    this.dbx = dbx;
    this.dbxDir = curDir;
}

async function iterate(
    iteratorCallback: (key: string) => any,
    successCallback: () => unknown
) {
    const dbx = <dropbox.Dropbox> this.dbx;
    const files = await dbx.filesListFolder({
        path: this.dbxDir
    });
    for (const file of files.result.entries)
        iteratorCallback(file.name);
    if (successCallback)
        successCallback();
}

async function getItem(key: string, callback?: (value: any)=>unknown) {
    const dbx = <dropbox.Dropbox> this.dbx;

    // Try to download the file
    let value: any = null;
    try {
        const dl = await dbx.filesDownload({
            path: `${this.dbxDir}/${key}`
        });
        const fileBlob = <Blob> (<any> dl).result.fileBlob;
        const fileU8 = new Uint8Array(await fileBlob.arrayBuffer());
        value = ser.deserialize(fileU8);
    } catch (ex) {}

    if (callback)
        callback(value);

    return value;
}

async function setItem(key: string, value: any, callback?: ()=>unknown) {
    // Serialize the value
    const valSer = ser.serialize(value);

    // Create the file
    const dbx = <dropbox.Dropbox> this.dbx;
    await dbx.filesUpload({
        path: `${this.dbxDir}/${key}`,
        contents: valSer,
        mode: {
            ".tag": "overwrite"
        }
    });

    if (callback)
        callback();
}

async function removeItem(key: string, callback?: ()=>unknown) {
    const dbx = <dropbox.Dropbox> this.dbx;
    await dbx.filesDeleteV2({
        path: `${this.dbxDir}/${key}`
    });
    if (callback)
        callback();
}

async function clear(callback?: ()=>unknown) {
    const dbx = <dropbox.Dropbox> this.dbx;
    await dbx.filesDeleteV2({
        path: this.dbxDir
    });
    await dbx.filesCreateFolderV2({
        path: this.dbxDir
    });
    if (callback)
        callback();
}

async function length(callback?: (len: number)=>unknown) {
    const dbx = <dropbox.Dropbox> this.dbx;
    const files = await dbx.filesListFolder({
        path: this.dbxDir
    });
    if (callback)
        callback(files.result.entries.length);
    return files.result.entries.length;
}

async function key(index: number, callback?: (key: string)=>unknown) {
    const key = (await keys.call(this))[index];
    if (key) {
        if (callback)
            callback(key);
        return key;
    }
    throw new Error("Key does not exist");
}

async function keys(callback?: (keys: string[])=>unknown) {
    const dbx = <dropbox.Dropbox> this.dbx;
    const files = await dbx.filesListFolder({
        path: this.dbxDir
    });
    const keys = files.result.entries.map(x => x.name);
    if (callback)
        callback(keys);
    return keys;
}

async function dropInstance(
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    if (typeof options === "function") {
        // This API was made by clowns
        callback = <any> options;
        options = void 0;
    }

    // Figure out which directory to delete
    const toDelete = util.dropInstanceDirectory(this.dbxDir, options);

    const dbx = <dropbox.Dropbox> this.dbx;
    await dbx.filesDeleteV2({
        path: toDelete
    });

    if (callback)
        callback();
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
