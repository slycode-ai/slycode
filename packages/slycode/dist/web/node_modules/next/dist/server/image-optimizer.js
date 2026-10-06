"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ImageError: null,
    ImageOptimizerCache: null,
    createPinnedLookup: null,
    detectContentType: null,
    extractEtag: null,
    fetchExternalImage: null,
    fetchInternalImage: null,
    getHash: null,
    getImageEtag: null,
    getImageSize: null,
    getMaxAge: null,
    getPreviouslyCachedImageOrNull: null,
    getSharp: null,
    imageOptimizer: null,
    optimizeImage: null,
    sendResponse: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ImageError: function() {
        return ImageError;
    },
    ImageOptimizerCache: function() {
        return ImageOptimizerCache;
    },
    createPinnedLookup: function() {
        return createPinnedLookup;
    },
    detectContentType: function() {
        return detectContentType;
    },
    extractEtag: function() {
        return extractEtag;
    },
    fetchExternalImage: function() {
        return fetchExternalImage;
    },
    fetchInternalImage: function() {
        return fetchInternalImage;
    },
    getHash: function() {
        return getHash;
    },
    getImageEtag: function() {
        return getImageEtag;
    },
    getImageSize: function() {
        return getImageSize;
    },
    getMaxAge: function() {
        return getMaxAge;
    },
    getPreviouslyCachedImageOrNull: function() {
        return getPreviouslyCachedImageOrNull;
    },
    getSharp: function() {
        return getSharp;
    },
    imageOptimizer: function() {
        return imageOptimizer;
    },
    optimizeImage: function() {
        return optimizeImage;
    },
    sendResponse: function() {
        return sendResponse;
    }
});
const _crypto = require("crypto");
const _fs = require("fs");
const _http = require("http");
const _https = require("https");
const _accept = require("next/dist/compiled/@hapi/accept");
const _contentdisposition = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/content-disposition"));
const _imagesize = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/image-size"));
const _detector = require("next/dist/compiled/image-detector/detector.js");
const _isanimated = /*#__PURE__*/ _interop_require_default(require("next/dist/compiled/is-animated"));
const _path = require("path");
const _imageblursvg = require("../shared/lib/image-blur-svg");
const _matchlocalpattern = require("../shared/lib/match-local-pattern");
const _matchremotepattern = require("../shared/lib/match-remote-pattern");
const _mockrequest = require("./lib/mock-request");
const _responsecache = require("./response-cache");
const _sendpayload = require("./send-payload");
const _servestatic = require("./serve-static");
const _log = /*#__PURE__*/ _interop_require_wildcard(require("../build/output/log"));
const _iserror = /*#__PURE__*/ _interop_require_default(require("../lib/is-error"));
const _isprivateip = require("./is-private-ip");
const _disklrucacheexternal = require("./lib/disk-lru-cache.external");
const _url = require("../lib/url");
const _invarianterror = require("../shared/lib/invariant-error");
const _promises = require("dns/promises");
const _net = require("net");
const _dns = require("dns");
const _stream = require("stream");
const _zlib = require("zlib");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const AVIF = 'image/avif';
const WEBP = 'image/webp';
const PNG = 'image/png';
const JPEG = 'image/jpeg';
const JXL = 'image/jxl';
const JP2 = 'image/jp2';
const HEIC = 'image/heic';
const GIF = 'image/gif';
const SVG = 'image/svg+xml';
const ICO = 'image/x-icon';
const ICNS = 'image/x-icns';
const TIFF = 'image/tiff';
const BMP = 'image/bmp';
const PDF = 'application/pdf';
const CACHE_VERSION = 4;
const ANIMATABLE_TYPES = [
    WEBP,
    PNG,
    GIF
];
const BYPASS_TYPES = [
    SVG,
    ICO,
    ICNS,
    BMP,
    JXL,
    HEIC
];
const BLUR_IMG_SIZE = 8 // should match `next-image-loader`
;
const BLUR_QUALITY = 70 // should match `next-image-loader`
;
let _sharp;
async function initCacheEntries(cacheDir) {
    const cacheKeys = await _fs.promises.readdir(cacheDir).catch(()=>[]);
    const entries = [];
    for (const cacheKey of cacheKeys){
        try {
            const { expireAt, buffer } = await readFromCacheDir(cacheDir, cacheKey);
            entries.push({
                key: cacheKey,
                size: buffer.byteLength,
                expireAt
            });
        } catch  {
        // Skip entries that can't be read from disk
        }
    }
    // Sort oldest-first so we can replay them chronologically into LRU
    return entries.sort((a, b)=>a.expireAt - b.expireAt);
}
function getSharp(concurrency, operationCache) {
    if (_sharp) {
        return _sharp;
    }
    try {
        _sharp = require('sharp');
        _sharp.block({
            operation: [
                'VipsForeignLoad'
            ]
        });
        _sharp.unblock({
            operation: [
                'VipsForeignLoadHeif',
                'VipsForeignLoadJpeg',
                'VipsForeignLoadNsgif',
                'VipsForeignLoadPng',
                'VipsForeignLoadSvg',
                'VipsForeignLoadTiff',
                'VipsForeignLoadWebp'
            ]
        });
        if (typeof operationCache === 'boolean') {
            _sharp.cache(operationCache);
        }
        if (_sharp.concurrency() > 1) {
            // Reducing concurrency should reduce the memory usage too.
            // We more aggressively reduce in dev but also reduce in prod.
            // https://sharp.pixelplumbing.com/api-utility#concurrency
            const divisor = process.env.NODE_ENV === 'development' ? 4 : 2;
            _sharp.concurrency(concurrency ?? Math.floor(Math.max(_sharp.concurrency() / divisor, 1)));
        }
    } catch (e) {
        if ((0, _iserror.default)(e) && e.code === 'MODULE_NOT_FOUND') {
            throw Object.defineProperty(new Error('Module `sharp` not found. Please run `npm install --cpu=wasm32 sharp` to install it.'), "__NEXT_ERROR_CODE", {
                value: "E47",
                enumerable: false,
                configurable: true
            });
        }
        throw e;
    }
    return _sharp;
}
function getSupportedMimeType(options, accept = '') {
    const mimeType = (0, _accept.mediaType)(accept, options);
    return accept.includes(mimeType) ? mimeType : '';
}
function getHash(items) {
    const hash = (0, _crypto.createHash)('sha256');
    for (let item of items){
        if (typeof item === 'number') hash.update(String(item));
        else {
            hash.update(item);
        }
    }
    // See https://en.wikipedia.org/wiki/Base64#URL_applications
    return hash.digest('base64url');
}
function extractEtag(etag, imageBuffer) {
    if (etag) {
        // upstream etag needs to be base64url encoded due to weak etag signature
        // as we store this in the cache-entry file name.
        return Buffer.from(etag).toString('base64url');
    }
    return getImageEtag(imageBuffer);
}
function getImageEtag(image) {
    return getHash([
        image
    ]);
}
async function writeToCacheDir(cacheDir, cacheKey, extension, maxAge, expireAt, buffer, etag, upstreamEtag) {
    if (buffer.byteLength === 0) {
        throw Object.defineProperty(new Error('Invariant: cannot write an empty buffer to the image cache'), "__NEXT_ERROR_CODE", {
            value: "E1470",
            enumerable: false,
            configurable: true
        });
    }
    const dir = (0, _path.join)(/* turbopackIgnore: true */ cacheDir, cacheKey);
    const filename = (0, _path.join)(/* turbopackIgnore: true */ dir, `${maxAge}.${expireAt}.${etag}.${upstreamEtag}.${extension}`);
    await _fs.promises.rm(dir, {
        recursive: true,
        force: true
    }).catch(()=>{});
    await _fs.promises.mkdir(dir, {
        recursive: true
    });
    await _fs.promises.writeFile(filename, buffer);
}
async function readFromCacheDir(cacheDir, cacheKey) {
    const dir = (0, _path.join)(/* turbopackIgnore: true */ cacheDir, cacheKey);
    const files = await _fs.promises.readdir(dir);
    const file = files[0];
    if (!file) {
        throw Object.defineProperty(new Error(`Invariant: cache entry "${cacheKey}" not found in dir "${cacheDir}"`), "__NEXT_ERROR_CODE", {
            value: "E1069",
            enumerable: false,
            configurable: true
        });
    }
    const [maxAgeSt, expireAtSt, etag, upstreamEtag, extension] = file.split('.', 5);
    const filePath = (0, _path.join)(/* turbopackIgnore: true */ dir, file);
    const buffer = await _fs.promises.readFile(/* turbopackIgnore: true */ filePath);
    if (buffer.byteLength === 0) {
        throw Object.defineProperty(new Error(`Invariant: image cache entry "${cacheKey}" is empty`), "__NEXT_ERROR_CODE", {
            value: "E1469",
            enumerable: false,
            configurable: true
        });
    }
    const expireAt = Number(expireAtSt);
    const maxAge = Number(maxAgeSt);
    return {
        maxAge,
        expireAt,
        etag,
        upstreamEtag,
        buffer,
        extension
    };
}
async function deleteFromCacheDir(cacheDir, cacheKey) {
    return _fs.promises.rm((0, _path.join)(/* turbopackIgnore: true */ cacheDir, cacheKey), {
        recursive: true,
        force: true
    }).catch((err)=>{
        _log.error(`Failed to delete cache key ${cacheKey}`, err);
    });
}
async function detectContentType(buffer) {
    if (buffer.byteLength === 0) {
        return null;
    }
    if ([
        0xff,
        0xd8,
        0xff
    ].every((b, i)=>buffer[i] === b)) {
        return JPEG;
    }
    if ([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return PNG;
    }
    if ([
        0x47,
        0x49,
        0x46,
        0x38
    ].every((b, i)=>buffer[i] === b)) {
        return GIF;
    }
    if ([
        0x52,
        0x49,
        0x46,
        0x46,
        0,
        0,
        0,
        0,
        0x57,
        0x45,
        0x42,
        0x50
    ].every((b, i)=>!b || buffer[i] === b)) {
        return WEBP;
    }
    if ([
        0x3c,
        0x3f,
        0x78,
        0x6d,
        0x6c
    ].every((b, i)=>buffer[i] === b)) {
        return SVG;
    }
    if ([
        0x3c,
        0x73,
        0x76,
        0x67
    ].every((b, i)=>buffer[i] === b)) {
        return SVG;
    }
    if ([
        0,
        0,
        0,
        0,
        0x66,
        0x74,
        0x79,
        0x70,
        0x61,
        0x76,
        0x69,
        0x66
    ].every((b, i)=>!b || buffer[i] === b)) {
        return AVIF;
    }
    if ([
        0x00,
        0x00,
        0x01,
        0x00
    ].every((b, i)=>buffer[i] === b)) {
        return ICO;
    }
    if ([
        0x69,
        0x63,
        0x6e,
        0x73
    ].every((b, i)=>buffer[i] === b)) {
        return ICNS;
    }
    if ([
        0x49,
        0x49,
        0x2a,
        0x00
    ].every((b, i)=>buffer[i] === b)) {
        return TIFF;
    }
    if ([
        0x42,
        0x4d
    ].every((b, i)=>buffer[i] === b)) {
        return BMP;
    }
    if ([
        0xff,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return JXL;
    }
    if ([
        0x00,
        0x00,
        0x00,
        0x0c,
        0x4a,
        0x58,
        0x4c,
        0x20,
        0x0d,
        0x0a,
        0x87,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return JXL;
    }
    if ([
        0,
        0,
        0,
        0,
        0x66,
        0x74,
        0x79,
        0x70,
        0x68,
        0x65,
        0x69,
        0x63
    ].every((b, i)=>!b || buffer[i] === b)) {
        return HEIC;
    }
    if ([
        0x25,
        0x50,
        0x44,
        0x46,
        0x2d
    ].every((b, i)=>buffer[i] === b)) {
        return PDF;
    }
    if ([
        0x00,
        0x00,
        0x00,
        0x0c,
        0x6a,
        0x50,
        0x20,
        0x20,
        0x0d,
        0x0a,
        0x87,
        0x0a
    ].every((b, i)=>buffer[i] === b)) {
        return JP2;
    }
    const format = (0, _detector.detector)(buffer.subarray(0, 1024));
    switch(format){
        case 'webp':
            return WEBP;
        case 'png':
            return PNG;
        case 'jpg':
            return JPEG;
        case 'gif':
            return GIF;
        case 'svg':
            return SVG;
        case 'jxl':
        case 'jxl-stream':
            return JXL;
        case 'jp2':
            return JP2;
        case 'tiff':
            return TIFF;
        case 'bmp':
            return BMP;
        case 'ico':
            return ICO;
        case 'icns':
            return ICNS;
        case 'heif':
        case 'cur':
        case 'dds':
        case 'j2c':
        case 'ktx':
        case 'pnm':
        case 'psd':
        case 'tga':
        case undefined:
            return null // unsupported formats
            ;
        default:
            format; // exhaustive check
            return null // impossible to reach
            ;
    }
}
class ImageOptimizerCache {
    static validateParams(req, query, nextConfig, isDev) {
        var _nextConfig_images, _nextConfig_images1, _nextConfig_images2;
        const imageData = nextConfig.images;
        const { deviceSizes = [], imageSizes = [], domains = [], minimumCacheTTL = 14400, formats = [
            'image/webp'
        ] } = imageData;
        const remotePatterns = ((_nextConfig_images = nextConfig.images) == null ? void 0 : _nextConfig_images.remotePatterns) || [];
        const localPatterns = (_nextConfig_images1 = nextConfig.images) == null ? void 0 : _nextConfig_images1.localPatterns;
        const qualities = (_nextConfig_images2 = nextConfig.images) == null ? void 0 : _nextConfig_images2.qualities;
        const { url, w, q } = query;
        let href;
        if (domains.length > 0) {
            _log.warnOnce('The "images.domains" configuration is deprecated. Please use "images.remotePatterns" configuration instead.');
        }
        if (!url) {
            return {
                errorMessage: '"url" parameter is required'
            };
        } else if (Array.isArray(url)) {
            return {
                errorMessage: '"url" parameter cannot be an array'
            };
        }
        if (url.length > 3072) {
            return {
                errorMessage: '"url" parameter is too long'
            };
        }
        if (url.startsWith('//')) {
            return {
                errorMessage: '"url" parameter cannot be a protocol-relative URL (//)'
            };
        }
        let isAbsolute;
        if (url.startsWith('/')) {
            var _parseUrl;
            href = url;
            isAbsolute = false;
            if (/\/_next\/image($|\/)/.test(decodeURIComponent(((_parseUrl = (0, _url.parseUrl)(url)) == null ? void 0 : _parseUrl.pathname) ?? ''))) {
                return {
                    errorMessage: '"url" parameter cannot be recursive'
                };
            }
            if (!(0, _matchlocalpattern.hasLocalMatch)(localPatterns, url)) {
                return {
                    errorMessage: '"url" parameter is not allowed'
                };
            }
        } else {
            let hrefParsed;
            try {
                hrefParsed = new URL(url);
                href = hrefParsed.toString();
                isAbsolute = true;
            } catch (_error) {
                return {
                    errorMessage: '"url" parameter is invalid'
                };
            }
            if (![
                'http:',
                'https:'
            ].includes(hrefParsed.protocol)) {
                return {
                    errorMessage: '"url" parameter is invalid'
                };
            }
            if (!(0, _matchremotepattern.hasRemoteMatch)(domains, remotePatterns, hrefParsed)) {
                return {
                    errorMessage: '"url" parameter is not allowed'
                };
            }
        }
        if (!w) {
            return {
                errorMessage: '"w" parameter (width) is required'
            };
        } else if (Array.isArray(w)) {
            return {
                errorMessage: '"w" parameter (width) cannot be an array'
            };
        } else if (!/^[0-9]+$/.test(w)) {
            return {
                errorMessage: '"w" parameter (width) must be an integer greater than 0'
            };
        }
        if (!q) {
            return {
                errorMessage: '"q" parameter (quality) is required'
            };
        } else if (Array.isArray(q)) {
            return {
                errorMessage: '"q" parameter (quality) cannot be an array'
            };
        } else if (!/^[0-9]+$/.test(q)) {
            return {
                errorMessage: '"q" parameter (quality) must be an integer between 1 and 100'
            };
        }
        const width = parseInt(w, 10);
        if (width <= 0 || isNaN(width)) {
            return {
                errorMessage: '"w" parameter (width) must be an integer greater than 0'
            };
        }
        const sizes = [
            ...deviceSizes || [],
            ...imageSizes || []
        ];
        if (isDev) {
            sizes.push(BLUR_IMG_SIZE);
        }
        const isValidSize = sizes.includes(width) || isDev && width <= BLUR_IMG_SIZE;
        if (!isValidSize) {
            return {
                errorMessage: `"w" parameter (width) of ${width} is not allowed`
            };
        }
        const quality = parseInt(q, 10);
        if (isNaN(quality) || quality < 1 || quality > 100) {
            return {
                errorMessage: '"q" parameter (quality) must be an integer between 1 and 100'
            };
        }
        if (qualities) {
            if (isDev) {
                qualities.push(BLUR_QUALITY);
            }
            if (!qualities.includes(quality)) {
                return {
                    errorMessage: `"q" parameter (quality) of ${q} is not allowed`
                };
            }
        }
        const mimeType = getSupportedMimeType(formats || [], req.headers['accept']);
        const isStatic = url.startsWith(`${nextConfig.basePath || ''}/_next/static/media`) || url.startsWith(`${nextConfig.basePath || ''}/_next/static/immutable/media`);
        return {
            href,
            sizes,
            isAbsolute,
            isStatic,
            width,
            quality,
            mimeType,
            minimumCacheTTL
        };
    }
    static getCacheKey({ href, width, quality, mimeType }) {
        return getHash([
            CACHE_VERSION,
            href,
            width,
            quality,
            mimeType
        ]);
    }
    constructor({ distDir, nextConfig, cacheHandler }){
        this.cacheDir = (0, _path.join)(/* turbopackIgnore: true */ distDir, 'cache', 'images');
        this.nextConfig = nextConfig;
        this.cacheHandler = cacheHandler;
        // Eagerly start LRU initialization for filesystem cache
        if (!cacheHandler && nextConfig.images.maximumDiskCacheSize !== 0 && nextConfig.experimental.isrFlushToDisk) {
            this.isDiskCacheEnabled = true;
            this.cacheDiskLRU = (0, _disklrucacheexternal.getOrInitDiskLRU)(this.cacheDir, nextConfig.images.maximumDiskCacheSize, initCacheEntries, deleteFromCacheDir);
        }
    }
    async get(cacheKey) {
        // If a custom cache handler is provided, use it
        if (this.cacheHandler) {
            try {
                const cacheData = await this.cacheHandler.get(cacheKey, {
                    kind: _responsecache.IncrementalCacheKind.IMAGE,
                    isFallback: false
                });
                if (!(cacheData == null ? void 0 : cacheData.value)) {
                    return null;
                }
                if (cacheData.value.kind !== _responsecache.CachedRouteKind.IMAGE) {
                    return null;
                }
                const now = Date.now();
                const lastModified = cacheData.lastModified || now;
                const revalidate = typeof cacheData.value.revalidate === 'number' ? cacheData.value.revalidate : this.nextConfig.images.minimumCacheTTL;
                const revalidateAfter = Math.max(revalidate, this.nextConfig.images.minimumCacheTTL) * 1000 + lastModified;
                const isStale = revalidateAfter < now;
                return {
                    value: cacheData.value,
                    revalidateAfter,
                    cacheControl: {
                        revalidate,
                        expire: undefined
                    },
                    isStale
                };
            } catch (_) {
            // failed to get from custom cache handler, treat as cache miss
            }
            return null;
        }
        // If the filesystem cache is disabled, return early
        if (!this.isDiskCacheEnabled) {
            return null;
        }
        // Fall back to filesystem cache
        try {
            const now = Date.now();
            const { maxAge, expireAt, etag, upstreamEtag, buffer, extension } = await readFromCacheDir(this.cacheDir, cacheKey);
            // Promote entry in LRU (mark as recently used)
            const lru = await this.cacheDiskLRU;
            lru == null ? void 0 : lru.get(cacheKey);
            return {
                value: {
                    kind: _responsecache.CachedRouteKind.IMAGE,
                    etag,
                    buffer,
                    extension,
                    upstreamEtag
                },
                revalidateAfter: Math.max(maxAge, this.nextConfig.images.minimumCacheTTL) * 1000 + Date.now(),
                cacheControl: {
                    revalidate: maxAge,
                    expire: undefined
                },
                isStale: now > expireAt
            };
        } catch (_) {
        // failed to read from cache dir, treat as cache miss
        }
        return null;
    }
    async set(cacheKey, value, { cacheControl }) {
        if ((value == null ? void 0 : value.kind) !== _responsecache.CachedRouteKind.IMAGE) {
            throw Object.defineProperty(new Error('invariant attempted to set non-image to image-cache'), "__NEXT_ERROR_CODE", {
                value: "E366",
                enumerable: false,
                configurable: true
            });
        }
        const revalidate = cacheControl == null ? void 0 : cacheControl.revalidate;
        if (typeof revalidate !== 'number') {
            throw Object.defineProperty(new _invarianterror.InvariantError('revalidate must be a number for image-cache'), "__NEXT_ERROR_CODE", {
                value: "E657",
                enumerable: false,
                configurable: true
            });
        }
        // If a custom cache handler is provided, use it
        if (this.cacheHandler) {
            try {
                // Apply minimumCacheTTL at write time, similar to the implementation in the fallback filesystem cache
                const effectiveRevalidate = Math.max(revalidate, this.nextConfig.images.minimumCacheTTL);
                const valueWithRevalidate = {
                    ...value,
                    revalidate: effectiveRevalidate
                };
                await this.cacheHandler.set(cacheKey, valueWithRevalidate, {
                    kind: _responsecache.IncrementalCacheKind.IMAGE,
                    cacheControl: {
                        revalidate: effectiveRevalidate,
                        expire: cacheControl == null ? void 0 : cacheControl.expire
                    }
                });
            } catch (err) {
                _log.error(`Failed to write image to custom cache ${cacheKey}`, err);
            }
            return;
        }
        // If the filesystem cache is disabled, return early
        if (!this.isDiskCacheEnabled) {
            return;
        }
        // Fall back to filesystem cache
        const expireAt = Math.max(revalidate, this.nextConfig.images.minimumCacheTTL) * 1000 + Date.now();
        try {
            const lru = await this.cacheDiskLRU;
            const success = lru == null ? void 0 : lru.set(cacheKey, value.buffer.byteLength);
            if (success === false) {
                throw Object.defineProperty(new Error(`image of size ${value.buffer.byteLength} could not be tracked by lru cache`), "__NEXT_ERROR_CODE", {
                    value: "E1070",
                    enumerable: false,
                    configurable: true
                });
            }
            await writeToCacheDir(this.cacheDir, cacheKey, value.extension, revalidate, expireAt, value.buffer, value.etag, value.upstreamEtag);
        } catch (err) {
            _log.error(`Failed to write image to cache ${cacheKey}`, err);
        }
    }
}
class ImageError extends Error {
    constructor(statusCode, message){
        super(message);
        Object.defineProperty(this, "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
        // ensure an error status is used > 400
        if (statusCode >= 400) {
            this.statusCode = statusCode;
        } else {
            this.statusCode = 500;
        }
    }
}
function parseCacheControl(str) {
    const map = new Map();
    if (!str) {
        return map;
    }
    for (let directive of str.split(',')){
        let [key, value] = directive.trim().split('=', 2);
        key = key.toLowerCase();
        if (value) {
            value = value.toLowerCase();
        }
        map.set(key, value);
    }
    return map;
}
function getMaxAge(str) {
    const map = parseCacheControl(str);
    if (map) {
        let age = map.get('s-maxage') || map.get('max-age') || '';
        if (age.startsWith('"') && age.endsWith('"')) {
            age = age.slice(1, -1);
        }
        const n = parseInt(age, 10);
        if (!isNaN(n)) {
            return n;
        }
    }
    return 0;
}
function getPreviouslyCachedImageOrNull(upstreamImage, previousCacheEntry) {
    var _previousCacheEntry_value;
    if ((previousCacheEntry == null ? void 0 : (_previousCacheEntry_value = previousCacheEntry.value) == null ? void 0 : _previousCacheEntry_value.kind) === 'IMAGE' && // Images that are SVGs, animated or failed the optimization previously end up using upstreamEtag as their etag as well,
    // in these cases we want to trigger a new "optimization" attempt.
    previousCacheEntry.value.upstreamEtag !== previousCacheEntry.value.etag && // and the upstream etag is the same as the previous cache entry's
    upstreamImage.etag === previousCacheEntry.value.upstreamEtag) {
        return previousCacheEntry.value;
    }
    return null;
}
async function optimizeImage({ buffer, contentType, quality, width, height, concurrency, operationCache, limitInputPixels, sequentialRead, timeoutInSeconds }) {
    const sharp = getSharp(concurrency, operationCache);
    const transformer = sharp(buffer, {
        limitInputPixels,
        sequentialRead: sequentialRead ?? undefined
    }).timeout({
        seconds: timeoutInSeconds ?? 7
    }).rotate();
    if (height) {
        transformer.resize(width, height);
    } else {
        transformer.resize(width, undefined, {
            withoutEnlargement: true
        });
    }
    if (contentType === AVIF) {
        transformer.avif({
            // Scale the quality to try and match webp. This ratio was derived
            // from sharp's default 80 (webp) and 50 (avif), and then verified
            // using dssim and ssimulacra2 visual quality tests.
            quality: Math.max(Math.round(quality * (50 / 80)), 1),
            effort: 3
        });
    } else if (contentType === WEBP) {
        transformer.webp({
            quality
        });
    } else if (contentType === PNG) {
        transformer.png({
            quality
        });
    } else if (contentType === JPEG) {
        transformer.jpeg({
            quality,
            mozjpeg: true
        });
    }
    const optimizedBuffer = await transformer.toBuffer();
    return optimizedBuffer;
}
function isRedirect(statusCode) {
    return [
        301,
        302,
        303,
        307,
        308
    ].includes(statusCode);
}
function upstreamTimedOut(href) {
    _log.error('upstream image response timed out for', href);
    return Object.defineProperty(new ImageError(504, '"url" parameter is valid but upstream response timed out'), "__NEXT_ERROR_CODE", {
        value: "E394",
        enumerable: false,
        configurable: true
    });
}
const agentOptions = {
    keepAlive: true,
    timeout: 7000
};
const getHttpAgentName = _http.Agent.prototype.getName;
const getHttpsAgentName = _https.Agent.prototype.getName;
class ImageHttpAgent extends _http.Agent {
    getName(options = {}) {
        return `${getHttpAgentName.call(this, options)}:${options.imageLookupKey ?? ''}`;
    }
}
class ImageHttpsAgent extends _https.Agent {
    getName(options = {}) {
        return `${getHttpsAgentName.call(this, options)}:${options.imageLookupKey ?? ''}`;
    }
}
let protectedHttpAgent;
let protectedHttpsAgent;
let permissiveHttpAgent;
let permissiveHttpsAgent;
function getImageAgent(dangerouslyAllowLocalIP, isHttps) {
    if (isHttps) {
        if (dangerouslyAllowLocalIP) {
            return permissiveHttpsAgent ??= new ImageHttpsAgent(agentOptions);
        }
        return protectedHttpsAgent ??= new ImageHttpsAgent(agentOptions);
    }
    if (dangerouslyAllowLocalIP) {
        return permissiveHttpAgent ??= new ImageHttpAgent(agentOptions);
    }
    return protectedHttpAgent ??= new ImageHttpAgent(agentOptions);
}
const BASE_REQ_HEADERS = {
    accept: '*/*',
    'accept-language': '*',
    'sec-fetch-mode': 'cors',
    'user-agent': 'node'
};
const HTTP_FETCH_HEADERS = {
    ...BASE_REQ_HEADERS,
    'accept-encoding': 'gzip, deflate'
};
const HTTPS_FETCH_HEADERS = {
    ...BASE_REQ_HEADERS,
    'accept-encoding': 'br, gzip, deflate'
};
/**
 * Resolves `hostname` with the DNS options the socket itself would have used,
 * so the addresses checked below are the exact set the connection can reach.
 * Mirrors `lookupAndConnect()` in Node's `lib/net.js`.
 */ function lookupAsSocketWould(hostname) {
    return (0, _promises.lookup)(hostname, {
        all: true,
        // Node applies ADDRCONFIG whenever no address family is requested,
        // on every platform except Windows.
        hints: process.platform === 'win32' ? 0 : _dns.ADDRCONFIG
    });
}
function createPinnedLookup(hostname, addresses) {
    return (lookupHostname, options, callback)=>{
        if (lookupHostname !== hostname) {
            callback(new _invarianterror.InvariantError(`Image lookup hostname "${lookupHostname}" does not match request hostname "${hostname}"`), []);
            return;
        }
        const family = typeof options.family === 'number' ? options.family : 0;
        const matched = family ? addresses.filter((address)=>address.family === family) : addresses;
        if (matched.length === 0) {
            // Reporting this as an error rather than an empty list is not optional:
            // Node destructures the first address, so the resulting TypeError is
            // thrown inside the socket and escapes the request entirely.
            const err = new Error(`No IPv${family} address available for ${hostname}`);
            err.code = 'ENODATA';
            callback(err, []);
            return;
        }
        if (options.all) {
            callback(null, matched);
        } else {
            callback(null, matched[0].address, matched[0].family);
        }
    };
}
function requestUpstreamImage(url, pinnedLookup, imageLookupKey, dangerouslyAllowLocalIP, signal) {
    return new Promise((resolve, reject)=>{
        const isHttps = url.protocol === 'https:';
        const request = isHttps ? _https.request : _http.request;
        const options = {
            agent: getImageAgent(dangerouslyAllowLocalIP, isHttps),
            headers: isHttps ? HTTPS_FETCH_HEADERS : HTTP_FETCH_HEADERS,
            imageLookupKey,
            lookup: pinnedLookup,
            signal
        };
        const req = request(url, options, resolve);
        req.on('error', reject);
        req.end();
    });
}
class DeflateDecoder extends _stream.Transform {
    constructor(){
        super();
        this.decoder = undefined;
    }
    _transform(chunk, encoding, callback) {
        if (!this.decoder) {
            if (chunk.length === 0) {
                callback();
                return;
            }
            const options = {
                flush: _zlib.constants.Z_SYNC_FLUSH,
                finishFlush: _zlib.constants.Z_SYNC_FLUSH
            };
            this.decoder = (chunk[0] & 0x0f) === 0x08 ? (0, _zlib.createInflate)(options) : (0, _zlib.createInflateRaw)(options);
            this.decoder.on('data', (data)=>this.push(data));
            this.decoder.on('end', ()=>this.push(null));
            this.decoder.on('error', (err)=>this.destroy(err));
        }
        this.decoder.write(chunk, encoding, callback);
    }
    _final(callback) {
        var _this_decoder;
        (_this_decoder = this.decoder) == null ? void 0 : _this_decoder.end();
        this.decoder = undefined;
        callback();
    }
}
// Matches the chain limit of native fetch (undici), so an upstream cannot
// force unbounded decoder allocations with the header alone.
const MAX_CONTENT_ENCODINGS = 5;
function decodeResponseBody(res, href) {
    const contentEncoding = res.headers['content-encoding'];
    if (!contentEncoding) {
        return res;
    }
    const codings = contentEncoding.toLowerCase().split(',');
    if (codings.length > MAX_CONTENT_ENCODINGS) {
        _log.error('upstream image response had too many content encodings for', href);
        throw Object.defineProperty(new ImageError(400, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    const decoders = [];
    for(let i = codings.length - 1; i >= 0; i--){
        switch(codings[i].trim()){
            case 'x-gzip':
            case 'gzip':
                decoders.push((0, _zlib.createGunzip)({
                    flush: _zlib.constants.Z_SYNC_FLUSH,
                    finishFlush: _zlib.constants.Z_SYNC_FLUSH
                }));
                break;
            case 'deflate':
                decoders.push(new DeflateDecoder());
                break;
            case 'br':
                decoders.push((0, _zlib.createBrotliDecompress)({
                    flush: _zlib.constants.BROTLI_OPERATION_FLUSH,
                    finishFlush: _zlib.constants.BROTLI_OPERATION_FLUSH
                }));
                break;
            default:
                return res;
        }
    }
    (0, _stream.pipeline)([
        res,
        ...decoders
    ], ()=>{});
    return decoders[decoders.length - 1];
}
async function fetchExternalImage(href, dangerouslyAllowLocalIP, maximumResponseBody, count = 3) {
    const url = new URL(href);
    // `URL.hostname` keeps the brackets around an IPv6 literal, the socket does not
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let pinnedLookup;
    let imageLookupKey;
    if (!dangerouslyAllowLocalIP) {
        const literalFamily = (0, _net.isIP)(hostname);
        let addresses;
        if (literalFamily > 0) {
            // A literal address is connected to as-is, without any DNS resolution
            addresses = [
                {
                    address: hostname,
                    family: literalFamily
                }
            ];
        } else {
            addresses = await lookupAsSocketWould(hostname);
            pinnedLookup = createPinnedLookup(hostname, addresses);
        }
        imageLookupKey = addresses.map((address)=>`${address.family}:${address.address}`).join(',');
        const privateIps = addresses.map((record)=>record.address).filter((ip)=>(0, _isprivateip.isPrivateIp)(ip));
        if (privateIps.length > 0) {
            _log.error('upstream image', href, 'hostname resolved to private IP', JSON.stringify(privateIps), 'If this is expected and you understand SSRF risk, use images.dangerouslyAllowLocalIP = true to continue.');
            throw Object.defineProperty(new ImageError(400, '"url" parameter is not allowed'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
    }
    // The signal is owned here rather than by `requestUpstreamImage()` because it
    // has to stay readable while the body streams. Node reports an abort during
    // the body as a plain `ECONNRESET` on the response, so the signal is the only
    // way to tell a timeout apart from the upstream resetting the connection.
    const signal = AbortSignal.timeout(agentOptions.timeout);
    let res;
    try {
        res = await requestUpstreamImage(url, pinnedLookup, imageLookupKey, dangerouslyAllowLocalIP, signal);
    } catch (err) {
        if (signal.aborted) {
            throw upstreamTimedOut(href);
        }
        throw err;
    }
    const statusCode = res.statusCode;
    if (statusCode === undefined) {
        res.destroy();
        throw new _invarianterror.InvariantError('Expected statusCode on upstream image response');
    }
    const locationHeader = res.headers.location;
    if (isRedirect(statusCode) && locationHeader && URL.canParse(locationHeader, href)) {
        // Discard the body rather than draining it. A redirect body is never used,
        // and draining one would download unlimited bytes from the upstream because
        // `maximumResponseBody` is only enforced on the final response.
        res.destroy();
        if (count === 0) {
            _log.error('upstream image response had too many redirects', href);
            throw Object.defineProperty(new ImageError(508, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        const redirect = new URL(locationHeader, href).href;
        return fetchExternalImage(redirect, dangerouslyAllowLocalIP, maximumResponseBody, count - 1);
    }
    if (statusCode < 200 || statusCode > 299) {
        res.destroy();
        _log.error('upstream image response failed for', href, statusCode);
        throw Object.defineProperty(new ImageError(statusCode, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    const chunks = [];
    let totalSize = 0;
    try {
        const body = decodeResponseBody(res, href);
        // Throwing out of this loop destroys the response, so an oversized or
        // timed out download stops instead of running to completion.
        for await (const chunk of body){
            totalSize += chunk.byteLength;
            if (totalSize > maximumResponseBody) {
                _log.error('upstream image response exceeded maximum size for', href, totalSize);
                throw Object.defineProperty(new ImageError(413, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
                    value: "E394",
                    enumerable: false,
                    configurable: true
                });
            }
            chunks.push(chunk);
        }
    } catch (err) {
        res.destroy();
        if (signal.aborted) {
            throw upstreamTimedOut(href);
        }
        throw err;
    }
    if (totalSize === 0) {
        _log.error('upstream image response is empty for', href);
        throw Object.defineProperty(new ImageError(400, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    const buffer = Buffer.concat(chunks);
    const contentType = res.headers['content-type'];
    const cacheControl = res.headers['cache-control'];
    const etag = extractEtag(res.headers.etag, buffer);
    return {
        buffer,
        contentType,
        cacheControl,
        etag
    };
}
async function fetchInternalImage(href, _req, _res, maximumResponseBody, handleRequest) {
    try {
        // Coerce HEAD to GET to avoid issues with the image optimizer
        const method = !_req.method || _req.method === 'HEAD' ? 'GET' : _req.method;
        const mocked = (0, _mockrequest.createRequestResponseMocks)({
            url: href,
            method,
            socket: _req.socket,
            maximumResponseBody
        });
        await handleRequest(mocked.req, mocked.res, (0, _url.parseReqUrl)(href));
        await mocked.res.hasStreamed;
        if (!mocked.res.statusCode) {
            _log.error('image response failed for', href, mocked.res.statusCode);
            throw Object.defineProperty(new ImageError(mocked.res.statusCode, '"url" parameter is valid but internal response is invalid'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        if (mocked.res.buffers.length === 0) {
            _log.error('internal image response is empty for', href);
            throw Object.defineProperty(new ImageError(400, '"url" parameter is valid but internal response is invalid'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        const buffer = Buffer.concat(mocked.res.buffers);
        const contentType = mocked.res.getHeader('Content-Type');
        const cacheControl = mocked.res.getHeader('Cache-Control');
        const etag = extractEtag(mocked.res.getHeader('ETag'), buffer);
        return {
            buffer,
            contentType,
            cacheControl,
            etag
        };
    } catch (err) {
        if (err instanceof ImageError) {
            throw err;
        }
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ERR_MAX_BODY_SIZE_EXCEEDED') {
            _log.error('internal image response exceeded maximum size for', href);
            throw Object.defineProperty(new ImageError(413, '"url" parameter is valid but internal response is invalid'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
        _log.error('upstream image response failed for', href, err);
        throw Object.defineProperty(new ImageError(500, '"url" parameter is valid but upstream response is invalid'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
}
async function imageOptimizer(imageUpstream, paramsResult, nextConfig, opts) {
    const { href, quality, width, mimeType } = paramsResult;
    const { buffer: upstreamBuffer, etag: upstreamEtag } = imageUpstream;
    const maxAge = Math.max(nextConfig.images.minimumCacheTTL, getMaxAge(imageUpstream.cacheControl));
    const upstreamType = await detectContentType(upstreamBuffer);
    if (!upstreamType || !upstreamType.startsWith('image/') || upstreamType.includes(',')) {
        if (!opts.silent) {
            _log.error("The requested resource isn't a valid image for", href, 'received', upstreamType);
        }
        throw Object.defineProperty(new ImageError(400, "The requested resource isn't a valid image."), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    if (upstreamType.startsWith('image/svg') && !nextConfig.images.dangerouslyAllowSVG) {
        if (!opts.silent) {
            _log.error(`The requested resource "${href}" has type "${upstreamType}" but dangerouslyAllowSVG is disabled. Consider adding the "unoptimized" property to the <Image>.`);
        }
        throw Object.defineProperty(new ImageError(400, '"url" parameter is valid but image type is not allowed'), "__NEXT_ERROR_CODE", {
            value: "E394",
            enumerable: false,
            configurable: true
        });
    }
    if (ANIMATABLE_TYPES.includes(upstreamType) && (0, _isanimated.default)(upstreamBuffer)) {
        if (!opts.silent) {
            _log.warnOnce(`The requested resource "${href}" is an animated image so it will not be optimized. Consider adding the "unoptimized" property to the <Image>.`);
        }
        return {
            buffer: upstreamBuffer,
            contentType: upstreamType,
            maxAge,
            etag: upstreamEtag,
            upstreamEtag
        };
    }
    if (BYPASS_TYPES.includes(upstreamType)) {
        return {
            buffer: upstreamBuffer,
            contentType: upstreamType,
            maxAge,
            etag: upstreamEtag,
            upstreamEtag
        };
    }
    let contentType;
    if (mimeType) {
        contentType = mimeType;
    } else if ((0, _servestatic.getExtension)(upstreamType) && upstreamType !== WEBP && upstreamType !== AVIF) {
        contentType = upstreamType;
    } else {
        contentType = JPEG;
    }
    const previouslyCachedImage = getPreviouslyCachedImageOrNull(imageUpstream, opts.previousCacheEntry);
    if (previouslyCachedImage) {
        var _opts_previousCacheEntry_cacheControl, _opts_previousCacheEntry;
        return {
            buffer: previouslyCachedImage.buffer,
            contentType,
            maxAge: (opts == null ? void 0 : (_opts_previousCacheEntry = opts.previousCacheEntry) == null ? void 0 : (_opts_previousCacheEntry_cacheControl = _opts_previousCacheEntry.cacheControl) == null ? void 0 : _opts_previousCacheEntry_cacheControl.revalidate) || maxAge,
            etag: previouslyCachedImage.etag,
            upstreamEtag: previouslyCachedImage.upstreamEtag
        };
    }
    try {
        let optimizedBuffer = await optimizeImage({
            buffer: upstreamBuffer,
            contentType,
            quality,
            width,
            concurrency: nextConfig.experimental.imgOptConcurrency,
            operationCache: nextConfig.experimental.imgOptOperationCache,
            limitInputPixels: nextConfig.experimental.imgOptMaxInputPixels,
            sequentialRead: nextConfig.experimental.imgOptSequentialRead,
            timeoutInSeconds: nextConfig.experimental.imgOptTimeoutInSeconds
        });
        if (opts.isDev && width <= BLUR_IMG_SIZE && quality === BLUR_QUALITY) {
            // During `next dev`, we don't want to generate blur placeholders with webpack
            // because it can delay starting the dev server. Instead, `next-image-loader.js`
            // will inline a special url to lazily generate the blur placeholder at request time.
            const meta = await getImageSize(optimizedBuffer);
            const blurOpts = {
                blurWidth: meta.width,
                blurHeight: meta.height,
                blurDataURL: `data:${contentType};base64,${optimizedBuffer.toString('base64')}`
            };
            optimizedBuffer = Buffer.from(unescape((0, _imageblursvg.getImageBlurSvg)(blurOpts)));
            contentType = 'image/svg+xml';
        }
        return {
            buffer: optimizedBuffer,
            contentType,
            maxAge,
            etag: getImageEtag(optimizedBuffer),
            upstreamEtag
        };
    } catch (error) {
        if (upstreamType) {
            // If we fail to optimize, fallback to the original image
            return {
                buffer: upstreamBuffer,
                contentType: upstreamType,
                maxAge: nextConfig.images.minimumCacheTTL,
                etag: upstreamEtag,
                upstreamEtag,
                error
            };
        } else {
            throw Object.defineProperty(new ImageError(400, 'Unable to optimize image and unable to fallback to upstream image'), "__NEXT_ERROR_CODE", {
                value: "E394",
                enumerable: false,
                configurable: true
            });
        }
    }
}
function getFileNameWithExtension(url, contentType) {
    const [urlWithoutQueryParams] = url.split('?', 1);
    const fileNameWithExtension = urlWithoutQueryParams.split('/').pop();
    if (!contentType || !fileNameWithExtension) {
        return 'image.bin';
    }
    const [fileName] = fileNameWithExtension.split('.', 1);
    const extension = (0, _servestatic.getExtension)(contentType);
    return `${fileName}.${extension}`;
}
function setResponseHeaders(req, res, url, etag, contentType, isStatic, xCache, imagesConfig, maxAge, isDev) {
    res.setHeader('Vary', 'Accept');
    res.setHeader('Cache-Control', isStatic ? 'public, max-age=315360000, immutable' : `public, max-age=${isDev ? 0 : maxAge}, must-revalidate`);
    if ((0, _sendpayload.sendEtagResponse)(req, res, etag)) {
        // already called res.end() so we're finished
        return {
            finished: true
        };
    }
    if (contentType) {
        res.setHeader('Content-Type', contentType);
    }
    const fileName = getFileNameWithExtension(url, contentType);
    res.setHeader('Content-Disposition', (0, _contentdisposition.default)(fileName, {
        type: imagesConfig.contentDispositionType
    }));
    res.setHeader('Content-Security-Policy', imagesConfig.contentSecurityPolicy);
    res.setHeader('X-Nextjs-Cache', xCache);
    return {
        finished: false
    };
}
function sendResponse(req, res, url, extension, buffer, etag, isStatic, xCache, imagesConfig, maxAge, isDev) {
    const contentType = (0, _servestatic.getContentType)(extension);
    const result = setResponseHeaders(req, res, url, etag, contentType, isStatic, xCache, imagesConfig, maxAge, isDev);
    if (!result.finished) {
        res.setHeader('Content-Length', Buffer.byteLength(buffer));
        // A response body must not be sent for HEAD requests
        if (req.method === 'HEAD') {
            res.end();
        } else {
            res.end(buffer);
        }
    }
}
async function getImageSize(buffer) {
    const { width, height } = (0, _imagesize.default)(buffer);
    return {
        width,
        height
    };
}

//# sourceMappingURL=image-optimizer.js.map