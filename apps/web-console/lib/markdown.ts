import DOMPurify from 'dompurify';
import { marked } from 'marked';

let configured = false;

function ensureConfigured() {
  if (configured || typeof window === 'undefined') return;
  marked.setOptions({ gfm: true, breaks: true });
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  configured = true;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * When the model returns a full HTML5 document (common if the user asks for
 * "structured HTML"), embedding `<html>…</html>` inside a chat bubble is invalid
 * and breaks layout. If the string looks like a complete document, return the
 * inner body (or the document shell with `<head>` removed); otherwise `null`.
 */
export function extractHtmlDocumentFragment(src: string): string | null {
  const trimmed = String(src ?? '').trim();
  if (!trimmed) return null;
  const startsAsDoc =
    /^<!DOCTYPE\s+html\b/i.test(trimmed) || /^<html\b/i.test(trimmed);
  if (!startsAsDoc) return null;
  if (!/<\/html\s*>$/i.test(trimmed)) return null;

  const bodyMatch = trimmed.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyInner = bodyMatch?.[1]?.trim();
  if (bodyInner) return bodyInner;

  let inner = trimmed.replace(/^<!DOCTYPE[^>]*>\s*/i, '');
  inner = inner.replace(/^<html[^>]*>/i, '').replace(/<\/html\s*>$/i, '');
  inner = inner.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '').trim();
  return inner.length ? inner : null;
}

export function renderMarkdown(src: string): string {
  ensureConfigured();
  const text = String(src ?? '');
  if (!text.trim()) return '';
  try {
    const docFrag = extractHtmlDocumentFragment(text);
    if (docFrag !== null) {
      return DOMPurify.sanitize(docFrag, { USE_PROFILES: { html: true } });
    }
    const html = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    return escapeHtml(text);
  }
}
