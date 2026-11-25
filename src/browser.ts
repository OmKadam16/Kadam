/**
 * Browser-safe subset of Kadam's language services.
 *
 * Studio's CodeMirror adapter imports this entry so it can use the real lexer
 * and source positioning without pulling the Node compiler or dev server into
 * a browser bundle. Nothing exported here touches the filesystem.
 */
export * from "./core/lexer/index.js";
export * from "./core/source/index.js";
