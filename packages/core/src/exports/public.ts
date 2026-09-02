/**
 * Whitelisted public API of `@ppeng/agent-core`.
 *
 * Embedders should depend on this surface (or on the L0–L4 subpaths
 * `./types` `./session` `./turn` `./loop`). Internal store classes
 * (`SqliteStateStore`, `stores/*`) and sandbox provider implementations
 * are not re-exported — tests import those via deep paths such as
 * `../dist/storage.js`.
 */

// --- primitives ---
export { envInt, envBool } from '../env.js';
export {
  AppError,
  NotFoundError,
  ValidationError,
  PayloadTooLargeError,
  ConflictError,
  AuthorizationError,
  TimeoutError,
  errorMessage,
  httpStatusFromError
} from '../errors.js';
export { createLogger, setLogLevel, resetLogLevel } from '../logger.js';
export type { LogLevel, Logger } from '../logger.js';

// --- L0 types (AgentSpec / ToolContract / SessionMessage / ModelAdapter …) ---
export * from '../types.js';
export type {
  ApiMessagePart,
  ApiChatMessage,
  ApiSessionSummary,
  ApiAgentInfo,
  ApiTaskSummary,
  ApiSocialPostScheduleItem,
  ApiApprovalItem,
  ApiMailItem
} from '../api-types.js';
export { filterSessionsByQuery } from '../session-query.js';
export type { SessionSearchable } from '../session-query.js';

// --- L1/L2 session algebra + L3 turn + L4 loop (also `@ppeng/agent-core/{session,turn,loop}`) ---
export * from '../session/index.js';
export * from '../turn/index.js';
export { createAgentLoop, AgentLoopHandle, AgentLoopLatch } from '../loop.js';
export type { AgentLoopHost, AgentStepEvent } from '../loop.js';

// Session symbols daemon already imports but the L2 barrel does not re-export.
export {
  DEFAULT_STEER_DRAIN_POLICY,
  parseSteerDrainPolicy
} from '../session/steer-drain.js';
export type { NotSubmittedReason } from '../session/steer-ack.js';
export { selectClosedPrefixRange } from '../session/auto-compact.js';

// --- L5 host (全家桶) ---
export { RawAgentRuntime } from '../runtime.js';
export type { RuntimeOptions } from '../runtime.js';

// --- Domain bundles + builtin personas ---
export { mergeDomainBundles } from '../domain.js';
export type { DomainBundle, MergedDomainBundles } from '../domain.js';
export { builtinAgents } from '../builtin-agents.js';
export {
  builtinSkills,
  loadAllSkills,
  matchSkills,
  loadAgentsDirSkills,
  loadWorkspaceSkills,
  mergeSkillsByName,
  parseSkillFrontmatter
} from '../skills/builtin-skills.js';

// --- Model adapters ---
export {
  createModelAdapterFromEnv,
  HeuristicModelAdapter,
  OpenAICompatibleAdapter,
  AnthropicCompatibleAdapter,
  HybridModelRouterAdapter,
  textSummaryFromParts,
  normalizeOpenAiHttpKind,
  HEURISTIC_LONG_BASH_MARKER,
  HEURISTIC_LONG_BASH_COMMAND
} from '../model/model-adapters.js';
export type { OpenAiHttpKind } from '../model/model-adapters.js';
export {
  MODEL_PROVIDERS_KEY,
  HEURISTIC_PROVIDER_ID,
  ENV_FALLBACK_PROVIDER_ID,
  parseProviderKind,
  suggestProviderName,
  parseModelRef,
  modelRefFromSession,
  heuristicProvider,
  heuristicRef,
  maskApiKey,
  publicProvider,
  emptyCatalog,
  normalizeCatalog,
  normalizeProvider,
  readModelCatalog,
  writeModelCatalog,
  hasPersistedModelCatalog,
  upsertProvider,
  patchProvider,
  deleteProvider,
  setCatalogDefaultRef,
  mergeScannedModels,
  envFallbackProvider,
  findProvider,
  createAdapterFromProvider,
  createModelAdapterFromEnvOrHeuristic,
  resolveSessionModelAdapter,
  pickerOptions,
  publicCatalogPayload,
  resolveDefaultModelRef,
  mergeModelRefMetadata
} from '../model/provider-catalog.js';
export type {
  ModelProviderKind,
  CatalogModel,
  ModelRef,
  ModelProvider,
  ModelProviderCatalog,
  ModelProviderPatch,
  ModelProvidersStore,
  PublicModelProvider,
  ModelPickerOption
} from '../model/provider-catalog.js';
export { parseRemoteModelList, listRemoteModels } from '../model/list-models.js';
export type { RemoteModel, ListRemoteModelsResult } from '../model/list-models.js';
export { parseModelToolArguments } from '../model/parse-tool-arguments.js';
export {
  normalizeOpenAiUsage,
  normalizeAnthropicUsage,
  isTruncatedFinish,
  mergeUsage,
  splitCumulativePromptTokens
} from '../model/usage.js';
export {
  pickUpstreamRequestIdFromHeaders,
  unwrapNestedUpstreamError,
  pickUpstreamRequestIdFromRecord,
  pickUpstreamRequestIdFromJsonText,
  wrapResponseToCaptureUpstreamRequestId,
  normalizeUpstreamRequestId,
  resolveUpstreamRequestId
} from '../model/upstream-request-id.js';
export type { HeaderGetter, NestedUpstreamError } from '../model/upstream-request-id.js';
export {
  DEFAULT_MODEL_PRICES,
  resolveModelPrice,
  estimateUsageCostUsd,
  mergeCostUsd
} from '../model/token-cost.js';
export type { TokenPricePerMillion, CostEstimate } from '../model/token-cost.js';
export { estimateTokensFromText, estimateMessageTokens } from '../model/token-estimate.js';

