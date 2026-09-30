import type { Messages } from '../types.ts';
import { auth } from './auth.ts';
import { common } from './common.ts';
import { memory } from './memory.ts';
import { modelFallback } from './modelFallback.ts';
import { more } from './more.ts';
import { nav } from './nav.ts';
import { ops } from './ops.ts';
import { play } from './play.ts';
import { skillProposals } from './skillProposals.ts';
import { teams } from './teams.ts';

export const en = {
  common,
  auth,
  nav,
  play,
  more,
  memory,
  teams,
  ops,
  skillProposals,
  modelFallback
} as const satisfies Messages;
