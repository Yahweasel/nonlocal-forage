import * as cf from "./cache";
import * as dbx from "./dropbox";
import * as gd from "./google-drive";
import * as wdav from "./webdav";

export const cacheForage = cf.cacheForage;
export const dropboxLocalForage = dbx.dropboxLocalForage;
export const googleDriveLocalForage = gd.googleDriveLocalForage;
export const webDAVLocalForage = wdav.webDAVLocalForage;
