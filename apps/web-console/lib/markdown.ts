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

export function renderMarkdown(src: string): string {
  ensureConfigured();
  const text = String(src ?? '');
  if (!text.trim()) return '';
  try {
    const html = marked.parse(text, { async: false }) as string;
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  } catch {
    return escapeHtml(text);
  }
}
