export interface AdminOpsSummary {
  generatedAt: string
  users: {
    total: number
    enabled: number
    disabled: number
    locked: number
  }
  albums: {
    total: number
    enabled: number
    disabled: number
    expired: number
    expiringSoon: number
    downloadable: number
  }
  permissions: {
    total: number
  }
  sessions: {
    total: number
    expired: number
  }
}
