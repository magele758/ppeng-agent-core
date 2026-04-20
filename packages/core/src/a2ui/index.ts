/**
 * A2UI capability surface — exports the protocol types, the validator,
 * and the built-in catalogs. Tools (`a2ui_render` / `a2ui_delete_surface`)
 * use these to validate envelopes before persisting them.
 *
 * Importing this module side-effect-registers the basic + agent-native
 * catalogs so downstream code can call `getCatalog(id)` without having
 * to remember to bootstrap.
 */

export * from './protocol.js';
export * from './validator.js';
export * from './transport-bridges.js';
export * from './catalog/registry.js';
export {
  BASIC_CATALOG,
  BASIC_CATALOG_ID,
  registerBasicCatalog
} from './catalog/basic.js';
export {
  AGENT_NATIVE_CATALOG,
  AGENT_NATIVE_CATALOG_ID,
  registerAgentNativeCatalog
} from './catalog/agent-native.js';

import { registerBasicCatalog } from './catalog/basic.js';
import { registerAgentNativeCatalog } from './catalog/agent-native.js';

registerBasicCatalog();
registerAgentNativeCatalog();
