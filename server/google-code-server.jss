<?JS
/*
 * This (un)license applies only to this sample code, and not to
 * nonlocal-forage as a whole:
 *
 * This is free and unencumbered software released into the public domain.
 *
 * Anyone is free to copy, modify, publish, use, compile, sell, or distribute
 * this software, either in source code form or as a compiled binary, for any
 * purpose, commercial or non-commercial, and by any means.
 *
 * In jurisdictions that recognize copyright laws, the author or authors of
 * this software dedicate any and all copyright interest in the software to the
 * public domain. We make this dedication for the benefit of the public at
 * large and to the detriment of our heirs and successors. We intend this
 * dedication to be an overt act of relinquishment in perpetuity of all present
 * and future rights to this software under copyright law.
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
 * ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/*
 * This is a simple example of a Google OAuth2 code server for use with
 * nonlocal-forage (or, indeed, anything else), written in nodejs-server-pages
 * (https://github.com/Yahweasel/nodejs-server-pages).
 *
 * It expects its configuration in ~/google-code-server.json, which must have
 * fields `clientId`, `clientSecret`, `redirectUris`, and `referers`. The last
 * two are arrays of acceptable values for both of these fields.
 *
 * To use it, just submit a GET or POST request to this script with `code` and
 * `requestUri` parameters. The response is shuttled directly from Google.
 */
const googleInfo = require(`${process.env.HOME}/google-code-server.json`);
const https = require("node:https");

// Check the referer
{
    const refererUrl = new URL(request.headers.referer);
    refererUrl.search = "";
    const referer = refererUrl.toString();
    let refererOK = false;
    for (const r of googleInfo.referers) {
        if (r === referer) {
            refererOK = true;
            break;
        }
    }
    if (!refererOK) {
        writeHead(500, {"content-type": "application/json"});
        write(JSON.stringify({error: "Invalid request"}));
        return;
    }
}

// Check the parameters
const query = request.query || request.body;
const qParams = new URLSearchParams();
if (query && typeof query.code === "string" && typeof query.redirectUri === "string") {
    // Initial code request
    qParams.set("grant_type", "authorization_code");
    qParams.set("code", query.code);
    const qru = query.redirectUri;
    let redirectUri = googleInfo.redirectUris[0];
    for (const ru of googleInfo.redirectUris) {
        if (ru === qru) {
            redirectUri = ru;
            break;
        }
    }
    qParams.set("redirect_uri", redirectUri);

} else if (query && typeof query.refreshToken === "string") {
    // Refresh request
    qParams.set("grant_type", "refresh_token");
    qParams.set("refresh_token", query.refreshToken);

} else {
    writeHead(500, {"content-type": "application/json"});
    write(JSON.stringify({error: "Invalid request"}));
    return;

}

// Other (standard) parameters
qParams.set("client_id", googleInfo.clientId);
qParams.set("client_secret", googleInfo.clientSecret);

// Make the request
const resp = await new Promise(res => {
    const req = https.request(
        "https://oauth2.googleapis.com/token",
        {
            headers: {
                "content-type": "application/x-www-form-urlencoded"
            },
            method: "POST"
        },
        res
    );
    req.write(qParams.toString());
    req.end();
});

writeHead(resp.statusCode);
resp.on("data", write);
await new Promise(res => resp.on("end", res));
?>
