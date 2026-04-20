/**
 * Side-effect module: registers the basic + agent-native catalog renderers
 * once on import. Imported from `A2uiSurface.tsx` so the render path is
 * always primed before the first surface is mounted.
 */

import { registerCatalogRenderers } from './registry';
import { BASIC_RENDERERS } from './components/basic';
import { AGENT_NATIVE_RENDERERS } from './components/agent-native';

const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';
const AGENT_NATIVE_CATALOG_ID = 'https://ppeng.dev/agent-core/a2ui/v1';

registerCatalogRenderers(BASIC_CATALOG_ID, BASIC_RENDERERS);
registerCatalogRenderers(AGENT_NATIVE_CATALOG_ID, AGENT_NATIVE_RENDERERS);

export { BASIC_CATALOG_ID, AGENT_NATIVE_CATALOG_ID };
