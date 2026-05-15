{{/*
Expand the name of the chart.
*/}}
{{- define "ppeng-agent-core.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ppeng-agent-core.fullname" -}}
{{- if contains .Chart.Name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "ppeng-agent-core.web.replicas" -}}
{{- if .Values.web.replicaCount }}
{{- .Values.web.replicaCount }}
{{- else }}
{{- .Values.replicaCount }}
{{- end }}
{{- end }}

{{- define "ppeng-agent-core.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "ppeng-agent-core.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "ppeng-agent-core.redis.fullname" -}}
{{- printf "%s-redis" (include "ppeng-agent-core.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "ppeng-agent-core.minio.fullname" -}}
{{- printf "%s-minio" (include "ppeng-agent-core.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
