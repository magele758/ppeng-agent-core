/**
 * Obsidian / markdown “个人 Wiki”仓库里常见的工具目录：不是用户正文，却会污染 glob 与目录列表。
 */
export const MARKDOWN_VAULT_METADATA_DIR_NAMES = new Set(['.obsidian', '.trash']);

export function posixRelPathCrossesVaultMetadataDir(relPosixPath: string): boolean {
  return relPosixPath.split('/').some((seg) => MARKDOWN_VAULT_METADATA_DIR_NAMES.has(seg));
}

export function isVaultMetadataDirName(entryName: string): boolean {
  return MARKDOWN_VAULT_METADATA_DIR_NAMES.has(entryName);
}
