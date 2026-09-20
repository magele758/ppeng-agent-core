// Re-export from @ppeng/agent-loop (SSOT)
export {
  pickUpstreamRequestIdFromHeaders,
  unwrapNestedUpstreamError,
  pickUpstreamRequestIdFromRecord,
  pickUpstreamRequestIdFromJsonText,
  wrapResponseToCaptureUpstreamRequestId,
  normalizeUpstreamRequestId,
  resolveUpstreamRequestId
} from '@ppeng/agent-loop';
export type { HeaderGetter, NestedUpstreamError } from '@ppeng/agent-loop';
