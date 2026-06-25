export interface AdminSyncStatus {
  schema: 1
  publishedAt: string
  albumId: string
  intervalSeconds: number
  startedAt: string
  heartbeatAt: string
  lastAttemptStartedAt: string | null
  lastAttemptCompletedAt: string | null
  lastResult: 'ok' | 'failed' | null
  lastError: string | null
  consecutiveFailures: number
  runsCompleted: number
}
