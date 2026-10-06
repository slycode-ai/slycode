"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ROUTE_CACHE_DIRECTORY: null,
    getResponseCacheOwner: null,
    getRouteCacheKey: null,
    isRouteCacheOwner: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ROUTE_CACHE_DIRECTORY: function() {
        return ROUTE_CACHE_DIRECTORY;
    },
    getResponseCacheOwner: function() {
        return getResponseCacheOwner;
    },
    getRouteCacheKey: function() {
        return getRouteCacheKey;
    },
    isRouteCacheOwner: function() {
        return isRouteCacheOwner;
    }
});
const _normalizepagepath = require("../../shared/lib/page-path/normalize-page-path");
const _normalizelocalepath = require("../../shared/lib/i18n/normalize-locale-path");
const _invarianterror = require("../../shared/lib/invariant-error");
const _apppathnamenormalizer = require("../normalizers/built/app/app-pathname-normalizer");
const _routekind = require("../route-kind");
const ROUTE_CACHE_DIRECTORY = 'route-cache';
const appPathnameNormalizer = new _apppathnamenormalizer.AppPathnameNormalizer();
function getResponseCacheOwner(definition) {
    return {
        kind: definition.kind,
        // Pages module names can include a trailing /index in Turbopack. Their
        // pathname matches the manifest's source in both bundlers. App modules
        // retain groups and parallel slots in their cache identity.
        sourceRoute: definition.kind === _routekind.RouteKind.PAGES ? definition.pathname : definition.page
    };
}
function isRouteCacheOwner(pathname, owner, prerender, locales) {
    if (!prerender) {
        return false;
    }
    // Pages have JSON data routes, App Pages have RSC data routes, and App
    // Route Handlers have no separate data route.
    const kind = prerender.dataRoute === null ? _routekind.RouteKind.APP_ROUTE : prerender.dataRoute.endsWith('.json') ? _routekind.RouteKind.PAGES : prerender.dataRoute.endsWith('.rsc') ? _routekind.RouteKind.APP_PAGE : undefined;
    if (kind !== owner.kind) {
        return false;
    }
    const source = 'srcRoute' in prerender ? prerender.srcRoute : prerender.fallbackSourceRoute;
    const prerenderOwner = source ?? (kind === _routekind.RouteKind.PAGES ? (0, _normalizelocalepath.normalizeLocalePath)(pathname, locales).pathname : pathname);
    return prerenderOwner === (kind === _routekind.RouteKind.PAGES ? owner.sourceRoute : appPathnameNormalizer.normalize(owner.sourceRoute));
}
function getRouteCacheKey(pathname, owner) {
    if (!owner) {
        throw new _invarianterror.InvariantError('Response cache requires a source route');
    }
    const { sourceRoute } = owner;
    let source;
    if (process.env.NEXT_RUNTIME === 'edge') {
        const sha256 = require('next/dist/compiled/hash.js/sha256');
        source = sha256().update(new TextEncoder().encode(sourceRoute)).digest('hex');
    } else {
        const { createHash } = require('crypto');
        source = createHash('sha256').update(sourceRoute).digest('hex');
    }
    return `/${ROUTE_CACHE_DIRECTORY}/${owner.kind}/${source}/$${(0, _normalizepagepath.normalizePagePath)(pathname)}`;
}

//# sourceMappingURL=route-cache-key.js.map