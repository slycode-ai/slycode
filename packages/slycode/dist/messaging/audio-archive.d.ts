import { slugifyForFilename } from './audio-utils.js';
export declare const slugify: typeof slugifyForFilename;
export declare function save(buffer: Buffer, ext: '.ogg' | '.mp3', contextSlug: string): void;
export declare function prune(maxFiles: number): void;
