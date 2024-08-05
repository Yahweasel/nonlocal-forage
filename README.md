# Nonlocal Forage

This is a set of drivers for
[localForage](https://github.com/localForage/localForage) to make its storage
non-local. More precisely, it is a set of drivers for using cloud storage
services as a backend for “local” storage. At present, it supports using Google
Drive, Dropbox, or WebDAV as backends.

It also has a FileSystemDirectoryHandle backend (i.e., a backend for use with
FileSystemDirectoryHandles), simply because all of the cloud backends are based
on the principle of using files within a directory structure, so it made sense
to do the same with an actual directory structure.

Because the nonlocal storage may be shared, it makes sense to combine this with
[lockableForage](https://github.com/Yahweasel/lockable-forage). If you do, make
sure to set the timeout time quite high (say, 10 seconds), as clock skew will
interfere with locking.


## General Approach

Nonlocal Forage declares a global namespace `NonlocalForage` which contains a
number of drivers. You should usually use the `cacheForage` driver, which is a
caching driver for using local storage as a fast temporary cache for cloud
storage. Load it like so:

```js
await localforage.defineDriver(NonlocalForage.cacheForage);
```

Then load your other nonlocal storage drivers.

Most nonlocalForage driver requires an actually local localForage instance for
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

        /* Optional (but highly recommended, particularly if you use CORS)
         * function to show a cancellation dialog. When CORS is active, there's
         * no way to know if the login screen has been closed. Thus, it's
         * necessary to allow the user to tell the system that they've given up
         * on logging in. This should be a function that returns a promise that
         * *only resolves* if the user has chosen to cancel. */
        cancellable: ...,

        /* If cancellable is set, this should be a function that hides the
         * cancellation dialog shown by cancellable. */
        hideCancellable: ...,

        /* Optional directory name to use as a root for all nonlocalForage data
         * on this service. If not specified, the directory name
         * "nonlocalForage" will be used. */
        directory: "nonlocalForage",

        /* Normally, cloud backends use the directory above, plus the normal
         * `options.name`, plus `options.storeName`, to choose a directory. Set
         * this to true to ignore `options.name`. */
        noName: false,

        /* Set this to true to ignore `options.storeName`. */
        noStore: false,

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

Nonlocal backends—that is, every backend provided by this library other than
cacheForage—additionally provide one extra method not normally in localForage:
`storageEstimate`. `await lf.storageEstimate()` returns an object in the form
of `navigator.storage.estimate()`. It has a `quota` field and a `usage` field,
referencing the number of bytes of storage maximum provided by the backend, and
the number of bytes used, respectively. This method is correctly named: it is
an *estimate*.

If you are using [lockableForage](https://github.com/Yahweasel/lockable-forage),
make sure to initialize it with the backend localforage, *not* the caching
localforage. Anything that needs to be controlled by locks should be accessed
directly, uncached.


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
your web app. It is opened in a popup window for initial login. It also must be
a valid redirect URI for your Google API project.

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

In order to be able to log into Dropbox, you must put `oauth2-login.html` next
to your web app. It is opened in a window to begin the Dropbox login process.
It also must be a valid redirect URI for your Dropbox API project.

Files are stored in
`Apps/<application name>/<nonlocalforage.directory>/<options.name>/<options.storeName>/<key>`.


## WebDAV

The WebDAV driver is exposed as nonlocalForage.webDAVLocalForage. Define it
like so:

```js
await localforage.defineDriver(NonlocalForage.webDAVLocalForage);
```

To create an instance, use the driver name `"webDAV"`, and include a `webDAV`
field in the options as an object with the `username`, `password`, and `server`
fields set, like so:

```js
const wdlf = await localforage.createInstance({
    driver: "webDAV",
    webDAV: {
        username: "WebDAV username",
        password: "WebDAV password",
        server: "WebDAV server URL"
    }
});
await wdlf.ready();
```

As WebDAV uses a username and password, it's up to you to prompt for them. It
does not use a prompt, and does not use the keystore.

Files are stored in
`<nonlocalforage.directory>/<options.name>/<options.storeName>/<key>`.

The WebDAV backend was intended for use with ownCloud and Nextcloud. You should
advise users to add an “app password” for your app, and to add your domain to
the list of “CORS domains”.

The WebDAV backend uses [Perry Mitchell's WebDAV
client](https://github.com/perry-mitchell/webdav-client/) to access WebDAV.


## FileSystemDirectoryHandle

The FileSystemDirectoryHandle driver is exposed as
nonlocalForage.fsdhLocalForage. Define it like so:

```js
await localforage.defineDriver(NonlocalForage.fsdhForage);
```

To create an instance, use the driver name `"FileSystemDirectoryHandle"`, and
include a `directoryHandle` field in the options as the base directory handle
to use. It must already have permissions; it's up to you to establish all
necessary permissions before creating an instance.

```js
const fsdhlf = await localforage.createInstance({
    driver: "FileSystemDirectoryHandle",
    directoryHandle: dirHandle
});
await fsdhlf.ready();
```

Files are stored in
`<base directory>/<nonlocalforage.directory>/<options.name>/<options.storeName>/<key>`.
