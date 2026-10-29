import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceWorkbench } from './SourceWorkbench'
import { readerMemoryApi } from '@/lib/api/reader-memory'

const sendMessage = vi.fn().mockResolvedValue(true)
const match = { kind: 'gui1' as const, id: 'MEMORY.md:1:1', revision: 'a'.repeat(64), label: 'Synthetic GUI1', scope: 'test' }
const session = { id: 'chat_session:a', title: 'A', source_id: 'source:test', created: '2026-01-01', updated: '2026-01-01' }

vi.mock('@/components/sources/SourceDetailContent', () => ({ SourceDetailContent: () => <div>Paper</div> }))
vi.mock('@/components/sources/ReaderMemoryDialog', () => ({
  ReaderMemoryDialog: ({ onInsert }: { onInsert: (text: string, item: typeof match) => void }) =>
    <button onClick={() => onInsert('Synthetic development memory', match)}>Insert synthetic memory</button>,
}))
vi.mock('@/components/sources/MessageActions', () => ({ MessageActions: () => null }))
vi.mock('@/lib/hooks/use-modal-manager', () => ({ useModalManager: () => ({ openModal: vi.fn() }) }))
vi.mock('@/lib/api/reader-memory', () => ({
  readerMemoryApi: { status: vi.fn().mockResolvedValue({ enabled: false }), preview: vi.fn() },
}))
vi.mock('@/lib/hooks/use-models', () => ({
  useModels: () => ({ data: [{ id: 'model:known', name: 'Synthetic Model', provider: 'openai', type: 'language', supported_reasoning_efforts: ['low', 'medium'] }] }),
  useModelDefaults: () => ({ data: { default_chat_model: 'model:known' } }),
}))
vi.mock('@/lib/hooks/use-source-chat', () => ({
  useSourceChat: (_source: string, options: { purpose?: string; sessionId?: string | null }) => ({
    sessions: options.purpose === 'reader_assistant' ? [] : [session],
    currentSessionId: options.sessionId ?? null,
    currentSession: options.sessionId === session.id ? session : undefined,
    messages: [], contextIndicators: null, isStreaming: false, isUpdatingSession: false, loadingSessions: false,
    createSession: vi.fn(), updateSession: vi.fn(), deleteSession: vi.fn(), deleteSessionAsync: vi.fn(),
    switchSession: vi.fn(), isSessionStreaming: () => false, sendMessage,
  }),
}))

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><SourceWorkbench sourceId="source:test" onClose={() => {}} /></QueryClientProvider>)
}

describe('memory transmission consent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
    vi.mocked(readerMemoryApi.preview).mockResolvedValue({ text: 'Synthetic development memory', revision: match.revision, truncated: false })
  })

  it('confirms the destination and rechecks the source before sending', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    setup()
    await waitFor(() => expect(screen.getAllByRole('textbox')[0]).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Insert synthetic memory' }))
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    expect(textarea.value).toContain('Synthetic development memory')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(textarea.value).toContain('Synthetic development memory')
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce())
    expect(readerMemoryApi.preview).toHaveBeenCalledWith(match)
    expect(sendMessage.mock.calls[0][1]).toBe('model:known')
    expect(confirm).toHaveBeenCalledTimes(2)
    confirm.mockRestore()
  })

  it('does not send when the selected source changed after preview', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(readerMemoryApi.preview).mockRejectedValue(new Error('changed'))
    setup()
    await waitFor(() => expect(screen.getAllByRole('textbox')[0]).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Insert synthetic memory' }))
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(readerMemoryApi.preview).toHaveBeenCalledOnce())
    expect(sendMessage).not.toHaveBeenCalled()
    expect(textarea.value).toContain('Synthetic development memory')
    confirm.mockRestore()
  })
})
