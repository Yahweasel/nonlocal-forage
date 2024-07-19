# Nonlocal Forage

This is a set of drivers for
[localForage](https://github.com/localForage/localForage) to make its storage
non-local. More precisely, it is a set of drivers for using cloud storage
services as a backend for “local” storage. At present, it supports using Google
Drive or Dropbox as backends.


## General Approach

Nonlocal Forage declares a global namespace `NonlocalForage` which contains a
number of drivers. You should *always* use the `cacheForage` driver, which is a
caching driver for using local storage as a fast temporary cache for cloud
storage. Load it like so:

```js
await localforage.defineDriver(NonlocalForage.cacheForage);
```

Then load your other nonlocal storage drivers.

Each nonlocalForage driver requires an actually local localForage instance for
storing temporary data such as tokens and keys. This can be the default
localforage instance, but this is not recommended.

```js
const keylf = await localforage.createInstance({
    name: "nonlocal-forage-keys" // use any name you want
});
```

In addition, cacheForage requires a local localForage instance to use as a
cache. This *must not* be the default localforage instance.

```js
const cachelf = await localforage.createInstance({
    name: "nonlocal-forage-cache" // use any name you want
});
```

To create a nonlocalForage instance, define its driver (described for each
backend, below), then create an instance using that driver. Several instance
creation options are specific to nonlocalForage and *must* be set:

```js
const nllf = await localforage.createInstance({
    driver: driverName, // String name of the driver to use

    localforage: keylf, // localForage instance to use for keys

    nonlocalforage: {
        /* Function to call to request transient activation, if needed. This
         * *must* be defined, and must be an asynchronous function. Transient
         * activation must be active when the promise returned by this function
         * resolves. */
        transientActivation: ..., 

        /* Optional second function, used if transient activation is needed
         * later, for example if a login token is temporary and must be
         * renewed. If this is not defined, transientActivation will be used
         * again. */
        lateTransientActivation: ...,

        /* Optional directory name to use as a root for all nonlocalForage data
         * on this service. If not specified, the directory name
         * "nonlocalForage" will be used. */
        directory: "nonlocalForage",

        /* If set to a truthy value, will force a login prompt, rather than
         * logging in with saved credentials. For instance, when using Google
         * Drive, this will require the user to actually click their username,
         * rather than simply reusing the established account. */
        forcePrompt: false
    },

    name: "nonlocal", // Standard localFoage createInstance options are allowed

    ... // Other options are driver specific
});
await nllf.ready();
```

It is very important to `await` the `ready()` method of a nonlocalForage
instance, as this is where the login actually occurs.

If you're using cacheForage (which you are strongly advised to), you then need
to link the nonlocalForage instance with the local caching instance as a
cacheForage instance like so:

```js
const clf = await localforage.createInstance({
    driver: "cacheForage",
    cacheForage: {
        local: cachelf,
        nonlocal: nllf
    }
});
```

The cacheForage instance (in this case, `clf`) can be used like any other
localForage instance, and will transparently use a local copy of data until
it's uploaded, and the remote copy for anything not cached locally.

Regardless of the backend, entries are stores as files, with the name
corresponding to the key, serialized to be safe on most platforms. The content
is also serialized; see `src/serializer.ts` for details on how data is
serialized.


## Google Drive

The Google Drive driver is exposed as nonlocalForage.googleDriveLocalForage.
Define it like so:

```js
await localforage.defineDriver(NonlocalForage.googleDriveLocalForage);
```

Due to a lot of weirdness in how Google implements OAuth2, there are two
options for handling login. Either login can be client-only, but the user will
need to refresh it every hour (using `lateTransientActivation`), or a server
component can be included to make login more transparent. The server component,
called a “code server” as it handles authentication-code based login, is fairly
simple; an example is given in
[server/google-code-server.jss](server/google-code-server.jss).

Login is performed through `oauth2-login.html`, which must be present next to
your web app. It is opened in a popup window for initial login.

To create an instance, use the driver name `"googleDrive"`, and include a
`googleDrive` field in the options as an object with the `apiKey` and
`clientId` fields set, like so:

```js
const gdlf = await localforage.createInstance({
    driver: "googleDrive",
    localforage: keylf,
    nonlocalforage: {
        transientActivation: ..., 
        lateTransientActivation: ...
    },
    googleDrive: {
        apiKey: "Google Drive API key",
        clientId: "Google Drive API client ID"
    }
});
await gdlf.ready();
```

If using a code server, additionally set the `codeServer` field to the URL
(which may be relative) to the code server:

```js
const gdlf = await localforage.createInstance({
    driver: "googleDrive",
    ...
    googleDrive: {
        apiKey: "Google Drive API key",
        clientId: "Google Drive API client ID",
        codeServer: "/api/google-code-server.jss"
    }
});
await gdlf.ready();
```

Files are stored in
`<nonlocalforage.directory>/<options.name>/<options.storeName>/<key>`.


## Dropbox

The Dropbox driver is exposed as nonlocalForage.dropboxLocalForage. Define it
like so:

```js
await localforage.defineDriver(NonlocalForage.dropboxLocalForage);
```

To create an instance, use the driver name `"dropbox"`, and include a `dropbox`
field in the options as an object with the `clientId` field set, like so:

```js
const dbxlf = await localforage.createInstance({
    driver: "dropbox",
    localforage: keylf,
    nonlocalforage: {
        transientActivation: ...
    },
    dropbox: {
        clientId: "Dropbox API client ID"
    }
});
await dbxlf.ready();
```

In order to be able to log into Dropbox, you *must* put `dropbox-login.html`
next to your web app. It is opened in a window to begin the Dropbox login
process.

Files are stored in
`Apps/<application name>/<nonlocalforage.directory>/<options.name>/<options.storeName>/<key>`.
