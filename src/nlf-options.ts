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

export interface NonlocalforageOptions {
    /**
     * Function to call to request transient activation, if needed. This *must*
     * be defined, and must be an asynchronous function. Transient activation
     * must be active when the promise returned by this function resolves.
     */
    transientActivation: () => Promise<void>;

    /**
     * Optional second function, used if transient activation is needed later,
     * for example if a login token is temporary and must be renewed. If this
     * is not defined, transientActivation will be used again.
     */
    lateTransientActivation?: () => Promise<void>;

    /**
     * Function to call to open a popup window. Set the target to "". This will
     * be called in lieu of transientActivation if (a) it's provided and (b) the
     * transient activation is needed to open a window.
     */
    windowOpen?: (
        url: string, features: string
    ) => Promise<void>;

    /**
     * When popping up a window, we can't determine whether the action was
     * cancelled in all cases. When this function is called, it should display
     * some kind of indicator that the action can be cancelled. The promise
     * should only resolve if the action *is* cancelled. Otherwise it should
     * never resolve.
     */
    cancellable?: () => Promise<void>;

    /**
     * Hide anything shown by cancellable.
     */
    hideCancellable?: () => void;

    /**
     * Optional directory name to use as a root for all nonlocalForage data
     * on this service. If not specified, the directory name
     * "nonlocalForage" will be used.
     */
    directory?: string;

    /**
     * Don't use the "name" component of options when creating a directory.
     */
    noName?: boolean;

    /**
     * Don't use the "storeName" component of options when creating a
     * directory.
     */
    noStore?: boolean;

    /**
     * If set to a truthy value, will force a login prompt, rather than
     * logging in with saved credentials. For instance, when using Google
     * Drive, this will require the user to actually click their username,
     * rather than simply reusing the established account.
     */
    forcePrompt?: boolean;
}
