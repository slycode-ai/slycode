"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "SharedCacheControls", {
    enumerable: true,
    get: function() {
        return SharedCacheControls;
    }
});
const _routecachekey = require("../route-cache-key");
const _normalizelocalepath = require("../../../shared/lib/i18n/normalize-locale-path");
const _routekind = require("../../route-kind");
class SharedCacheControls {
    static #_ = /**
   * The in-memory cache of cache lives for routes. This cache is populated when
   * the cache is updated with new cache lives.
   */ this.cacheControls = new Map();
    constructor(/**
     * The prerender manifest that contains the initial cache controls for
     * routes.
     */ prerenderManifest, locales){
        this.prerenderManifest = prerenderManifest;
        this.locales = locales;
    }
    /**
   * Try to get the cache control value for a route. This will first try to get
   * the value from the in-memory cache. If the value is not present in the
   * in-memory cache, it will be sourced from the prerender manifest.
   *
   * @param route the route to get the cache control for
   * @param owner the source route that owns the response
   * @returns the cache control for the route, or undefined if the values
   *          are not present in the in-memory cache or the prerender manifest
   */ get(route, owner) {
        // This is a copy on write cache that is updated when the cache is updated.
        // If the cache is never written to, then the values will be sourced from
        // the prerender manifest.
        let cacheControl = SharedCacheControls.cacheControls.get((0, _routecachekey.getRouteCacheKey)(route, owner));
        if (cacheControl) return cacheControl;
        let prerenderData = this.prerenderManifest.routes[route];
        if (prerenderData && (0, _routecachekey.isRouteCacheOwner)(route, owner, prerenderData, this.locales)) {
            const { initialRevalidateSeconds, initialExpireSeconds } = prerenderData;
            if (typeof initialRevalidateSeconds !== 'undefined') {
                return {
                    revalidate: initialRevalidateSeconds,
                    expire: initialExpireSeconds
                };
            }
        }
        const dynamicPathname = owner.kind === _routekind.RouteKind.PAGES ? (0, _normalizelocalepath.normalizeLocalePath)(route, this.locales).pathname : route;
        const dynamicPrerenderData = this.prerenderManifest.dynamicRoutes[dynamicPathname];
        if (dynamicPrerenderData && (0, _routecachekey.isRouteCacheOwner)(route, owner, dynamicPrerenderData, this.locales)) {
            const { fallbackRevalidate, fallbackExpire } = dynamicPrerenderData;
            if (typeof fallbackRevalidate !== 'undefined') {
                return {
                    revalidate: fallbackRevalidate,
                    expire: fallbackExpire
                };
            }
        }
        // A new runtime pathname has no initial lifetime. Its own render supplies
        // one instead of borrowing a sibling route's build-time metadata.
        return undefined;
    }
    /**
   * Set the cache control for a route.
   *
   * @param route the route to set the cache control for
   * @param cacheControl the cache control for the route
   */ set(route, cacheControl) {
        SharedCacheControls.cacheControls.set(route, cacheControl);
    }
    /**
   * Clear the in-memory cache of cache controls for routes.
   */ clear() {
        SharedCacheControls.cacheControls.clear();
    }
}

//# sourceMappingURL=shared-cache-controls.external.js.map