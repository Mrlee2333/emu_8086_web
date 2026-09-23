/** Types for the single-source folder guards (see folder-guards.js). */
export declare const MAX_FOLDER_ENTRIES: number;
export declare const MAX_FOLDER_FILE_BYTES: number;
export declare const LISTABLE_EXT: Set<string>;
export declare function isSafeRelPath(rel: unknown): boolean;
export declare function hasNoDotSegments(rel: unknown): boolean;
export declare function isListableFile(name: unknown): boolean;
export declare function isSourceFileRel(rel: unknown): boolean;
