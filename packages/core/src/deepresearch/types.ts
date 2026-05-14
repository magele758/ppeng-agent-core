export type ResearchStatus =
  | 'pending'
  | 'searching'
  | 'extracting'
  | 'synthesizing'
  | 'critiquing'
  | 'completed'
  | 'failed';

export type SourceKind =
  | 'web'
  | 'rss'
  | 'github'
  | 'arxiv'
  | 'local-note'
  | 'session'
  | 'trace';

export type TrustLevel = 'primary' | 'secondary' | 'unknown';

export type ClaimConfidence = 'low' | 'medium' | 'high';

export interface ResearchTask {
  id: string;
  query: string;
  scope?: string;
  status: ResearchStatus;
  capabilityTags: string[];
  reportPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchSource {
  id: string;
  taskId: string;
  kind: SourceKind;
  url?: string;
  title: string;
  fetchedAt: string;
  trustLevel: TrustLevel;
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  taskId: string;
  quote: string;
  location?: string;
  relevance: number; // 0-1
}

export interface ResearchClaim {
  id: string;
  taskId: string;
  text: string;
  confidence: ClaimConfidence;
  evidenceIds: string[];
  caveats?: string[];
  createdAt: string;
}