// --- Approval / permission ---
export {
  parseApprovalPolicyFromEnv,
  policyRequiresApproval,
  policySkipsAutoApproval,
  contextHasApprovalPolicy
} from '../approval/approval-policy.js';
export type { ApprovalPolicy, ApprovalPolicyRule } from '../approval/approval-policy.js';
export {
  loadPolicyFromRepo,
  mergeApprovalPolicies,
  filePolicyRequiresBashApproval,
  filePolicyRequiresPathApproval
} from '../approval/policy-loader.js';
export type {
  BashCommandPatternRule,
  PathApprovalRule,
  FileApprovalPolicy
} from '../approval/policy-loader.js';
export {
  parsePermissionMode,
  resolvePermissionMode,
  isReadOnlyTool,
  isEditTool,
  describePermissionMode,
  shiftPermissionMode,
  comparePermissionMode,
  applyPermissionModeGate,
  explainToolUnderMode
} from '../approval/permission-mode.js';
export type { PermissionMode, PermissionModeGate } from '../approval/permission-mode.js';

// --- Skills routing / eval (daemon `/api/eval/skills`) ---
export {
  skillRoutingModeFromEnv,
  skillRoutingTopKFromEnv,
  skillLoadStrictFromEnv,
  skillRoutingFusionFromEnv,
  buildSkillRouting,
  buildSkillRoutingWithFusion,
  buildSkillRoutingWithRobustness,
  buildSkillRoutingWithToolQuality
} from '../skills/skill-router.js';
export type {
  SkillRoutingMode,
  SkillRoutingResult,
  SkillRoutingOptions,
  RobustRoutingOptions,
  ToolAwareRoutingOptions
} from '../skills/skill-router.js';
export {
  tokenize,
  uniqueTokens,
  buildSkillRelationshipCache,
  needsRebuild,
  routeSkillsLexical,
  computeParticleRobustness,
  assessRoutingConfidence,
  assessRoutingConfidenceWithRobustness,
  routeSkillsWithFusion
} from '../skills/skill-matcher.js';
export type {
  SkillRelationship,
  SkillRelationshipCache,
  SkillCycle,
  RoutedSkill,
  RoutingConfidence,
  RoutingConfidenceInfo
} from '../skills/skill-matcher.js';
export {
  DEFAULT_SKILL_EVAL_CASES,
  generateSyntheticTestCases,
  runSkillEval,
  compareSkillEvalModes
} from '../skills/skill-eval.js';
export type {
  SkillEvalTestCase,
  SkillEvalResultCase,
  SkillEvalSummary,
  SkillEvalOptions,
  MultiModeSkillEvalResult
} from '../skills/skill-eval.js';

// --- Storage interfaces + daemon wiring (not SqliteStateStore) ---
export type {
  EventBufferMeta,
  EventBufferEventRow,
  EventBufferAppendInput,
  EventBufferRepository,
  TieredAssetDescriptor,
  AssetStorage,
  SkillCatalogRow,
  SkillRegistryClient
} from '../storage/interfaces.js';
export {
  createProviderConfigFromEnv,
  defaultTenantIdFromEnv,
  defaultUserIdFromEnv,
  validateProviderConfig
} from '../storage/provider-config.js';
export type {
  DeploymentMode,
  SessionStoreProvider,
  EventBufferProvider,
  SkillRegistryProvider,
  AssetStorageProvider,
  DispatchLockProvider,
  ProviderConfig
} from '../storage/provider-config.js';
export { createCoreStorageContext } from '../storage/repository-factory.js';
export type { CoreStorageContext } from '../storage/repository-factory.js';

