/**
 * Programatik giriş — HTTP transport ya da test için aynı sunucu fabrikası.
 */
export { buildServer, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "./server.js";
export { ServerContext, ToolError } from "./context.js";
export { loadConfig, parseDotenv, parseToolsets, resolveProjectDir, describeMissingConfig, MCP_MODES } from "./config.js";
export type { TecofConfig, McpMode } from "./config.js";
export { TecofApiClient, ApiError, describeInsecureApiUrl } from "./api.js";
export { ComponentCatalog, summarizeComponent } from "./catalog/index.js";
export { parseComponentSchema, collectExportedConstants } from "./catalog/parseComponentSchema.js";
export { discoverComponents } from "./catalog/discover.js";
export { buildSection, buildDocument, nodeToSection } from "./document/build.js";
export { validateDocument, normalizeDocument, LIMITS } from "./document/validate.js";
export { applyOperations } from "./document/operations.js";
export { buildOutline } from "./document/outline.js";
export { extractLayout, applyLayout } from "./document/layout.js";
export { findNode, findSharedAncestor, collectSharedSubtreeIds, collectDescendantZoneKeys } from "./document/tree.js";
/* Remote (proxy) modu — 0.2.0 */
export { RegistryClient, RegistryError, SseParser, CATALOG_TIMEOUT_MS } from "./remote/registryClient.js";
export type { CatalogTool, ToolCatalog, ToolCallResult, CallToolOptions, ToolProgress } from "./remote/registryClient.js";
export { RemoteCatalog, loadCatalogSnapshot, filterCatalog } from "./remote/catalog.js";
export type { CatalogState, CatalogSource } from "./remote/catalog.js";
export { registerRemoteTools, registerProxyTool, remoteOkResult, remoteErrorResult, LOCAL_ONLY_TOOLS, HYBRID_PAGE_TOOLS } from "./remote/registerRemoteTools.js";
export * from "./types.js";
