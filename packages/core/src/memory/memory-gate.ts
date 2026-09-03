/**
 * Write-path gate: reject chitchat / shallow execution / low-value / thin tool use.
 * Algorithms absorbed from ai-agent-node memory-gate (not a file copy).
 */

export const MEMORY_CONTEXT_APPENDIX_PREFIX =
  '本轮相关记忆与用户背景（仅供参考；如与用户最新指令冲突，以最新指令为准）：';

export const CORE_IDENTITY_MIN_IMPORTANCE = 0.65;
export const MIN_TASK_MEMORY_TOOLS = 3;

const SYSTEM_TEMPLATE_MARKERS = [
  '[系统]',
  'SubAgent',
  'One or more SubAgent',
  'spawn_subagent',
  'spawn_skill_subagents'
];

const CORRECTION_KEYWORDS = [
  '不对',
  '错了',
  '应该是',
  '改成',
  '纠正',
  '更正',
  '不要这样',
  '别这样',
  '重新做',
  '重来',
  '不是这样',
  '你理解错了',
  '你搞错了'
];

const LOW_VALUE_SUMMARY_MARKERS = ['没有产出有效结果', '未完成用户目标', '无有效结果', '最终未完成'];

const TOOL_CALL_LEAK_RE = /tool_call|<invoke\s|<\/?minimax:|function_call/i;
const BARE_FAIL_SUMMARY_RE = /^任务[「"'].{0,60}[」"']执行失败/;
const TRIVIAL_TASK_RE =
  /^(hi|hello|hey|嗨|哈喽|早上好|下午好|晚上好|你好|您好|你好呀|在吗|测试|test|debug|ping|哈哈|嗯+|哦+|谢谢|thanks|thank you)\s*[!！.。?？~～]*$/i;

const SEMANTIC_NOISE_PATTERN =
  String.raw`sidecar\s*(新增)?测试[-_]?\d*|(新增)?测试[-_]?\d{6,}|\b(test|debug|ping|smoke|canary)[-_]?\d{4,}\b|联调测试|压测标记|dummy|placeholder|lorem\s*ipsum|随便测|测一下|测试一下|hello\s*world|^[-_]?\d{6,}$`;
const SEMANTIC_NOISE_PART_RE = new RegExp(SEMANTIC_NOISE_PATTERN, 'i');
const SEMANTIC_NOISE_STRIP_RE = new RegExp(SEMANTIC_NOISE_PATTERN, 'gi');

const MIN_FALLBACK_BODY = 40;
const MAX_FALLBACK_BODY = 280;

export type MemoryWriteKind = 'scratch' | 'semantic' | 'task' | 'correction';

export interface MemoryGateDecision {
  allow: boolean;
  reason: string;
}

export interface TaskMemoryDepthOpts {
  toolsUsed?: string[];
  minTaskTools?: number;
}

export function isSystemTemplateContent(content: string): boolean {
  if (!content) return false;
  return SYSTEM_TEMPLATE_MARKERS.some((m) => content.includes(m));
}

export function isTrivialChitchat(task: string): boolean {
  const t = task.trim();
  return t.length > 0 && t.length <= 24 && TRIVIAL_TASK_RE.test(t);
}

export function meetsTaskExperienceDepth(opts?: TaskMemoryDepthOpts): boolean {
  if (!Array.isArray(opts?.toolsUsed)) return true;
  const min = opts?.minTaskTools ?? MIN_TASK_MEMORY_TOOLS;
  const toolCount = [...new Set(opts!.toolsUsed!.map((t) => String(t || '').trim()).filter(Boolean))].length;
  return toolCount >= min;
}

export function isLowValueSemanticContent(content: string): boolean {
  const t = (content || '').trim();
  if (!t || t.length < 4) return true;
  if (TOOL_CALL_LEAK_RE.test(t)) return true;
  if (SEMANTIC_NOISE_PART_RE.test(t) && t.length <= 120) return true;
  if (/^(sidecar)?(新增)?测试[-_]?\d{6,}$/i.test(t.replace(/\s+/g, ''))) return true;
  return false;
}

function stripNoiseSpans(part: string): string {
  let s = part.replace(SEMANTIC_NOISE_STRIP_RE, ' ');
  s = s
    .replace(/\s*[，,；;]\s*[，,；;]+/g, '，')
    .replace(/^[，,；;\s]+|[，,；;\s]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s;
}

export function sanitizeSemanticFactContent(content: string): string {
  const t = (content || '').trim();
  if (!t) return '';
  const parts = t
    .split(/[；;。\n]+/)
    .map((s) => stripNoiseSpans(s.trim()))
    .filter(Boolean)
    .filter((p) => !isLowValueSemanticContent(p) && !SEMANTIC_NOISE_PART_RE.test(p));
  if (parts.length === 0) return '';
  const out = parts.join('；');
  if (isLowValueSemanticContent(out)) return '';
  return out.length > 600 ? out.slice(0, 600) : out;
}

export function isLowValueTaskMemoryContent(
  content: string,
  taskContent: string,
  opts?: TaskMemoryDepthOpts & { outcome?: 'success' | 'failure' | 'partial' }
): boolean {
  const summary = (content || '').trim();
  const task = (taskContent || '').trim();
  if (!summary && !task) return true;
  if (TOOL_CALL_LEAK_RE.test(summary)) return true;
  if (summary.includes('无任何工具')) return true;
  if (isTrivialChitchat(task)) return true;
  if (!meetsTaskExperienceDepth(opts)) return true;

  const noTools = Array.isArray(opts?.toolsUsed) && opts!.toolsUsed!.length === 0;
  const toolCount = Array.isArray(opts?.toolsUsed) ? opts!.toolsUsed!.length : undefined;
  const weakSummary = LOW_VALUE_SUMMARY_MARKERS.some((m) => summary.includes(m));
  if (weakSummary && (noTools || toolCount === 1)) return true;
  if (noTools && opts?.outcome === 'failure') return true;
  if (noTools && BARE_FAIL_SUMMARY_RE.test(summary)) return true;
  return false;
}

export function shouldPersistTaskMemory(
  content: string,
  taskContent: string,
  opts?: TaskMemoryDepthOpts & {
    hasLlmSummary?: boolean;
    outcome?: 'success' | 'failure' | 'partial';
  }
): boolean {
  if (isSystemTemplateContent(content) || isSystemTemplateContent(taskContent)) return false;
  if (isLowValueTaskMemoryContent(content, taskContent, opts)) return false;
  if (opts?.hasLlmSummary) {
    const summary = content.trim();
    if (summary.length < 20) return false;
    if (/^任务(完成|失败)\s*:/.test(summary) && summary.length < 60) return false;
    return true;
  }
  const body = (content || taskContent).trim();
  if (body.length < MIN_FALLBACK_BODY) return false;
  if (body.length > MAX_FALLBACK_BODY) return false;
  if (/^用户任务\s*:/.test(body)) return false;
  return true;
}

export function shouldPersistUserCorrection(content: string, metadata?: Record<string, unknown>): boolean {
  if (metadata?.isCorrection === true || metadata?.source === 'user_correction') return true;
  const text = content.trim();
  if (!text) return false;
  return CORRECTION_KEYWORDS.some((kw) => text.includes(kw));
}

/**
 * Unified write gate for memory_set / auto-write.
 * scratch notes are allowed unless they are chitchat / template / tool-leak.
 */
export function evaluateMemoryWrite(input: {
  value: string;
  key?: string;
  kind?: MemoryWriteKind;
  taskContent?: string;
  toolsUsed?: string[];
  minTaskTools?: number;
  outcome?: 'success' | 'failure' | 'partial';
  metadata?: Record<string, unknown>;
}): MemoryGateDecision {
  const value = (input.value || '').trim();
  const task = (input.taskContent || value).trim();
  const kind = input.kind ?? inferWriteKind(input.key, value, input.metadata);

  if (!value) return { allow: false, reason: 'empty' };
  if (isSystemTemplateContent(value) || isSystemTemplateContent(task)) {
    return { allow: false, reason: 'system_template' };
  }
  if (TOOL_CALL_LEAK_RE.test(value)) return { allow: false, reason: 'tool_call_leak' };

  if (kind === 'correction' || shouldPersistUserCorrection(value, input.metadata)) {
    return { allow: true, reason: 'user_correction' };
  }

  if (isTrivialChitchat(task) || isTrivialChitchat(value)) {
    return { allow: false, reason: 'trivial_chitchat' };
  }

  if (kind === 'task') {
    if (
      !shouldPersistTaskMemory(value, task, {
        toolsUsed: input.toolsUsed,
        minTaskTools: input.minTaskTools,
        outcome: input.outcome
      })
    ) {
      if (!meetsTaskExperienceDepth({ toolsUsed: input.toolsUsed, minTaskTools: input.minTaskTools })) {
        return { allow: false, reason: 'shallow_execution' };
      }
      return { allow: false, reason: 'low_value' };
    }
    return { allow: true, reason: 'task_ok' };
  }

  if (kind === 'semantic') {
    const cleaned = sanitizeSemanticFactContent(value);
    if (!cleaned) return { allow: false, reason: 'low_value_semantic' };
    return { allow: true, reason: 'semantic_ok' };
  }

  // scratch / notes: reject chitchat and very short noise
  if (value.length < 4) return { allow: false, reason: 'too_short' };
  if (isLowValueSemanticContent(value) && value.length <= 40) {
    return { allow: false, reason: 'low_value' };
  }
  return { allow: true, reason: 'scratch_ok' };
}

function inferWriteKind(
  key?: string,
  value?: string,
  metadata?: Record<string, unknown>
): MemoryWriteKind {
  if (metadata?.isCorrection === true || metadata?.source === 'user_correction') return 'correction';
  const k = (key || '').toLowerCase();
  if (k.startsWith('fact:') || k.startsWith('pref:') || k.startsWith('preference:') || k.startsWith('profile:')) {
    return 'semantic';
  }
  if (k.startsWith('task:') || k.startsWith('episodic:')) return 'task';
  if (value && shouldPersistUserCorrection(value, metadata)) return 'correction';
  return 'scratch';
}

const CORE_CATEGORY_ORDER = ['preference', 'fact', 'entity', 'concept'] as const;
const CORE_CATEGORY_LABELS: Record<(typeof CORE_CATEGORY_ORDER)[number], string> = {
  preference: '**用户偏好**',
  fact: '**用户信息**',
  entity: '**相关实体**',
  concept: '**领域概念与人设**'
};

export function formatCoreRecallSection(
  items: Array<{ category: string; content: string; importance: number }>,
  maxChars: number
): string {
  const header = '## 用户个人背景（来自历史会话记忆）\n\n';
  const footer = '\n\n请在执行任务时结合以上背景信息，无需重复询问用户已知内容。';
  const budget = Math.max(0, maxChars - header.length - footer.length - 20);

  const byCat = new Map<string, Array<{ content: string; importance: number }>>();
  for (const cat of CORE_CATEGORY_ORDER) byCat.set(cat, []);
  for (const it of items) {
    if (!(CORE_CATEGORY_ORDER as readonly string[]).includes(it.category)) continue;
    byCat.get(it.category)!.push({ content: it.content, importance: it.importance });
  }
  for (const list of byCat.values()) list.sort((a, b) => b.importance - a.importance);

  type Line = {
    cat: (typeof CORE_CATEGORY_ORDER)[number];
    text: string;
    importance: number;
    identity: boolean;
  };
  const lines: Line[] = [];
  for (const cat of CORE_CATEGORY_ORDER) {
    for (const row of byCat.get(cat) || []) {
      lines.push({
        cat,
        text: `- ${row.content}`,
        importance: row.importance,
        identity: cat === 'preference' || row.importance >= CORE_IDENTITY_MIN_IMPORTANCE
      });
    }
  }
  lines.sort((a, b) => {
    if (a.identity !== b.identity) return a.identity ? -1 : 1;
    if (a.importance !== b.importance) return b.importance - a.importance;
    return CORE_CATEGORY_ORDER.indexOf(a.cat) - CORE_CATEGORY_ORDER.indexOf(b.cat);
  });

  const selected: Line[] = [];
  let used = 0;
  for (const line of lines) {
    const labelCost = selected.some((s) => s.cat === line.cat) ? 0 : CORE_CATEGORY_LABELS[line.cat].length + 1;
    const cost = labelCost + line.text.length + 1;
    if (selected.length > 0 && used + cost > budget) continue;
    selected.push(line);
    used += cost;
  }
  if (selected.length === 0) return '';

  const sections: string[] = [];
  for (const cat of CORE_CATEGORY_ORDER) {
    const catLines = selected.filter((s) => s.cat === cat);
    if (catLines.length === 0) continue;
    sections.push(CORE_CATEGORY_LABELS[cat]);
    for (const l of catLines) sections.push(l.text);
  }
  const raw = `${header}${sections.join('\n')}${footer}`;
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n...[用户背景已截断]` : raw;
}

export function isMemoryContextAppendixText(text: string): boolean {
  return text.trimStart().startsWith(MEMORY_CONTEXT_APPENDIX_PREFIX) || text.trimStart().startsWith('[memory appendix]');
}
