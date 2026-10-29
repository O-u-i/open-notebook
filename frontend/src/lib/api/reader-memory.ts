import apiClient from './client'

export interface MemoryMatch {
  kind: 'mei' | 'gui1' | 'gui2'
  id: string
  revision: string
  label: string
  scope: string
}
export interface QuoteReference { page_start: number; page_end: number; sha256: string }
export interface ReadingSnapshot {
  page: number
  sessions: string[]
  helper_session: string | null
  quotes: QuoteReference[]
}

export const readerMemoryApi = {
  status: async () => (await apiClient.get<{ enabled: boolean; hosts: string[] }>('/reader-memory/status')).data,
  search: async (query: string) => (await apiClient.post<{ matches: MemoryMatch[] }>('/reader-memory/search', { query })).data,
  preview: async (match: MemoryMatch) => (await apiClient.post<{ text: string; revision: string; truncated: boolean }>(
    '/reader-memory/preview', { kind: match.kind, id: match.id, revision: match.revision },
  )).data,
  readSnapshot: async (sourceId: string) => (await apiClient.get<{ snapshot: ReadingSnapshot | null; revision: string | null }>(
    `/reader-memory/snapshots/${sourceId}`,
  )).data,
  writeSnapshot: async (sourceId: string, revision: string | null, snapshot: ReadingSnapshot) => (
    await apiClient.put<{ revision: string }>(`/reader-memory/snapshots/${sourceId}`, { revision, snapshot })
  ).data,
  candidate: async (data: { source_id: string; page: number; session_id: string | null; claim: string }) => (
    await apiClient.post<{ proposal_id: string; review_card: string }>('/reader-memory/candidates', data)
  ).data,
}
