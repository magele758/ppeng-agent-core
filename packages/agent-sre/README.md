# @ppeng/agent-sre

SRE on-call & postmortem domain bundle for `@ppeng/agent-core`. Mounted by the daemon when `RAW_AGENT_DOMAINS=sre` (alone or combined, e.g. `sre,stock`).

## Personas

| Persona | Use case | Allowed tools |
| --- | --- | --- |
| `sre-oncall` | Alert triage & root-cause | `prom_query`, `loki_query`, `k8s_get`, `pagerduty_list`, safe repo reads |
| `sre-postmortem` | Blameless post-incident write-ups | the above + `write_file`, `edit_file` |

Both personas auto-load the **SRE Runbook** skill (RED / USE method, PromQL / LogQL templates, decision tree).

## Tools (all read-only)

- `prom_query` — instant or range PromQL against Prometheus (env `SRE_PROM_URL`, optional `SRE_PROM_TOKEN`)
- `loki_query` — LogQL against Loki (env `SRE_LOKI_URL`, optional `SRE_LOKI_TOKEN`)
- `k8s_get` — wraps `kubectl` with verb allow-list (`get` / `describe` / `logs` / `top`); flag allow-list keeps it strictly read-only. Requires `kubectl` on PATH; reads `SRE_KUBECONFIG` (falls back to `KUBECONFIG`).
- `pagerduty_list` — list PagerDuty incidents (env `SRE_PAGERDUTY_TOKEN`)

When a required env is missing, tools return a friendly `"<VAR> is not configured."` rather than throwing — the agent sees a clean explanation and asks the user for the value.

## Mutating ops

Deferred. When added (e.g. `k8s_apply`, `pagerduty_ack`) they will set `approvalMode: 'always'` and surface in Agent Lab's approvals UI.

## Local config example

```bash
RAW_AGENT_DOMAINS=sre
SRE_PROM_URL=http://prometheus:9090
SRE_LOKI_URL=http://loki:3100
SRE_KUBECONFIG=$HOME/.kube/config
SRE_PAGERDUTY_TOKEN=...
```
