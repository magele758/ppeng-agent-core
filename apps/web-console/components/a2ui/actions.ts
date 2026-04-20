import { api } from '@/lib/api';
import type { ActionPayload } from './types';

export async function postA2uiAction(sessionId: string, payload: ActionPayload): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/a2ui/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
