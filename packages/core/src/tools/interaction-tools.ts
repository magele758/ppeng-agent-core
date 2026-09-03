import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ToolContract } from '../types.js';

export const ASK_USER_REPLY_META = 'askUserReply';
export const ASK_USER_PENDING_META = 'askUserPending';

interface UserFact {
  category: string;
  content: string;
  domain?: string;
  at: string;
}

interface StoredCredential {
  name: string;
  description?: string;
  value: string;
  at: string;
}

function userInfoPath(stateDir: string, sessionId: string): string {
  return join(stateDir, 'user-info', `${sessionId}.json`);
}

function credentialsPath(stateDir: string, sessionId: string): string {
  return join(stateDir, 'credentials', `${sessionId}.json`);
}

async function readJsonArray<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

export function createInteractionTools(): ToolContract<any>[] {
  const askUser: ToolContract<{
    question?: string;
    title?: string;
    questions?: Array<{ key: string; question: string; options?: Array<{ label: string }> }>;
  }> = {
    name: 'ask_user',
    description:
      '当缺少必要信息、有歧义或需要用户确认时提问并暂停本轮。可传 question 纯文本，或 questions 数组（含 options）。用户回复后在新一轮继续。复用 waiting_approval 中断，不另造循环。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '单题简写' },
        title: { type: 'string' },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              question: { type: 'string' },
              options: {
                type: 'array',
                items: { type: 'object', properties: { label: { type: 'string' } } }
              }
            }
          }
        }
      }
    },
    approvalMode: 'always',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const reply = context.session.metadata?.[ASK_USER_REPLY_META];
      const question =
        (typeof args.question === 'string' && args.question.trim()) ||
        (Array.isArray(args.questions) && args.questions[0] && typeof args.questions[0].question === 'string'
          ? args.questions[0].question
          : '') ||
        '需要你补充信息';
      if (typeof reply === 'string' && reply.trim()) {
        return { ok: true, content: `用户回复：${reply.trim()}` };
      }
      return {
        ok: false,
        content: `等待用户回复：${question}`
      };
    }
  };

  const saveUserInfo: ToolContract<{
    category: string;
    content: string;
    domain?: string;
  }> = {
    name: 'save_user_info',
    description:
      '将对话中获得的用户事实/偏好保存到会话本地（不进模型凭据面）。category: fact | preference | entity | concept。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['fact', 'preference', 'entity', 'concept'] },
        content: { type: 'string' },
        domain: { type: 'string' }
      },
      required: ['category', 'content']
    },
    approvalMode: 'never',
    sideEffectLevel: 'none',
    async execute(context, args) {
      const content = String(args.content ?? '').trim();
      if (!content) return { ok: false, content: 'content 不能为空' };
      const file = userInfoPath(context.stateDir, context.session.id);
      const items = await readJsonArray<UserFact>(file);
      items.push({
        category: String(args.category ?? 'fact'),
        content,
        domain: typeof args.domain === 'string' ? args.domain : undefined,
        at: new Date().toISOString()
      });
      await writeJson(file, items);
      return { ok: true, content: `已保存用户信息（共 ${items.length} 条）` };
    }
  };

  const collectCredentials: ToolContract<{
    name: string;
    value: string;
    description?: string;
  }> = {
    name: 'collect_credentials',
    description:
      '在用户明确给出值时保存凭据名与值到本机会话保险库。工具返回值只含名字，不含明文。高敏值建议走设置页。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['name', 'value']
    },
    approvalMode: 'always',
    sideEffectLevel: 'system',
    async execute(context, args) {
      const name = String(args.name ?? '').trim().toUpperCase();
      const value = String(args.value ?? '');
      if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        return { ok: false, content: '凭据名须为英文大写+下划线，如 NOTION_TOKEN' };
      }
      if (!value.trim()) return { ok: false, content: 'value 不能为空' };
      const file = credentialsPath(context.stateDir, context.session.id);
      const items = await readJsonArray<StoredCredential>(file);
      const next = items.filter((c) => c.name !== name);
      next.push({
        name,
        value,
        description: typeof args.description === 'string' ? args.description : undefined,
        at: new Date().toISOString()
      });
      await writeJson(file, next);
      return { ok: true, content: `已保存凭据 ${name}（共 ${next.length} 个名字，值未回传）` };
    }
  };

  return [askUser, saveUserInfo, collectCredentials];
}
