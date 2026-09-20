/**
 * Preset dispatcher. Mini is static; normal/full/max are dynamic so `./mini`
 * never pulls sqlite / vm / fs compensation.
 */

import type { AssembledLoop, CreateAssembledLoopInput } from './io.js';
import { parseLoopPreset, type LoopPreset } from './presets.js';
import { createMiniAssembledLoop } from './mini-host.js';

export { createMiniAssembledLoop };

export async function createAssembledLoop(
  input: CreateAssembledLoopInput = {}
): Promise<AssembledLoop> {
  const preset: LoopPreset = parseLoopPreset(input.preset) ?? 'mini';
  switch (preset) {
    case 'mini':
      return createMiniAssembledLoop({ ...input, preset });
    case 'normal': {
      const m = await import('./normal-host.js');
      return m.createNormalAssembledLoop({ ...input, preset });
    }
    case 'full': {
      const m = await import('./full-host.js');
      return m.createFullAssembledLoop({ ...input, preset });
    }
    case 'max': {
      const m = await import('./max-host.js');
      return m.createMaxAssembledLoop({ ...input, preset });
    }
    default: {
      const _never: never = preset;
      return _never;
    }
  }
}
