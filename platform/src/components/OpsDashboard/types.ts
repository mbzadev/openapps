export type SourceHealth = {
  enabled: boolean
  health: 'unknown' | 'healthy' | 'limited' | 'failing' | 'disabled'
  label: string
  lastFailureAt: string | null
  lastSuccessAt: string | null
  secretStatus: 'not-required' | 'configured' | 'missing' | 'expired'
  source: string
  transport: string
}

export type RecentRun = {
  completedAt: string | null
  errorMessage: string | null
  id: number
  reason: string
  resultCount: number
  source: string
  startedAt: string
  status: string
}

export type DeadLetter = {
  errorMessage: string
  failedAt: string
  id: number
  kind: string
  source: string | null
  status: string
  taskId: string
}

export type OpsSummary = {
  creatives: { ads: number; assets: number; candidates: number; linked: number }
  generatedAt: string
  queues: { completed24h: number; deadLetters: number; failed24h: number; queued: number; running: number }
  recentRuns: RecentRun[]
  sources: SourceHealth[]
  deadLetters: DeadLetter[]
}
