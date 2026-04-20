/**
 * A2UI v0.9 basic catalog — subset suitable for chat-bubble UIs.
 *
 * Mirrors the components in
 * https://a2ui.org/specification/v0_9/basic_catalog.json that we actually
 * render in apps/web-console. Adding more components is purely additive —
 * just append to BASIC_COMPONENTS and ship a matching renderer entry.
 */

import { registerCatalog, type CatalogSpec, type ComponentSpec } from './registry.js';

export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

const BASIC_COMPONENTS: ComponentSpec[] = [
  { name: 'Text', description: 'Static or bound text. `text` may be string or { path }.', containerKind: 'leaf', requiredProps: ['text'] },
  { name: 'Icon', description: 'Named icon (e.g. mail, warning).', containerKind: 'leaf', requiredProps: ['name'] },
  { name: 'Image', description: 'Image by url or assetId.', containerKind: 'leaf' },
  { name: 'Divider', description: 'Visual separator (axis: horizontal | vertical).', containerKind: 'leaf' },
  { name: 'Button', description: 'Action trigger; embed label via `child`.', containerKind: 'single' },
  { name: 'TextField', description: 'Two-way bound text input.', containerKind: 'leaf', requiredProps: ['value'] },
  { name: 'CheckBox', description: 'Two-way bound boolean toggle.', containerKind: 'leaf', requiredProps: ['value'] },
  { name: 'ChoicePicker', description: 'Pick one (or many) from `options`.', containerKind: 'leaf', requiredProps: ['options', 'value'] },
  { name: 'Card', description: 'Padded container with a single child.', containerKind: 'single' },
  { name: 'Column', description: 'Vertical layout container.', containerKind: 'list' },
  { name: 'Row', description: 'Horizontal layout container.', containerKind: 'list' },
  { name: 'List', description: 'Templated list (use children: { path, componentId }).', containerKind: 'list' }
];

export const BASIC_CATALOG: CatalogSpec = {
  id: BASIC_CATALOG_ID,
  label: 'A2UI Basic Catalog v0.9',
  components: Object.fromEntries(BASIC_COMPONENTS.map((c) => [c.name, c]))
};

let registered = false;
export function registerBasicCatalog(): void {
  if (registered) return;
  registerCatalog(BASIC_CATALOG);
  registered = true;
}
