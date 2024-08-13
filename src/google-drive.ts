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
import * as bgoauth2 from "@badgateway/oauth2-client";

import * as oauth2 from "./oauth2";
import * as nlfOptions from "./nlf-options";
import * as ser from "./serializer";
import * as util from "./util";

// Why aren't these types in TypeScript???
declare let gapi: any, google: any;

const dirMime = "application/vnd.google-apps.folder";

// Global Google Drive data
let promise: Promise<unknown> = Promise.all([]);
let loggedIn = false;

export interface GoogleDriveData {
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

async function logIn(options: any) {
    const scope = [
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/userinfo.email"
    ];

    // Load the login hint
    let loginHint: string | null = null;
    if (options.localforage)
        loginHint = await options.localforage.getItem("google-drive-login");

    // General info
    const nlfOpts: nlfOptions.NonlocalforageOptions = options.nonlocalforage;
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    let expiresAt: number | null = null;
    let tokenAuthUrl: URL | null = null;

    // Choose login method
    if (options.googleDrive.codeServer) {
        // Use the code method
        const authUrl = tokenAuthUrl = new URL(
            options.googleDrive.codeServer, document.location.href
        );
        const oauth2Client = new bgoauth2.OAuth2Client({
            clientId: options.googleDrive.clientId,
            server: "https://accounts.google.com",
            discoveryEndpoint: "/.well-known/openid-configuration"
        });

        // Try using a saved token
        if (options.localforage && !nlfOpts.forcePrompt)
            refreshToken = await options.localforage.getItem("google-drive-refresh-token");
        if (refreshToken) {
            try {
                authUrl.searchParams.set("refreshToken", refreshToken);
                const f = await fetch(authUrl.toString());
                const tokenInfo = await f.json();
                accessToken = tokenInfo.access_token;
                expiresAt = new Date().getTime() + tokenInfo.expires_in * 1000;
            } catch (ex) {
                accessToken = refreshToken = null;
            }
        }

        if (!accessToken || !refreshToken) {
            // Do the initial login
            const state = Math.random().toString(36) + Math.random().toString(36) +
                Math.random().toString(36);
            const authUrl = await oauth2Client.authorizationCode.getAuthorizeUri({
                redirectUri: oauth2.redirectUrl.toString(),
                state,
                scope,
                extraParams: {
                    // BOTH are needed to ensure a refresh token is given
                    access_type: "offline",
                    prompt: "consent"
                }
            });

            await nlfOpts.transientActivation();
            const code = (await oauth2.authWin(nlfOpts, authUrl, state)).code;

            // Trade it for an access token and refresh token
            const codeUrl = new URL(
                options.googleDrive.codeServer, document.location.href
            );
            codeUrl.searchParams.set("code", code);
            codeUrl.searchParams.set("redirectUri", oauth2.redirectUrl.toString());
            const f = await fetch(codeUrl.toString());
            const tokenInfo = await f.json();
            accessToken = tokenInfo.access_token;
            refreshToken = tokenInfo.refresh_token;
            expiresAt = new Date().getTime() + tokenInfo.expires_in * 1000;
            tokenAuthUrl.searchParams.set("refreshToken", refreshToken!);
        }

        // Save it
        if (options.localforage)
            await options.localforage.setItem("google-drive-refresh-token", refreshToken);

    } else {
        // Use the implicit grant system
        const state = Math.random().toString(36) + Math.random().toString(36) +
            Math.random().toString(36);
        const authUrl = tokenAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", options.googleDrive.clientId);
        authUrl.searchParams.set("redirect_uri", oauth2.redirectUrl.toString());
        authUrl.searchParams.set("response_type", "token");
        authUrl.searchParams.set("scope", scope.join(" "));
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("include_granted_scopes", "true");
        if (loginHint && !nlfOpts.forcePrompt)
            authUrl.searchParams.set("login_hint", loginHint);
        else
            authUrl.searchParams.set("prompt", "select_account");

        await nlfOpts.transientActivation();
        const tokenInfo = await oauth2.authWin(nlfOpts, authUrl.toString(), state);
        accessToken = tokenInfo.accessToken;
        expiresAt = new Date().getTime() + (+tokenInfo.expiresIn) * 1000;

    }

    gapi.client.setToken({access_token: accessToken});

    // Save login hint
    const userInfo = await gapi.client.oauth2.userinfo.get();
    if (options.localforage)
        await options.localforage.setItem("google-drive-login", userInfo.result.email);

    // Handle timeout
    const timeoutRelogin = async () => {
        promise = promise.catch(console.error).then(async () => {
            if (options.googleDrive.codeServer) {
                // Just refresh the existing code
                const f = await fetch(tokenAuthUrl!.toString());
                const tokenInfo = await f.json();
                accessToken = tokenInfo.access_token;
                expiresAt = new Date().getTime() + tokenInfo.expires_in * 1000;

            } else {
                let tokenInfo: any;

                const state = Math.random().toString(36) +
                    Math.random().toString(36) + Math.random().toString(36);
                tokenAuthUrl!.searchParams.set("state", state);
                tokenAuthUrl!.searchParams.set("prompt", "none");
                tokenAuthUrl!.searchParams.set("login_hint", userInfo.result.email);

                try {
                    tokenInfo = await oauth2.authWin(nlfOpts, tokenAuthUrl!.toString(), state);
                } catch (ex) {
                    await (nlfOpts.lateTransientActivation ||
                           nlfOpts.transientActivation)();
                    tokenInfo = await oauth2.authWin(nlfOpts, tokenAuthUrl!.toString(), state);
                }

                accessToken = tokenInfo.accessToken;
                expiresAt = new Date().getTime() + (+tokenInfo.expiresIn) * 1000;

            }
            setTimeout(timeoutRelogin, expiresAt! - new Date().getTime() - 600000);
        });
    };
    setTimeout(timeoutRelogin, expiresAt! - new Date().getTime() - 600000);
}

async function _initStorage(
    this: LocalforageGoogleDrive,
    options: any
) {
    // Load libraries
    if (typeof gapi === "undefined")
        await util.loadScript("https://apis.google.com/js/api.js");
    if (!gapi.client)
        await new Promise(res => gapi.load("client", res));
    if (!gapi.client.drive || !gapi.client.oauth2) {
        await gapi.client.init({
            apiKey: options.googleDrive.apiKey,
            discoveryDocs: [
                "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
                "https://www.googleapis.com/discovery/v1/apis/oauth2/v1/rest"
            ]
        });
    }

    this._gd = <any> {};

    if (!loggedIn) {
        loggedIn = true;
        try {
            await logIn(options);
        } catch (ex) {
            loggedIn = false;
            throw ex;
        }
    }

    // Create the store path
    const path = util.cloudDirectory(options);
    let curDir = "root";
    const p = promise.catch(console.error).then(async () => {
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
    });
    promise = p;
    await p;
    this._gd.path = path;
    this._gd.dirId = curDir;
}

function iterate(
    this: LocalforageGoogleDrive,
    iteratorCallback: (key: string) => any,
    successCallback?: () => unknown
) {
    const p = promise.catch(console.error).then(async () => {
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
    promise = p;
    return p;
}

function getItem(
    this: LocalforageGoogleDrive,
    key: string, callback?: (value: any)=>unknown
) {
    const p = promise.catch(console.error).then(async () => {
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
    promise = p;
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
    const p = promise.catch(console.error).then(async () => {
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
    promise = p;
    return p;
}

function removeItem(
    this: LocalforageGoogleDrive,
    key: string, callback?: ()=>unknown
) {
    const p = promise.catch(console.error).then(async () => {
        const files = await fileList(this._gd.dirId, ser.safeify(key));
        for (const file of files) {
            await gapi.client.drive.files.delete({
                fileId: file.id
            });
        }

        if (callback)
            callback();
    });
    promise = p;
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
    const p = promise.catch(console.error).then(async () => {
        const len = (await fileList(this._gd.dirId)).length;
        if (callback)
            callback(len);
        return len;
    });
    promise = p;
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
    const p = promise.catch(console.error).then(async () => {
        const files = await fileList(this._gd.dirId);
        const keys = files.map(x => ser.unsafeify(x.name));
        if (callback)
            callback(keys);
        return keys;
    });
    promise = p;
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

    const p = promise.catch(console.error).then(async () => {
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
    promise = p;
    return p;
}

function storageEstimate(this: LocalforageGoogleDrive) {
    const p = promise.catch(console.error).then(async () => {
        const about = await gapi.client.drive.about.get({
            fields: "storageQuota"
        });
        return {
            quota: +about.result.storageQuota.limit || 1/0,
            usage: +about.result.storageQuota.usage
        };
    });
    promise = p;
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
    dropInstance,
    storageEstimate
};
