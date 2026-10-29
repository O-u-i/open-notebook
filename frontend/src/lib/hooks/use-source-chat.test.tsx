import { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSourceChat } from './use-source-chat'
import { sourceChatApi } from '@/lib/api/source-chat'

vi.mock('@/lib/api/source-chat', () => ({
  sourceChatApi: {
    listSessions: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
  },
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useSourceChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The context badge used to come only from the SSE event, so it disappeared
  // after a refresh even though GET session returns it (#1393).
  it('restores context indicators from the loaded session', async () => {
    const indicators = { sources: ['source:xyz'], insights: [], notes: [] }
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([
      {
        id: 'chat_session:abc',
        title: 'Session',
        source_id: 'source:xyz',
        created: '2026-01-01T00:00:00',
        updated: '2026-01-01T00:00:00',
      },
    ])
    vi.mocked(sourceChatApi.getSession).mockResolvedValue({
      id: 'chat_session:abc',
      title: 'Session',
      source_id: 'source:xyz',
      created: '2026-01-01T00:00:00',
      updated: '2026-01-01T00:00:00',
      messages: [{ id: 'm1', type: 'human', content: 'hello' }],
      context_indicators: indicators,
    })

    const { result } = renderHook(() => useSourceChat('source:xyz'), { wrapper })

    await waitFor(() => expect(result.current.contextIndicators).toEqual(indicators))
    expect(result.current.messages).toHaveLength(1)
  })

  it('keeps a late response in its original session after switching tabs', async () => {
    const base = { source_id: 'source:xyz', created: '2026-01-01', updated: '2026-01-01' }
    const sessions = [
      { ...base, id: 'chat_session:a', title: 'A' },
      { ...base, id: 'chat_session:b', title: 'B' },
    ]
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue(sessions)
    let completed = false
    vi.mocked(sourceChatApi.getSession).mockImplementation(async (_source, id) => ({
      ...sessions.find(session => session.id === id)!,
      messages: id === 'chat_session:b'
        ? [{ id: 'b1', type: 'human', content: 'B only' }]
        : completed ? [{ id: 'a1', type: 'human', content: 'question A' }, { id: 'a2', type: 'ai', content: 'answer A' }] : [],
    }))
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(new ReadableStream({
      start(controller) { streamController = controller },
    }))
    const { result, rerender } = renderHook(
      ({ id }) => useSourceChat('source:xyz', { sessionId: id, onSessionChange: vi.fn() }),
      { wrapper, initialProps: { id: 'chat_session:a' } },
    )
    await waitFor(() => expect(result.current.currentSession?.id).toBe('chat_session:a'))
    let pending!: Promise<boolean>
    act(() => { pending = result.current.sendMessage('question A') })
    await waitFor(() => expect(result.current.isStreaming).toBe(true))
    rerender({ id: 'chat_session:b' })
    await waitFor(() => expect(result.current.messages[0]?.content).toBe('B only'))
    completed = true
    await act(async () => {
      streamController.enqueue(new TextEncoder().encode('data: {"type":"ai_message","content":"answer A"}\n\ndata: {"type":"complete"}\n\n'))
      streamController.close()
      await pending
    })
    expect(result.current.messages.map(message => message.content)).toEqual(['B only'])
    rerender({ id: 'chat_session:a' })
    await waitFor(() => expect(result.current.messages.map(message => message.content)).toContain('answer A'))
  })

  it('persists the chosen model and reasoning when creating the first session', async () => {
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([])
    vi.mocked(sourceChatApi.createSession).mockResolvedValue({
      id: 'chat_session:new', title: 'question', source_id: 'source:xyz',
      created: '2026-01-01', updated: '2026-01-01',
    })
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"type":"complete"}\n\n'))
      controller.close()
    } }))
    const onSessionChange = vi.fn()
    const { result } = renderHook(() => useSourceChat('source:xyz', { sessionId: null, onSessionChange }), { wrapper })
    await act(async () => { await result.current.sendMessage('question', 'model:selected', 'high') })
    expect(sourceChatApi.createSession).toHaveBeenCalledWith('source:xyz', expect.objectContaining({
      model_override: 'model:selected', reasoning_effort: 'high', purpose: 'main',
    }))
    expect(onSessionChange).toHaveBeenCalledWith('chat_session:new')
  })

  it('does not report success when the stream ends without a completion event', async () => {
    const session = { id: 'chat_session:a', title: 'A', source_id: 'source:xyz', created: '2026-01-01', updated: '2026-01-01' }
    vi.mocked(sourceChatApi.listSessions).mockResolvedValue([session])
    vi.mocked(sourceChatApi.getSession).mockResolvedValue({ ...session, messages: [] })
    vi.mocked(sourceChatApi.sendMessage).mockResolvedValue(new ReadableStream({ start(controller) { controller.close() } }))
    const { result } = renderHook(() => useSourceChat('source:xyz', { sessionId: session.id }), { wrapper })
    await waitFor(() => expect(result.current.currentSession?.id).toBe(session.id))
    let success = true
    await act(async () => { success = await result.current.sendMessage('question') })
    expect(success).toBe(false)
    expect(result.current.messages).toEqual([])
  })
})
