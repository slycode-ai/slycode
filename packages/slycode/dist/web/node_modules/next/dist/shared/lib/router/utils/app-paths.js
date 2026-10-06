"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    compareAppPaths: null,
    normalizeAppPath: null,
    normalizeRscURL: null,
    selectAppPageEntry: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    compareAppPaths: function() {
        return compareAppPaths;
    },
    normalizeAppPath: function() {
        return normalizeAppPath;
    },
    normalizeRscURL: function() {
        return normalizeRscURL;
    },
    selectAppPageEntry: function() {
        return selectAppPageEntry;
    }
});
const _ensureleadingslash = require("../../page-path/ensure-leading-slash");
const _segment = require("../../segment");
function normalizeAppPath(route) {
    return (0, _ensureleadingslash.ensureLeadingSlash)(route.split('/').reduce((pathname, segment, index, segments)=>{
        // Empty segments are ignored.
        if (!segment) {
            return pathname;
        }
        // Groups are ignored.
        if ((0, _segment.isGroupSegment)(segment)) {
            return pathname;
        }
        // Parallel segments are ignored.
        if (segment[0] === '@') {
            return pathname;
        }
        // The last segment (if it's a leaf) should be ignored.
        if ((segment === 'page' || segment === 'route') && index === segments.length - 1) {
            return pathname;
        }
        return `${pathname}/${segment}`;
    }, ''));
}
function compareAppPaths(a, b) {
    const aHasSlot = a.includes('/@');
    const bHasSlot = b.includes('/@');
    if (aHasSlot && !bHasSlot) return -1;
    if (!aHasSlot && bHasSlot) return 1;
    return a.localeCompare(b);
}
function selectAppPageEntry(pathname, appPaths, normalizePathname = (appPath)=>normalizeAppPath(appPath).replace(/%5F/g, '_')) {
    let entry;
    for (const appPath of appPaths){
        if (normalizePathname(appPath) !== pathname) continue;
        if (entry === undefined || compareAppPaths(entry, appPath) < 0) {
            entry = appPath;
        }
    }
    if (entry === undefined) {
        throw new Error(`Invariant: no direct app page entry found for ${pathname}`);
    }
    return entry;
}
function normalizeRscURL(url) {
    return url.replace(/\.rsc($|\?)/, // $1 ensures `?` is preserved
    '$1');
}

//# sourceMappingURL=app-paths.js.map