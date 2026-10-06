"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return FileSystemCache;
    }
});
const _routecachekey = require("../route-cache-key");
const _responsecache = require("../../response-cache");
const _path = /*#__PURE__*/ _interop_require_default(require("../../../shared/lib/isomorphic/path"));
const _constants = require("../../../lib/constants");
const _tagsmanifestexternal = require("./tags-manifest.external");
const _multifilewriter = require("../../../lib/multi-file-writer");
const _memorycacheexternal = require("./memory-cache.external");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class FileSystemCache {
    static #_ = this.debug = !!process.env.NEXT_PRIVATE_DEBUG_CACHE;
    static #_2 = this.seedReads = new Map();
    constructor(ctx){
        this.fs = ctx.fs;
        this.flushToDisk = ctx.flushToDisk;
        this.serverDistDir = ctx.serverDistDir;
        this.revalidatedTags = ctx.revalidatedTags;
        if (ctx.maxMemoryCacheSize) {
            if (!FileSystemCache.memoryCache) {
                if (FileSystemCache.debug) {
                    console.log('FileSystemCache: using memory store for fetch cache');
                }
                FileSystemCache.memoryCache = (0, _memorycacheexternal.getMemoryCache)(ctx.maxMemoryCacheSize);
            } else if (FileSystemCache.debug) {
                console.log('FileSystemCache: memory store already initialized');
            }
        } else if (FileSystemCache.debug) {
            console.log('FileSystemCache: not using memory store for fetch cache');
        }
    }
    resetRequestCache() {}
    getSeedReadState(key) {
        return FileSystemCache.seedReads.get(`${this.serverDistDir}:${key}`);
    }
    beginSeedRead(key) {
        const stateKey = `${this.serverDistDir}:${key}`;
        let state = FileSystemCache.seedReads.get(stateKey);
        if (!state) {
            state = {
                readers: 0,
                version: 0
            };
            FileSystemCache.seedReads.set(stateKey, state);
        }
        state.readers++;
        return {
            stateKey,
            state,
            version: state.version
        };
    }
    finishSeedRead(stateKey, state) {
        state.readers--;
        if (state.readers === 0 && !state.promotion) {
            FileSystemCache.seedReads.delete(stateKey);
        }
    }
    async revalidateTag(tags, durations) {
        tags = typeof tags === 'string' ? [
            tags
        ] : tags;
        if (FileSystemCache.debug) {
            console.log('FileSystemCache: revalidateTag', tags, durations);
        }
        if (tags.length === 0) {
            return;
        }
        const now = Date.now();
        for (const tag of tags){
            const existingEntry = _tagsmanifestexternal.tagsManifest.get(tag) || {};
            if (durations) {
                // Use provided durations directly
                const updates = {
                    ...existingEntry
                };
                // mark as stale immediately
                updates.stale = now;
                if (durations.expire !== undefined) {
                    updates.expired = now + durations.expire * 1000 // Convert seconds to ms
                    ;
                }
                _tagsmanifestexternal.tagsManifest.set(tag, updates);
            } else {
                // Update expired field for immediate expiration (default behavior when no durations provided)
                _tagsmanifestexternal.tagsManifest.set(tag, {
                    ...existingEntry,
                    expired: now
                });
            }
        }
    }
    async get(...args) {
        var _FileSystemCache_memoryCache, _this_getSeedReadState, _data_value, _data_value1, _data_value2, _data_value3;
        const [key, ctx] = args;
        const { kind } = ctx;
        let readKey = key;
        let seedRead;
        let data = (_FileSystemCache_memoryCache = FileSystemCache.memoryCache) == null ? void 0 : _FileSystemCache_memoryCache.get(key);
        const activePromotion = (_this_getSeedReadState = this.getSeedReadState(key)) == null ? void 0 : _this_getSeedReadState.promotion;
        if (!data && activePromotion) {
            var _FileSystemCache_memoryCache1;
            await activePromotion;
            data = (_FileSystemCache_memoryCache1 = FileSystemCache.memoryCache) == null ? void 0 : _FileSystemCache_memoryCache1.get(key);
        }
        if (FileSystemCache.debug) {
            if (kind === _responsecache.IncrementalCacheKind.FETCH) {
                console.log('FileSystemCache: get', key, ctx.tags, kind, !!data);
            } else {
                console.log('FileSystemCache: get', key, kind, !!data);
            }
        }
        const isResponse = kind === _responsecache.IncrementalCacheKind.PAGES || kind === _responsecache.IncrementalCacheKind.APP_PAGE || kind === _responsecache.IncrementalCacheKind.APP_ROUTE;
        if (!data && isResponse && key.startsWith(`/${_routecachekey.ROUTE_CACHE_DIRECTORY}/`) && process.env.NEXT_RUNTIME !== 'edge') {
            const primaryPath = this.getFilePath(kind === _responsecache.IncrementalCacheKind.APP_ROUTE ? `${key}.body` : `${key}.html`, kind);
            if (!this.fs.existsSync(primaryPath)) {
                const marker = key.indexOf('/$/');
                if (marker !== -1) {
                    const legacyKey = key.slice(marker + 2);
                    const legacyMetaPath = this.getFilePath(`${legacyKey}${_constants.NEXT_META_SUFFIX}`, kind);
                    try {
                        var _meta_routeCache;
                        const meta = JSON.parse(this.fs.readFileSync(legacyMetaPath, 'utf8'));
                        const namespaceEnd = key.indexOf('/$/');
                        const ownerKey = meta.routeCache ? (0, _routecachekey.getRouteCacheKey)('/', meta.routeCache.owner) : undefined;
                        if (((_meta_routeCache = meta.routeCache) == null ? void 0 : _meta_routeCache.key) === key && (meta.routeCache.isFallback === Boolean(ctx.isFallback) || // PPR also reads fallback shells through ordinary response and
                        // navigation resume-data lookups, which set isFallback: false.
                        kind === _responsecache.IncrementalCacheKind.APP_PAGE && ctx.isRoutePPREnabled && meta.postponed != null) && (ownerKey == null ? void 0 : ownerKey.slice(0, ownerKey.indexOf('/$/'))) === key.slice(0, namespaceEnd)) {
                            readKey = legacyKey;
                            seedRead = this.beginSeedRead(key);
                        }
                    } catch  {}
                }
            }
        }
        // Check the scoped disk entry first, or a verified immutable build seed
        // only when its scoped primary payload is genuinely absent.
        if (!data && process.env.NEXT_RUNTIME !== 'edge') {
            try {
                if (kind === _responsecache.IncrementalCacheKind.APP_ROUTE) {
                    const filePath = this.getFilePath(`${readKey}.body`, _responsecache.IncrementalCacheKind.APP_ROUTE);
                    const fileData = await this.fs.readFile(filePath);
                    const { mtime } = await this.fs.stat(filePath);
                    const meta = JSON.parse(await this.fs.readFile(filePath.replace(/\.body$/, _constants.NEXT_META_SUFFIX), 'utf8'));
                    data = {
                        lastModified: meta.routeCacheLastModified ?? mtime.getTime(),
                        value: {
                            kind: _responsecache.CachedRouteKind.APP_ROUTE,
                            body: fileData,
                            headers: meta.headers,
                            status: meta.status
                        }
                    };
                } else {
                    const filePath = this.getFilePath(kind === _responsecache.IncrementalCacheKind.FETCH ? readKey : `${readKey}.html`, kind);
                    const fileData = await this.fs.readFile(filePath, 'utf8');
                    const { mtime } = await this.fs.stat(filePath);
                    if (kind === _responsecache.IncrementalCacheKind.FETCH) {
                        var _data_value4;
                        const { tags, fetchIdx, fetchUrl } = ctx;
                        if (!this.flushToDisk) return null;
                        const lastModified = mtime.getTime();
                        const parsedData = JSON.parse(fileData);
                        data = {
                            lastModified,
                            value: parsedData
                        };
                        if (((_data_value4 = data.value) == null ? void 0 : _data_value4.kind) === _responsecache.CachedRouteKind.FETCH) {
                            var _data_value5;
                            const storedTags = (_data_value5 = data.value) == null ? void 0 : _data_value5.tags;
                            // update stored tags if a new one is being added
                            // TODO: remove this when we can send the tags
                            // via header on GET same as SET
                            if (!(tags == null ? void 0 : tags.every((tag)=>storedTags == null ? void 0 : storedTags.includes(tag)))) {
                                if (FileSystemCache.debug) {
                                    console.log('FileSystemCache: tags vs storedTags mismatch', tags, storedTags);
                                }
                                await this.set(key, data.value, {
                                    fetchCache: true,
                                    tags,
                                    fetchIdx,
                                    fetchUrl
                                });
                            }
                        }
                    } else if (kind === _responsecache.IncrementalCacheKind.APP_PAGE) {
                        // Metadata is required for both normal entries and fallback shells.
                        // Promoted entries publish their primary payload last, so a missing
                        // sidecar means the scoped entry is incomplete.
                        const meta = JSON.parse(await this.fs.readFile(filePath.replace(/\.html$/, _constants.NEXT_META_SUFFIX), 'utf8'));
                        let maybeSegmentData;
                        if (meta == null ? void 0 : meta.segmentPaths) {
                            // Collect all the segment data for this page.
                            // TODO: To optimize file system reads, we should consider creating
                            // separate cache entries for each segment, rather than storing them
                            // all on the page's entry. Though the behavior is
                            // identical regardless.
                            const segmentData = new Map();
                            maybeSegmentData = segmentData;
                            const segmentsDir = readKey + _constants.RSC_SEGMENTS_DIR_SUFFIX;
                            await Promise.all(meta.segmentPaths.map(async (segmentPath)=>{
                                const segmentDataFilePath = this.getFilePath(segmentsDir + segmentPath + _constants.RSC_SEGMENT_SUFFIX, _responsecache.IncrementalCacheKind.APP_PAGE);
                                try {
                                    segmentData.set(segmentPath, await this.fs.readFile(segmentDataFilePath));
                                } catch  {
                                // This shouldn't happen, but if for some reason we fail to
                                // load a segment from the filesystem, treat it the same as if
                                // the segment is dynamic and does not have a prefetch.
                                }
                            }));
                        }
                        let rscData;
                        if (!ctx.isFallback && (!ctx.isRoutePPREnabled || (meta == null ? void 0 : meta.postponed) == null)) {
                            rscData = await this.fs.readFile(this.getFilePath(`${readKey}${_constants.RSC_SUFFIX}`, _responsecache.IncrementalCacheKind.APP_PAGE));
                        }
                        data = {
                            lastModified: meta.routeCacheLastModified ?? mtime.getTime(),
                            value: {
                                kind: _responsecache.CachedRouteKind.APP_PAGE,
                                html: fileData,
                                rscData,
                                postponed: meta == null ? void 0 : meta.postponed,
                                headers: meta == null ? void 0 : meta.headers,
                                status: meta == null ? void 0 : meta.status,
                                segmentData: maybeSegmentData
                            }
                        };
                    } else if (kind === _responsecache.IncrementalCacheKind.PAGES) {
                        const meta = JSON.parse(await this.fs.readFile(filePath.replace(/\.html$/, _constants.NEXT_META_SUFFIX), 'utf8'));
                        let pageData = {};
                        if (!ctx.isFallback) {
                            pageData = JSON.parse(await this.fs.readFile(this.getFilePath(`${readKey}${_constants.NEXT_DATA_SUFFIX}`, _responsecache.IncrementalCacheKind.PAGES), 'utf8'));
                        }
                        data = {
                            lastModified: meta.routeCacheLastModified ?? mtime.getTime(),
                            value: {
                                kind: _responsecache.CachedRouteKind.PAGES,
                                html: fileData,
                                pageData,
                                headers: meta == null ? void 0 : meta.headers,
                                status: meta == null ? void 0 : meta.status
                            }
                        };
                    } else {
                        throw Object.defineProperty(new Error(`Invariant: Unexpected route kind ${kind} in file system cache.`), "__NEXT_ERROR_CODE", {
                            value: "E445",
                            enumerable: false,
                            configurable: true
                        });
                    }
                }
                if (data) {
                    if (!seedRead) {
                        var _FileSystemCache_memoryCache2;
                        (_FileSystemCache_memoryCache2 = FileSystemCache.memoryCache) == null ? void 0 : _FileSystemCache_memoryCache2.set(key, data);
                    }
                }
            } catch  {
                if (seedRead) {
                    this.finishSeedRead(seedRead.stateKey, seedRead.state);
                }
                return null;
            }
        }
        if ((data == null ? void 0 : (_data_value = data.value) == null ? void 0 : _data_value.kind) === _responsecache.CachedRouteKind.APP_PAGE || (data == null ? void 0 : (_data_value1 = data.value) == null ? void 0 : _data_value1.kind) === _responsecache.CachedRouteKind.APP_ROUTE || (data == null ? void 0 : (_data_value2 = data.value) == null ? void 0 : _data_value2.kind) === _responsecache.CachedRouteKind.PAGES) {
            var _data_value_headers;
            const tagsHeader = (_data_value_headers = data.value.headers) == null ? void 0 : _data_value_headers[_constants.NEXT_CACHE_TAGS_HEADER];
            if (typeof tagsHeader === 'string') {
                const cacheTags = tagsHeader.split(',');
                // we trigger a blocking validation if an ISR page
                // had a tag revalidated, if we want to be a background
                // revalidation instead we return data.lastModified = -1
                if (cacheTags.length > 0 && (0, _tagsmanifestexternal.areTagsExpired)(cacheTags, data.lastModified)) {
                    if (FileSystemCache.debug) {
                        console.log('FileSystemCache: expired tags', cacheTags);
                    }
                    if (seedRead) {
                        this.finishSeedRead(seedRead.stateKey, seedRead.state);
                    }
                    return null;
                }
            }
        } else if ((data == null ? void 0 : (_data_value3 = data.value) == null ? void 0 : _data_value3.kind) === _responsecache.CachedRouteKind.FETCH) {
            const combinedTags = ctx.kind === _responsecache.IncrementalCacheKind.FETCH ? [
                ...ctx.tags || [],
                ...ctx.softTags || []
            ] : [];
            // When revalidate tag is called we don't return stale data so it's
            // updated right away.
            if (combinedTags.some((tag)=>this.revalidatedTags.includes(tag))) {
                if (FileSystemCache.debug) {
                    console.log('FileSystemCache: was revalidated', combinedTags);
                }
                return null;
            }
            if ((0, _tagsmanifestexternal.areTagsExpired)(combinedTags, data.lastModified)) {
                if (FileSystemCache.debug) {
                    console.log('FileSystemCache: expired tags', combinedTags);
                }
                return null;
            }
        }
        if (seedRead && data) {
            const { stateKey, state, version } = seedRead;
            try {
                if (state.version === version) {
                    var _FileSystemCache_memoryCache3;
                    await this.promoteSeed(key, readKey, data, ctx, stateKey, state, version);
                    if (state.version === version && !((_FileSystemCache_memoryCache3 = FileSystemCache.memoryCache) == null ? void 0 : _FileSystemCache_memoryCache3.get(key))) {
                        var _FileSystemCache_memoryCache4;
                        (_FileSystemCache_memoryCache4 = FileSystemCache.memoryCache) == null ? void 0 : _FileSystemCache_memoryCache4.set(key, data);
                    }
                }
            } finally{
                this.finishSeedRead(stateKey, state);
            }
        }
        return data ?? null;
    }
    async promoteSeed(key, seedKey, data, ctx, stateKey, state, version) {
        const writeFileAtomic = this.fs.writeFileAtomic;
        if (!this.flushToDisk || !writeFileAtomic || !data.value) return;
        if (state.promotion) {
            await state.promotion;
            return;
        }
        const promotion = (async ()=>{
            const value = data.value;
            if (!value || state.version !== version || value.kind !== _responsecache.CachedRouteKind.PAGES && value.kind !== _responsecache.CachedRouteKind.APP_PAGE && value.kind !== _responsecache.CachedRouteKind.APP_ROUTE) {
                return;
            }
            const kind = ctx.kind;
            const primaryPath = this.getFilePath(value.kind === _responsecache.CachedRouteKind.APP_ROUTE ? `${key}.body` : `${key}.html`, kind);
            if (this.fs.existsSync(primaryPath)) return;
            const seedPrimaryPath = this.getFilePath(value.kind === _responsecache.CachedRouteKind.APP_ROUTE ? `${seedKey}.body` : `${seedKey}.html`, kind);
            const seedMetaPath = seedPrimaryPath.replace(value.kind === _responsecache.CachedRouteKind.APP_ROUTE ? /\.body$/ : /\.html$/, _constants.NEXT_META_SUFFIX);
            const meta = JSON.parse(await this.fs.readFile(seedMetaPath, 'utf8'));
            meta.routeCacheLastModified = data.lastModified;
            // Copy every ancillary seed file first. The scoped primary payload is
            // the publication marker and is written only after metadata is complete.
            const ancillaryFiles = [];
            if (value.kind === _responsecache.CachedRouteKind.PAGES && !ctx.isFallback) {
                ancillaryFiles.push({
                    path: this.getFilePath(`${key}${_constants.NEXT_DATA_SUFFIX}`, kind),
                    data: await this.fs.readFile(this.getFilePath(`${seedKey}${_constants.NEXT_DATA_SUFFIX}`, kind))
                });
            } else if (value.kind === _responsecache.CachedRouteKind.APP_PAGE) {
                if (!ctx.isFallback && (!ctx.isRoutePPREnabled || meta.postponed == null)) {
                    ancillaryFiles.push({
                        path: this.getFilePath(`${key}${_constants.RSC_SUFFIX}`, kind),
                        data: await this.fs.readFile(this.getFilePath(`${seedKey}${_constants.RSC_SUFFIX}`, kind))
                    });
                }
                ancillaryFiles.push(...await Promise.all((meta.segmentPaths ?? []).map(async (segmentPath)=>({
                        path: this.getFilePath(key + _constants.RSC_SEGMENTS_DIR_SUFFIX + segmentPath + _constants.RSC_SEGMENT_SUFFIX, kind),
                        data: await this.fs.readFile(this.getFilePath(seedKey + _constants.RSC_SEGMENTS_DIR_SUFFIX + segmentPath + _constants.RSC_SEGMENT_SUFFIX, kind))
                    }))));
            }
            const writer = new _multifilewriter.MultiFileWriter(this.fs);
            for (const file of ancillaryFiles)writer.append(file.path, file.data);
            await writer.wait();
            if (state.version !== version) return;
            const metaPath = primaryPath.replace(value.kind === _responsecache.CachedRouteKind.APP_ROUTE ? /\.body$/ : /\.html$/, _constants.NEXT_META_SUFFIX);
            await this.fs.mkdir(_path.default.dirname(metaPath));
            await this.fs.writeFile(metaPath, JSON.stringify(meta));
            if (state.version !== version || this.fs.existsSync(primaryPath)) return;
            await writeFileAtomic.call(this.fs, primaryPath, await this.fs.readFile(seedPrimaryPath));
        })();
        state.promotion = promotion.catch((error)=>{
            if (FileSystemCache.debug) {
                console.log('FileSystemCache: failed to promote build seed', error);
            }
        });
        try {
            await state.promotion;
        } finally{
            if (state.promotion) state.promotion = undefined;
            if (state.readers === 0) FileSystemCache.seedReads.delete(stateKey);
        }
    }
    async set(key, data, ctx) {
        var _FileSystemCache_memoryCache;
        const seedState = this.getSeedReadState(key);
        if (seedState) seedState.version++;
        (_FileSystemCache_memoryCache = FileSystemCache.memoryCache) == null ? void 0 : _FileSystemCache_memoryCache.set(key, {
            value: data,
            lastModified: Date.now()
        });
        if (FileSystemCache.debug) {
            console.log('FileSystemCache: set', key);
        }
        if (!this.flushToDisk || !data) return;
        await (seedState == null ? void 0 : seedState.promotion);
        // Create a new writer that will prepare to write all the files to disk
        // after their containing directory is created.
        const writer = new _multifilewriter.MultiFileWriter(this.fs);
        if (data.kind === _responsecache.CachedRouteKind.APP_ROUTE) {
            const filePath = this.getFilePath(`${key}.body`, _responsecache.IncrementalCacheKind.APP_ROUTE);
            writer.append(filePath, data.body);
            const meta = {
                headers: data.headers,
                status: data.status,
                postponed: undefined,
                segmentPaths: undefined,
                prefetchHints: undefined
            };
            writer.append(filePath.replace(/\.body$/, _constants.NEXT_META_SUFFIX), JSON.stringify(meta, null, 2));
        } else if (data.kind === _responsecache.CachedRouteKind.PAGES || data.kind === _responsecache.CachedRouteKind.APP_PAGE) {
            const isAppPath = data.kind === _responsecache.CachedRouteKind.APP_PAGE;
            const htmlPath = this.getFilePath(`${key}.html`, isAppPath ? _responsecache.IncrementalCacheKind.APP_PAGE : _responsecache.IncrementalCacheKind.PAGES);
            writer.append(htmlPath, data.html);
            // Fallbacks don't generate a data file.
            if (!ctx.fetchCache && !ctx.isFallback && !ctx.isRoutePPREnabled) {
                writer.append(this.getFilePath(`${key}${isAppPath ? _constants.RSC_SUFFIX : _constants.NEXT_DATA_SUFFIX}`, isAppPath ? _responsecache.IncrementalCacheKind.APP_PAGE : _responsecache.IncrementalCacheKind.PAGES), isAppPath ? data.rscData : JSON.stringify(data.pageData));
            }
            if ((data == null ? void 0 : data.kind) === _responsecache.CachedRouteKind.APP_PAGE) {
                let segmentPaths;
                if (data.segmentData) {
                    segmentPaths = [];
                    const segmentsDir = htmlPath.replace(/\.html$/, _constants.RSC_SEGMENTS_DIR_SUFFIX);
                    for (const [segmentPath, buffer] of data.segmentData){
                        segmentPaths.push(segmentPath);
                        const segmentDataFilePath = segmentsDir + segmentPath + _constants.RSC_SEGMENT_SUFFIX;
                        writer.append(segmentDataFilePath, buffer);
                    }
                }
                const meta = {
                    headers: data.headers,
                    status: data.status,
                    postponed: data.postponed,
                    segmentPaths,
                    prefetchHints: undefined
                };
                writer.append(htmlPath.replace(/\.html$/, _constants.NEXT_META_SUFFIX), JSON.stringify(meta));
            } else {
                const meta = {
                    headers: data.headers,
                    status: data.status,
                    postponed: undefined,
                    segmentPaths: undefined,
                    prefetchHints: undefined
                };
                writer.append(htmlPath.replace(/\.html$/, _constants.NEXT_META_SUFFIX), JSON.stringify(meta));
            }
        } else if (data.kind === _responsecache.CachedRouteKind.FETCH) {
            const filePath = this.getFilePath(key, _responsecache.IncrementalCacheKind.FETCH);
            writer.append(filePath, JSON.stringify({
                ...data,
                tags: ctx.fetchCache ? ctx.tags : []
            }));
        }
        // Wait for all FS operations to complete.
        await writer.wait();
    }
    getFilePath(key, kind) {
        let rootDir;
        switch(kind){
            case _responsecache.IncrementalCacheKind.FETCH:
                // we store in .next/cache/fetch-cache so it can be persisted
                // across deploys
                rootDir = _path.default.join(this.serverDistDir, '..', 'cache', 'fetch-cache');
                break;
            case _responsecache.IncrementalCacheKind.PAGES:
                rootDir = _path.default.join(this.serverDistDir, 'pages');
                break;
            case _responsecache.IncrementalCacheKind.IMAGE:
            case _responsecache.IncrementalCacheKind.APP_PAGE:
            case _responsecache.IncrementalCacheKind.APP_ROUTE:
                rootDir = _path.default.join(this.serverDistDir, 'app');
                break;
            default:
                throw Object.defineProperty(new Error(`Unexpected file path kind: ${kind}`), "__NEXT_ERROR_CODE", {
                    value: "E479",
                    enumerable: false,
                    configurable: true
                });
        }
        // Scoped response artifacts live outside the compiled route and ASO files.
        if ((kind === _responsecache.IncrementalCacheKind.PAGES || kind === _responsecache.IncrementalCacheKind.APP_PAGE || kind === _responsecache.IncrementalCacheKind.APP_ROUTE) && key.startsWith(`/${_routecachekey.ROUTE_CACHE_DIRECTORY}/`)) {
            rootDir = _path.default.join(this.serverDistDir, '.');
        }
        const filePath = _path.default.join(rootDir, key);
        if (!(filePath.startsWith(rootDir + _path.default.sep) || filePath === rootDir)) {
            throw Object.defineProperty(new Error(`Invalid file path: ${filePath}`), "__NEXT_ERROR_CODE", {
                value: "E1468",
                enumerable: false,
                configurable: true
            });
        }
        return filePath;
    }
}

//# sourceMappingURL=file-system-cache.js.map