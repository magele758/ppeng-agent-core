# @ppeng/agent-loop

Embeddable agent loop: turn kernel, model adapters, streaming watchdogs, session state, and tool execution.

Workspace name stays `@ppeng/agent-loop`. The public npm package is **`@mage-ai-lab/agent-loop`**.

Browser / extension hosts should import the mini entry only:

```js
import { createMiniAssembledLoop } from '@mage-ai-lab/agent-loop/mini';
```

Do not bundle the `.` / `./full` / `./max` entries in a browser — they pull Node builtins.
