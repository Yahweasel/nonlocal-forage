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

import * as ser from "./serializer";
import * as util from "./util";

// Why aren't these types in TypeScript???
declare let gapi: any, google: any;

const dirMime = "application/vnd.google-apps.folder";

interface GoogleDriveData {
    promise: Promise<unknown>;
    tokenClient: any;
    tokenClientCallback: (x: any) => void;
    tokenClientError: (x: any) => void;
    name: string;
    path: string;
    dirId: string;
}

type LocalforageGoogleDrive = typeof localforageT & {
    _gd: GoogleDriveData
};

async function fileList(dir = "root", name = "") {
    let files: any[] = [];
    let nextPageToken: string | undefined = void 0;
    while (true) {
        try {
            const resp: any = await gapi.client.drive.files.list({
                pageToken: nextPageToken,
                fields: "files(id, name, mimeType), nextPageToken",
                q: (`${JSON.stringify(dir)} in parents` +
                    (name
                        ? ` and name = ${JSON.stringify(name)}`
                        : ""
                    )
                   )
            });
            files = files.concat(resp.result.files);
            nextPageToken = resp.result.nextPageToken;
            if (!nextPageToken)
                break;
        } catch (ex) {
            // FIXME: Distinguish file-not-found from real errors
            break;
        }
    }
    return files;
}

async function _initStorage(
    this: LocalforageGoogleDrive,
    options: any
) {
    // Load libraries
    if (typeof gapi === "undefined")
        await util.loadScript("https://apis.google.com/js/api.js");
    await new Promise(res => gapi.load("client", res));
    await gapi.client.init({
        apiKey: options.googleDrive.apiKey,
        discoveryDocs: [
            "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
            "https://www.googleapis.com/discovery/v1/apis/oauth2/v1/rest"
        ],
    });

    if (typeof google === "undefined" || !google.accounts)
        await util.loadScript("https://accounts.google.com/gsi/client");

    this._gd = <any> {};

    // Load saved account info
    let login_hint: string | undefined;
    if (options.localforage)
        login_hint = await options.localforage.getItem("google-drive-login") || void 0;

    // Create the token client
    this._gd.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: options.googleDrive.clientId,
        scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
        prompt: (options.nonlocalforage && options.nonlocalforage.forcePrompt)
            ? "select_account" : "",
        login_hint: (options.nonlocalforage && options.nonlocalforage.forcePrompt)
            ? void 0 : login_hint,
        callback: (x: any) => this._gd.tokenClientCallback(x),
        error_callback: (x: any) => this._gd.tokenClientError(x)
    });

    async function requestAccessToken(gd: GoogleDriveData, extra?: any) {
        return await new Promise((res, rej) => {
            gd.tokenClientCallback = res;
            gd.tokenClientError = rej;
            gd.tokenClient.requestAccessToken(extra);
        });
    }

    // Attempt to log in without transient activation
    let loginInfo: any;
    try {
        loginInfo = await requestAccessToken(this._gd);
    } catch (ex) {
        // OK, try with transient activation
        await options.nonlocalforage.transientActivation();
        loginInfo = await requestAccessToken(this._gd);
    }

    // Save login hint
    const userInfo = await gapi.client.oauth2.userinfo.get();
    if (options.localforage) {
        await options.localforage.setItem("google-drive-login", userInfo.result.email);
    }

    // Prepare serialization promise
    this._gd.promise = Promise.all([]);

    // Handle timeout
    const timeoutRelogin = async () => {
        this._gd.promise = this._gd.promise.catch(console.error).then(async () => {
            try {
                loginInfo = await requestAccessToken(this._gd, {
                    prompt: "none",
                    login_hint: userInfo.result.email
                });
            } catch (ex) {
                await (
                    options.nonlocalforage.lateTransientActivation ||
                        options.nonlocalforage.transientActivation
                )();
                loginInfo = await requestAccessToken(this._gd, {
                    prompt: "none",
                    login_hint: userInfo.result.email
                });
            }
            setTimeout(timeoutRelogin, (loginInfo.expires_in - 600) * 1000);
        });
    };
    setTimeout(timeoutRelogin, (loginInfo.expires_in - 600) * 1000);

    // Create the store path
    const path = util.cloudDirectory(options);
    let curDir = "root";
    for (const part of path.split("/")) {
        const files = await fileList(curDir, part);
        let nextDir: string | null =
            files.length ? files[0].id : null;

        if (!nextDir) {
            // Didn't find the directory, so create it
            const resp = await gapi.client.drive.files.create({
                name: part,
                parents: [curDir],
                mimeType: dirMime
            });
            nextDir = resp.result.id;
        }

        curDir = nextDir!;
    }
    this._gd.name = options.name || "default";
    this._gd.path = path;
    this._gd.dirId = curDir;
}

