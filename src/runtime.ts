/**
 * 🌳 Opt-in runtime tree consumption (S-94).
 *
 * Thin subpath entry (`zopia/runtime`) re-exporting the helpers that turn a
 * generated api-docs directory into the objects an application consumes. The
 * package root stays free of filesystem-importing APIs — importing this
 * subpath is the explicit opt-in.
 */

export { createApiDocs, flattenApiDocs, type ApiDocsEndpointConfig, type ApiDocsTree } from './runtime/create-api-docs';
