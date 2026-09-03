import {
  createPagedArtifact,
  formatToolResultArchivePreview,
  type PagedArtifactManifest
} from './paged-artifact.js';
import { resolveIngestionSettings, type IngestionSettingsStore } from '../ingestion/settings.js';

const SKIP_ARCHIVE_TOOLS = new Set(['read_artifact_page', 'search_artifact_content', 'retrieve_tool_result']);

export function maybeArchiveToolResult(input: {
  stateDir: string;
  sessionId: string;
  toolName: string;
  content: string;
  settingsStore?: IngestionSettingsStore;
  onCreated?: (manifest: PagedArtifactManifest) => void;
}): string {
  if (SKIP_ARCHIVE_TOOLS.has(input.toolName)) return input.content;
  const settings = resolveIngestionSettings(input.settingsStore);
  if (!settings.enabled) return input.content;
  if (input.content.length <= settings.toolResultArchiveChars) return input.content;
  try {
    const manifest = createPagedArtifact({
      stateDir: input.stateDir,
      sessionId: input.sessionId,
      sourceTool: input.toolName,
      content: input.content,
      mimeType: 'text/plain',
      pageSizeChars: settings.pageSizeChars,
      fileName: `${input.toolName}.txt`
    });
    input.onCreated?.(manifest);
    return formatToolResultArchivePreview(manifest, settings.archivePreviewChars, input.content);
  } catch {
    return input.content;
  }
}
