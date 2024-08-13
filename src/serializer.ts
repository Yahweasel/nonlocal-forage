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

interface Descriptor {
    type: "JSON" | "TypedArray" | "ArrayBuffer",
    taType?: string,
    data?: any
}

/**
 * Serialize this data into binary data as a Uint8Array. data may be an
 * ArrayBuffer view, or anything JSON serializable.
 * @param data  Data to serialize.
 */
export function serialize(data: any) {
    let desc: Descriptor = {type: "JSON"}; 
    let post: Uint8Array | null = null;

    // Serialize TypedArrays
    if (data && data.buffer && data.buffer instanceof ArrayBuffer) {
        desc.type = "TypedArray";
        if (data instanceof Uint8Array) {
            desc.taType = "Uint8Array";
        } else if (data instanceof Uint8ClampedArray) {
            desc.taType = "Uint8ClampedArray";
        } else if (data instanceof Int16Array) {
            desc.taType = "Int16Array";
        } else if (data instanceof Uint16Array) {
            desc.taType = "Uint16Array";
        } else if (data instanceof Int32Array) {
            desc.taType = "Int32Array";
        } else if (data instanceof Uint32Array) {
            desc.taType = "Uint32Array";
        } else if (data instanceof Float32Array) {
            desc.taType = "Float32Array";
        } else if (data instanceof Float64Array) {
            desc.taType = "Float64Array";
        } else if (data instanceof DataView) {
            desc.taType = "DataView";
        } else {
            throw new Error("Unrecognized TypedArray type");
        }

        post = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    } else if (data instanceof ArrayBuffer) {
        desc.type = "ArrayBuffer";
        post = new Uint8Array(data);

    } else {
        desc.data = data;

    }

    const te = new TextEncoder();
    const descU8 = te.encode(JSON.stringify(desc));

    const serialized = new Uint8Array(
        4 +
        descU8.length +
        (post ? post.length : 0)
    );
    (new Uint32Array(serialized.buffer, 0, 1))[0] = descU8.length;
    serialized.set(descU8, 4);
    if (post)
        serialized.set(post, 4 + descU8.length);

    return serialized;
}

/**
 * Deserialize this data previously serialized by serialize.
 * @param data  Data to deserialize.
 */
export function deserialize(data: Uint8Array) {
    const descSize = (new Uint32Array(data.buffer, data.byteOffset, 1))[0];
    const descU8 = data.subarray(4, 4 + descSize);
    const td = new TextDecoder();
    const desc: Descriptor = JSON.parse(td.decode(descU8));
    const post = data.subarray(4 + descSize);

    let ret: any;
    switch (desc.type) {
        case "TypedArray":
        {
            let ta: any;
            switch (desc.taType) {
                case "Uint8Array": ta = Uint8Array; break;
                case "Uint8ClampedArray": ta = Uint8ClampedArray; break;
                case "Int16Array": ta = Int16Array; break;
                case "Uint16Array": ta = Uint16Array; break;
                case "Int32Array": ta = Int32Array; break;
                case "Uint32Array": ta = Uint32Array; break;
                case "Float32Array": ta = Float32Array; break;
                case "Float64Array": ta = Float64Array; break;
                case "DataView": ta = DataView; break;
                default:
                    throw new Error(`Unrecognized TypedArray type ${desc.taType}`);
            }

            ret = (new ta(
                post.buffer, post.byteOffset,
                post.byteLength / (ta.BYTES_PER_ELEMENT || 1)
            )).slice(0);
            break;
        }

        case "ArrayBuffer":
            ret = post.slice(0).buffer;
            break;

        case "JSON":
            ret = desc.data;
            break;

        default:
            throw new Error(`Unrecognized serialized type ${desc.type}`);
    }

    return ret;
}

/**
 * Get a (very rough) approximation of the size of this data in bytes when
 * serialized.
 */
export function approxSize(data: any) {
    if (data && data.buffer && data.buffer instanceof ArrayBuffer) {
        return data.buffer.byteLength;

    } else if (data instanceof ArrayBuffer) {
        return data.byteLength;

    } else {
        return JSON.stringify(data).length;

    }
}

/**
 * Make a "safe" version of this string for filename purposes.
 * @param key  String to turn into a safe filename
 */
export function safeify(key: string) {
    return Array.from(key).map(c => {
        if (/^[a-z0-9_-]$/.test(c))
            return c;
        const cc = c.charCodeAt(0);
        if (cc <= 0xFF)
            return `%${cc.toString(16).padStart(2, "0")}`;
        return `%u${cc.toString(16).padStart(4, "0")}`;
    }).join("");
}

/**
 * Take a "safeified" filename and return the original string. Will return
 * nonsense if the original string wasn't actually safeified.
 * @param name  Filename to turn back into a key
 */
export function unsafeify(name: string) {
    let key = "";
    for (let i = 0; i < name.length; i++) {
        const c = name[i];
        if (c !== "%") {
            key += c;
            continue;
        }

        let ccs: string;
        if (name[i+1] === "u") {
            ccs = name.slice(i+2, i+6);
            i += 6;
        } else {
            ccs = name.slice(i+1, i+3);
            i += 3;
        }
        key += String.fromCharCode(parseInt(ccs, 16));
    }

    return key;
}