function iterate(
    this: LocalforageGoogleDrive,
    iteratorCallback: (key: string) => any,
    successCallback?: () => unknown
) {
    const p = this._gd.promise.catch(console.error).then(async () => {
        const files = await fileList(this._gd.dirId);
        for (const file of files) {
            const value = await getItemById(file.id);
            const res = iteratorCallback(ser.unsafeify(file.name));
            if (res !== void 0)
                break;
        }

        if (successCallback)
            successCallback();
    });
    this._gd.promise = p;
    return p;
}

function getItem(
    this: LocalforageGoogleDrive,
    key: string, callback?: (value: any)=>unknown
) {
    const p = this._gd.promise.catch(console.error).then(async () => {
        // Look for a connected file
        const files = await fileList(this._gd.dirId, ser.safeify(key));
        if (!files.length) {
            if (callback)
                callback(null);
            return null;
        }

        const value = await getItemById(files[0].id);
        if (callback)
            callback(value);
        return value;
    });
    this._gd.promise = p;
    return p;
}

async function getItemById(id: string) {
    // Read its content
    const resp = await gapi.client.drive.files.get({
        fileId: id,
        alt: "media"
    });

    /* The body is in pseudo-binary: each octet is one *Unicode* character, so
     * we need to make a Uint8Array with the right length, then extract by char
     * code. */
    const body = new Uint8Array(
        Array.from(<string> resp.body).map(x => x.charCodeAt(0))
    );
    return await ser.deserialize(body);
}

function setItem(
    this: LocalforageGoogleDrive,
    key: string, value: any, callback?: ()=>unknown
) {
    const p = this._gd.promise.catch(console.error).then(async () => {
        // Serialize
        const keySer = ser.safeify(key);
        const valSer = ser.serialize(value);

        // Create the file
        const accessToken = gapi.client.getToken().access_token;
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify({
            parents: [this._gd.dirId],
            name: keySer
        })], { type: "application/json" }));
        form.append("file", new Blob([valSer]));
        const fres = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
            method: "POST",
            headers: { "authorization": `Bearer ${accessToken}` },
            body: form
        });
        if (fres.status < 200 || fres.status >= 300)
            throw new Error(await fres.text());
        const file = await fres.json();

        // Look for any other instances
        const files = await fileList(this._gd.dirId, keySer);
        for (const otherFile of files) {
            if (otherFile.id === file.id)
                continue;
            await gapi.client.drive.files.delete({
                fileId: otherFile.id
            });
        }

        if (callback)
            callback();
    });
    this._gd.promise = p;
    return p;
}

function removeItem(
    this: LocalforageGoogleDrive,
    key: string, callback?: ()=>unknown
) {
    const p = this._gd.promise.catch(console.error).then(async () => {
        const files = await fileList(this._gd.dirId, ser.safeify(key));
        for (const file of files) {
            await gapi.client.drive.files.delete({
                fileId: file.id
            });
        }

        if (callback)
            callback();
    });
    this._gd.promise = p;
    return p;
}

async function clear(
    this: LocalforageGoogleDrive,
    callback?: ()=>unknown
) {
    await removeItem.call(this, "", callback);
}

function length(
    this: LocalforageGoogleDrive,
    callback?: (len: number)=>unknown
) {
    const p = this._gd.promise.catch(console.error).then(async () => {
        const len = (await fileList(this._gd.dirId)).length;
        if (callback)
            callback(len);
        return len;
    });
    this._gd.promise = p;
    return p;
}

async function key(
    this: LocalforageGoogleDrive,
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
    this: LocalforageGoogleDrive,
    callback?: (keys: string[])=>unknown
) {
    const p = this._gd.promise.catch(console.error).then(async () => {
        const files = await fileList(this._gd.dirId);
        const keys = files.map(x => ser.unsafeify(x.name));
        if (callback)
            callback(keys);
        return keys;
    });
    this._gd.promise = p;
    return p;
}

function dropInstance(
    this: LocalforageGoogleDrive,
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    if (typeof options === "function") {
        // This API was made by clowns
        callback = <any> options;
        options = void 0;
    }

    const p = this._gd.promise.catch(console.error).then(async () => {
        // Figure out which directory to delete
        let toDelete: string = this._gd.dirId;
        const toDeleteDir = util.dropInstanceDirectory(this._gd.path, options);
        if (toDeleteDir !== this._gd.path) {
            const parts = toDeleteDir.split("/");
            let curDir = "root";
            for (const part of parts) {
                const files = await fileList(curDir, part);
                if (!files.length) {
                    // Doesn't exist, don't delete it!
                    if (callback)
                        callback();
                    return;
                }
                curDir = files[0].id;
            }
            toDelete = curDir;
        }

        // Delete as requested
        await gapi.client.drive.files.delete({
            fileId: toDelete
        });

        if (callback)
            callback();
    });
    this._gd.promise = p;
    return p;
}

export const googleDriveLocalForage = {
    _driver: "googleDrive",
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
