import type { SkillSpec } from '@ppeng/agent-core';

const RUNBOOK = `# SRE Runbook (compact)

Use this as a checklist; cite specific PromQL / LogQL / kubectl results in your reply.

## 1. Triage priorities

1. **Stop the bleeding**: error rate, queue saturation, customer impact first.
2. **Confirm scope**: single replica, single AZ, single tenant, or global?
3. **Recent change?**: deploys, config, traffic shift, dependency outage.
4. **Write hypothesis** with the metric/log line that supports it.

## 2. RED method (request-driven services)

| Signal | PromQL template |
|--------|-----------------|
| Rate (req/s) | \`sum(rate(http_requests_total{service="$svc"}[5m]))\` |
| Errors | \`sum(rate(http_requests_total{service="$svc",status=~"5.."}[5m]))\` / above |
| Duration p95 | \`histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="$svc"}[5m])) by (le))\` |

## 3. USE method (resources: CPU, memory, IO, network)

| Signal | PromQL template |
|--------|-----------------|
| CPU util | \`avg by (pod)(rate(container_cpu_usage_seconds_total{pod=~"$pod"}[5m]))\` |
| Memory saturation | \`container_memory_working_set_bytes{pod=~"$pod"} / container_spec_memory_limit_bytes\` |
| FS errors | \`rate(node_disk_io_time_seconds_total[5m])\` per device |

## 4. Logs (LogQL)

- Error pattern by service: \`sum by (service)(count_over_time({app="$svc"} |~ "(?i)error|panic|fatal" [5m]))\`
- Slow request samples: \`{app="$svc"} | json | duration > 1\`
- Recent crashloop reasons: pull \`kubectl describe pod $pod\` first, then logs.

## 5. Decision tree (5xx spike)

1. Compare \`Errors / Rate\` → is it the rate spiking too? If yes → upstream / load.
2. Per-instance error rate via \`by (pod)\` — single pod = restart it; many = deploy / config.
3. Check k8s events: \`kubectl get events -n $ns --sort-by=.lastTimestamp | tail\`.
4. Check dependency latency (DB, cache, downstream service).
5. If a recent deploy is suspect, surface rollback candidate; do **not** roll back yourself — propose for approval.

## 6. Postmortem template

\`\`\`md
## Summary
- Customer impact, duration, severity.

## Timeline (UTC)
- HH:MM event ...

## Root cause
...

## Trigger vs. contributing factors
- Trigger: ...
- Contributing: ...

## Action items
- [ ] Detection: ...
- [ ] Mitigation: ...
- [ ] Prevention: ...
\`\`\`

## 7. Boundaries

- **Never** run mutating kubectl verbs from \`k8s_get\` (the tool blocks them).
- For real fixes (rollback, scale, restart), draft the exact command and ask the human to approve.
- Quote raw metric/log evidence; do not paraphrase numbers.
`;

export const sreSkills: SkillSpec[] = [
  {
    id: 'sre-runbook',
    name: 'SRE Runbook',
    description:
      'Triage decision tree (RED / USE) plus PromQL / LogQL / kubectl templates for on-call SRE work and postmortems.',
    aliases: ['sre-runbook', 'on-call runbook'],
    triggerWords: [
      '告警', '排查', 'on-call', 'oncall', 'SRE', 'sre',
      'latency', '5xx', '错误率', 'saturation', 'RED', 'USE',
      'incident', 'postmortem', '复盘',
    ],
    source: 'agents',
    content: RUNBOOK,
  },
];