// --- Sandbox public contract (factory + sanitizer; not provider classes) ---
export { sanitizeSpawnEnv, getInjectionVarNames } from '../sandbox/env-sanitizer.js';
export type { SanitizeEnvOptions } from '../sandbox/env-sanitizer.js';
export {
  REDACT_MIN_VALUE_LENGTH,
  collectRedactionTargets,
  redactEnvValues,
  redactToolContent
} from '../sandbox/result-redaction.js';
export type { RedactionTarget } from '../sandbox/result-redaction.js';
export type {
  AgentSandboxKind,
  AgentSandboxExecResult,
  AgentSandboxExecRequest,
  AgentSandbox
} from '../sandbox/agent-sandbox-types.js';
export {
  agentSandboxKindFromEnv,
  createAgentSandboxFromEnv
} from '../sandbox/create-agent-sandbox.js';

// --- Optional tool groups (daemon `/api` payload) ---
export {
  optionalToolGroupsFeatureEnabled,
  loadOptionalToolGroupsFromEnv,
  optionalToolNamesFromGroups,
  buildOptionalToolGroupsPayload,
  parseDefaultEnabledOptionalGroups,
  mergeEnabledOptionalToolGroups,
  resolveOptionalToolGroups,
  filterToolsByOptionalGroups
} from '../tools/optional-tool-groups.js';
export type {
  OptionalToolGroupItemDef,
  OptionalToolGroupDef,
  OptionalToolGroupsPayload,
  ResolvedOptionalToolGroups
} from '../tools/optional-tool-groups.js';

// --- IM channel kernel + gateway config ---
export { processChannelTurn, parseGenericWebhookInbound } from '../channels/channel-turn.js';
export type {
  ChannelInboundKind,
  ChannelInboundEnvelope,
  ChannelOutboundEnvelope,
  ChannelTurnResult,
  ChannelTurnKernelDeps
} from '../channels/channel-turn.js';
export {
  gatewayConfigPath,
  findGatewayConfigPath,
  loadGatewayChannelIdsSync
} from '../gateway-config-channels.js';

// --- Social schedule (daemon routes use the type; runtime owns delivery) ---
export {
  SOCIAL_POST_SCHEDULE_METADATA_KEY,
  SOCIAL_POST_TASK_KIND,
  BUILTIN_SOCIAL_CHANNELS,
  normalizePublishAtToUtc,
  isValidIsoInstant,
  normalizeSocialChannels,
  validateNormalizedSocialChannels,
  buildSocialPostSchedule,
  readSocialPostSchedule,
  taskTitleForSocialSchedule,
  runSocialPostScheduleDelivery
} from '../social-schedule.js';
export type {
  SocialPostApprovalState,
  SocialPostDispatchState,
  SocialPostChannelDispatch,
  SocialPostScheduleV1,
  BuildSocialScheduleInput,
  SocialScheduleBuildResult,
  SocialPostDeliverFn
} from '../social-schedule.js';

// --- Product subsystems (types + stores used as daemon route APIs) ---
export * from '../discovery/index.js';
export * from '../swarm/index.js';
export * from '../memory/index.js';
export * from '../orchestrator/index.js';
export * from '../deepresearch/index.js';
export * from '../goal/index.js';
export * from '../a2ui/index.js';

// --- Plugins / doctor / extensions ---
export {
  loadPluginFromDir,
  discoverPlugins,
  mergePlugins,
  pluginDirsFromEnv
} from '../plugins/plugin-loader.js';
export type { PluginManifest, LoadedPlugin } from '../plugins/plugin-loader.js';
export { runDoctor, formatDoctorReport } from '../doctor/doctor.js';
export type { DoctorSeverity, DoctorCheck, DoctorReport, DoctorOptions } from '../doctor/doctor.js';
export { ExtensionRegistry, createExtensionRegistry } from '../extensions/extension-registry.js';
export type {
  ExtensionPhase,
  ExtensionContext,
  ExtensionResult,
  ExtensionHandlerFn,
  ExtensionSpec
} from '../extensions/extension-registry.js';
