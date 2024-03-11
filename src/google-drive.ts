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
    tokenClient: any;
    name: string;
    path: string;
    dirId: string;
}

type LocalforageGoogleDrive = typeof localforageT & {
    gd: GoogleDriveData
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
    await util.loadScript("https://apis.google.com/js/api.js");
    await new Promise(res => gapi.load('client', res));
    await gapi.client.init({
        apiKey: options.googleDrive.apiKey,
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });

    await util.loadScript("https://accounts.google.com/gsi/client");

    this.gd = <any> {};

    // Check if we already have a saved token
    let savedToken: string | null = null;
    if (options.localforage)
        savedToken = await options.localforage.getItem("google-drive-token");

    await new Promise<void>(async res => {
        this.gd.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: options.googleDrive.clientId,
            scope: "https://www.googleapis.com/auth/drive.file",
            callback: res
        });

        if (savedToken) {
            gapi.client.setToken(savedToken);

            // Check if the token is valid
            try {
                const files = await gapi.client.drive.files.list({
                    fields: "files(id)",
                    q: '"root" in parents and name = "expired-token-test"'
                });
            } catch (ex) {
                gapi.client.setToken(null);
            }
        }

        if (gapi.client.getToken() === null) {
            // Prompt the user to log in
            await options.googleDrive.requestLogin();
            this.gd.tokenClient.requestAccessToken({prompt: 'consent'});
        } else {
            res();
        }
    });

    if (options.localforage)
        await options.localforage.setItem("google-drive-token", gapi.client.getToken());

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
    this.gd.name = options.name || "default";
    this.gd.path = path;
    this.gd.dirId = curDir;
}

async function iterate(
    this: LocalforageGoogleDrive,
    iteratorCallback: (key: string) => any,
    successCallback?: () => unknown
) {
    const files = await fileList(this.gd.dirId);
    for (const file of files) {
        const value = await getItemById(file.id);
        const res = iteratorCallback(ser.unsafeify(file.name));
        if (res !== void 0)
            break;
    }

    if (successCallback)
        successCallback();
}

async function getItem(
    this: LocalforageGoogleDrive,
    key: string, callback?: (value: any)=>unknown
) {
    // Look for a connected file
    const files = await fileList(this.gd.dirId, ser.safeify(key));
    if (!files.length) {
        if (callback)
            callback(null);
        return null;
    }

    const value = await getItemById(files[0].id);
    if (callback)
        callback(value);
    return value;
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

async function setItem(
    this: LocalforageGoogleDrive,
    key: string, value: any, callback?: ()=>unknown
) {
    // Serialize
    const keySer = ser.safeify(key);
    const valSer = ser.serialize(value);

    // Create the file
    const accessToken = gapi.client.getToken().access_token;
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({
        parents: [this.gd.dirId],
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
    const files = await fileList(this.gd.dirId, keySer);
    for (const otherFile of files) {
        if (otherFile.id === file.id)
            continue;
        await gapi.client.drive.files.delete({
            fileId: otherFile.id
        });
    }

    if (callback)
        callback();
}

async function removeItem(
    this: LocalforageGoogleDrive,
    key: string, callback?: ()=>unknown
) {
    const files = await fileList(this.gd.dirId, ser.safeify(key));
    for (const file of files) {
        await gapi.client.drive.files.delete({
            fileId: file.id
        });
    }

    if (callback)
        callback();
}

async function clear(
    this: LocalforageGoogleDrive,
    callback?: ()=>unknown
) {
    await removeItem.call(this, "", callback);
}

async function length(
    this: LocalforageGoogleDrive,
    callback?: (len: number)=>unknown
) {
    const len = (await fileList(this.gd.dirId)).length;
    if (callback)
        callback(len);
    return len;
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

async function keys(
    this: LocalforageGoogleDrive,
    callback?: (keys: string[])=>unknown
) {
    const files = await fileList(this.gd.dirId);
    const keys = files.map(x => ser.unsafeify(x.name));
    if (callback)
        callback(keys);
    return keys;
}

async function dropInstance(
    this: LocalforageGoogleDrive,
    options?: {name?: string, storeName?: string},
    callback?: () => unknown
) {
    if (typeof options === "function") {
        // This API was made by clowns
        callback = <any> options;
        options = void 0;
    }

    // Figure out which directory to delete
    let toDelete: string = this.gd.dirId;
    const toDeleteDir = util.dropInstanceDirectory(this.gd.path, options);
    if (toDeleteDir !== this.gd.path) {
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
