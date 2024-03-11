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

export async function loadScript(src) {
    const scr = document.createElement("script");
    scr.src = src;
    document.body.appendChild(scr);
    return new Promise((res, rej) => {
        scr.onload = res;
        scr.onerror = rej;
    });
}

export function cloudDirectory(options: any) {
    let ret: string;
    if (options.nonlocalForage && options.nonlocalForage.directory)
        ret = options.nonlocalForage.directory;
    else
        ret = "nonlocalForage";
    ret += `/${options.name ? ser.safeify(options.name) : "default"}`;
    if (!options.nonlocalForage || !options.nonlocalForage.noStore) {
        ret += `/${options.storeName ? ser.safeify(options.storeName) : "default"}`;
    }
    return ret;
}

export function dropInstanceDirectory(
    cloudDir: string,
    options?: { name?: string, storeName?: string }
) {
    if (options) {
        let toDeleteDir: string | null = null;
        if (options.name) {
            if (options.storeName) {
                toDeleteDir = cloudDirectory(options);
            } else {
                toDeleteDir = cloudDirectory({
                    name: options.name,
                    nonlocalForage: {noStore: true}
                });
            }
        } else {
            if (options.storeName) {
                toDeleteDir = cloudDirectory({
                    name: cloudDir,
                    storeName: options.storeName
                });
            }
        }

        if (toDeleteDir)
            return toDeleteDir;
    }

    return cloudDir;
}
