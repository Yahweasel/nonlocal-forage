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

import * as nlfOptions from "./nlf-options";

export const redirectUrl = new URL(document.location.href);
redirectUrl.pathname = redirectUrl.pathname.replace(/\/[^\/]*$/, "/oauth2-login.html");
redirectUrl.search = "";
redirectUrl.hash = "";

export async function authWin(
    nlfOpts: nlfOptions.NonlocalforageOptions, authUrl: string, state: string
): Promise<any> {
    // Open an authentication window
    const authWin = window.open(
        redirectUrl.toString(), "", "popup,width=480,height=640"
    )!;
    await new Promise((res, rej) => {
        authWin.onload = res;
        authWin.onerror = rej;
        authWin.onclose = rej;
    });
    authWin.postMessage({
        oauth2: true,
        authUrl
    });

    // Wait for the info
    const infoPromise = new Promise((res, rej) => {
        function onstorage(ev: StorageEvent) {
            if (ev.key === `oauth2-nonlocal-forage-${state}`) {
                removeEventListener("storage", onstorage);
                const data = ev.storageArea!.getItem(ev.key);
                ev.storageArea!.removeItem(ev.key);
                res(JSON.parse(data!));
            }
        }

        addEventListener("storage", onstorage);
        authWin.onclose = () => {
            removeEventListener("storage", onstorage);
            rej();
        };
    });

    // Make it cancellable if applicable
    if (nlfOpts.cancellable) {
        const cancelPromise = nlfOpts.cancellable();
        const cancelled = await Promise.race([
            infoPromise.then(() => false),
            cancelPromise.then(() => true)
        ]);
        if (nlfOpts.hideCancellable)
            nlfOpts.hideCancellable();
        if (cancelled)
            throw new Error("Cancelled");
    }

    const info = await infoPromise;

    try {
        authWin.onclose = null;
    } catch (ex) {}

    return info;
}
