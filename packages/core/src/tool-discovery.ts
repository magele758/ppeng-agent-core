/**
 * Protocol for learned tool performance metrics used by tool-aware skill routing.
 */
export interface ToolDiscoveryProtocol {
  /**
   * Estimate tool quality for a skill given tokenized query terms.
   * When there is no usable signal, return confidence 0 so routing skips the boost.
   */
  estimateQuality(
    skillName: string,
    queryTokens: readonly string[]
  ): { quality: number; confidence: number };
}
