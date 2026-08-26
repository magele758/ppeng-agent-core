/**
 * Re-export browser-safe session query helpers from @ppeng/api-types.
 * Prefer `@ppeng/api-types` in web clients to avoid a runtime dependency on core.
 */

export { filterSessionsByQuery, type SessionSearchable } from '@ppeng/api-types';
