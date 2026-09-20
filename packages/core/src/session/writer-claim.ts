// Re-export from @ppeng/agent-loop (SSOT) — keeps instanceof checks working
// across packages because both sides reference the same class declaration.
export { WriterClaimError, assertWriterClaim } from '@ppeng/agent-loop/session';
