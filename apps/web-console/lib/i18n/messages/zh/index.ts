import { auth } from './auth.ts';
import { common } from './common.ts';
import { config } from './config.ts';
import { memory } from './memory.ts';
import { modelFallback } from './modelFallback.ts';
import { more } from './more.ts';
import { nav } from './nav.ts';
import { ops } from './ops.ts';
import { play } from './play.ts';
import { skillProposals } from './skillProposals.ts';
import { teams } from './teams.ts';

export const zh = {
  common,
  auth,
  nav,
  play,
  more,
  memory,
  teams,
  ops,
  skillProposals,
  modelFallback,
  config
} as const;
