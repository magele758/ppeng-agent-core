import { extname } from 'node:path';
import type { AttachmentKind, IngestContentPart, PerAttachmentResult, ResolvedAttachment } from './types.js';
import type { AttachmentStatus } from './status.js';

export const INLINE_AFFORDANCE =
  '以上内容已完整内联在本段，请直接基于上文回答；无需再 read_file / list_files / search_files 或起沙箱查找原件。';

export function formatFileContentPrefix(fileName: string, sizeBytes: number, fileType: string): string {
  const size = sizeBytes < 1024 ? `${sizeBytes} B` : `${(sizeBytes / 1024).toFixed(1)} KB`;
  return (
    `【文件分析结果】\n文件名: ${fileName}\n类型: ${fileType}\n大小: ${size}\n---\n` +
    `以下内容为对上述文件的解析/分析结果，请结合文件名和类型理解：\n${INLINE_AFFORDANCE}\n\n`
  );
}

export function textFileTypeLabel(d: { kind: AttachmentKind; fileName: string }): string {
  const ext = extname(d.fileName).toLowerCase().slice(1) || 'txt';
  return `纯文本(.${ext})`;
}

export interface EmitResult extends PerAttachmentResult {
  statuses: AttachmentStatus[];
}

export function emit(d: ResolvedAttachment): EmitResult {
  const parts: IngestContentPart[] = [];
  const statuses: AttachmentStatus[] = [];
  let images = 0;
  let fatalError: Error | undefined;
  const { fileName, index, kind, encoding, route } = d;

  switch (route.mode) {
    case 'unsupported':
      parts.push({
        type: 'text',
        text:
          `【文件未能解析】\n文件名: ${fileName}\n` +
          `原因: ${route.reason || '该文件无法自动提取内容'}\n` +
          `---\n请据此如实告知用户：该文件未能读取到内容；如需处理，请用户说明意图或更换可解析的格式。`
      });
      statuses.push({ fileName, index, state: 'failed', kind, reason: route.reason });
      break;

    case 'workspace': {
      if (route.text !== undefined) {
        const truncatedNote =
          route.truncated === true
            ? `\n\n【注意：以上内容已截断，不是这份文件的全部】` +
              `\n后面还有内容没有展示。不要把已展示的部分当成整份文件下结论；` +
              `需要余下部分时读工作区原件 \`${route.relPath}\`。`
            : '';
        parts.push({
          type: 'text',
          text:
            `【文件已就绪 · 已解析为文本】\n文件名: ${fileName}\n` +
            `原始文件同时保存在当前会话工作区: \`${route.relPath}\`\n` +
            `以下是从该文件中抽取的正文（表格按制表符分列、按行分行；` +
            `日期与数字为单元格存储值，未套用显示格式）：\n${INLINE_AFFORDANCE}\n\n` +
            `${route.text}${truncatedNote}`
        });
        statuses.push({ fileName, index, state: 'ready', kind });
        break;
      }
      if (route.textUnavailable !== undefined) {
        parts.push({
          type: 'text',
          text:
            `【文件已就绪 · 但没能解析出文本】\n文件名: ${fileName}\n` +
            `原始文件已保存到当前会话工作区，相对路径: \`${route.relPath}\`\n` +
            `原因: ${route.textUnavailable}\n` +
            `---\n请如实告诉用户这份文件的内容当前读不到，并把上面的原因转述给他；` +
            `不要猜测或编造它的内容，也不要说它是空文件。`
        });
        statuses.push({ fileName, index, state: 'ready', kind });
        break;
      }
      const pdfNote = route.pdfPlaceholder
        ? `PDF 正文抽取尚未实现（attachment_status=ready，占位）。原件已保存，请如实告知用户当前读不到 PDF 正文，不要编造内容。`
        : `该类型无法直接提取为文本，请用对应能力处理（Excel / Word / PDF），或用文件工具读取工作区原件。`;
      parts.push({
        type: 'text',
        text:
          `【文件已就绪 · 在工作区】\n文件名: ${fileName}\n` +
          `原始文件已保存到当前会话工作区，相对路径: \`${route.relPath}\`\n` +
          `${pdfNote}\n` +
          `若你手上没有可用于该类型的工具，请如实告知用户读不到，不要猜测或编造文件内容。`
      });
      statuses.push({
        fileName,
        index,
        state: 'ready',
        kind,
        reason: route.pdfPlaceholder ? 'pdf_placeholder' : undefined
      });
      break;
    }

    case 'workspace-failed':
      parts.push({
        type: 'text',
        text:
          `【文件未能进入工作区】\n文件名: ${fileName}\n` +
          `原因: ${route.reason}\n` +
          `---\n请如实告知用户暂时无法处理该文件，并请用户稍后重试。`
      });
      statuses.push({ fileName, index, state: 'failed', kind, reason: route.reason });
      break;

    case 'inline-image':
      parts.push({ type: 'image', imageAssetId: route.imageAssetId });
      images++;
      statuses.push({ fileName, index, state: 'ready', kind });
      break;

    case 'inline': {
      const fileType = textFileTypeLabel(d);
      const sizeBytes = Buffer.byteLength(route.text, 'utf-8');
      const prefix = formatFileContentPrefix(fileName, sizeBytes, fileType);
      parts.push({ type: 'text', text: prefix + route.text });
      statuses.push({ fileName, index, state: 'ready', kind, encoding });
      break;
    }

    case 'archive':
      parts.push({ type: 'text', text: route.preview });
      statuses.push({ fileName, index, state: 'ready', kind, encoding });
      break;

    case 'archive-failed':
      if (d.kind === 'rawtext') {
        const sizeBytes = Buffer.byteLength(d.decodedText ?? '', 'utf-8');
        fatalError = new Error(`文件 ${fileName} 超过内联上限 (${sizeBytes} bytes) 且归档失败，请分段上传`);
        statuses.push({ fileName, index, state: 'failed', kind, reason: route.reason });
      } else {
        statuses.push({ fileName, index, state: 'degraded', kind, reason: route.reason });
      }
      break;

    case 'skip':
      statuses.push({ fileName, index, state: 'degraded', kind, reason: route.reason });
      break;

    default: {
      const _never: never = route;
      void _never;
      statuses.push({ fileName, index, state: 'degraded', kind, reason: '无可处理来源' });
    }
  }

  return { index, parts, images, fatalError, statuses };
}
