'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ChatPanel } from '@/components/sources/ChatPanel'
import { PaperSelection } from '@/components/sources/PdfReader'
import { SourceDetailContent } from '@/components/sources/SourceDetailContent'
import { ReaderMemoryDialog } from '@/components/sources/ReaderMemoryDialog'
import { MemoryMatch, QuoteReference, readerMemoryApi } from '@/lib/api/reader-memory'
import { useSourceChat } from '@/lib/hooks/use-source-chat'
import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ReasoningEffort } from '@/lib/types/api'

type PendingSettings = { model: string | null; effort: ReasoningEffort | null | undefined }

function quote(selection: PaperSelection, pages: string) {
  const source = `/sources/${encodeURIComponent(selection.sourceId)}#page=${selection.pageStart}`
  return `> ${selection.text.replace(/\n/g, '\n> ')}\n>\n> — [${selection.title || selection.sourceId}, ${pages}](${source})`
}

export function SourceWorkbench({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { data: models = [] } = useModels()
  const { data: defaults } = useModelDefaults()
  const [first, setFirst] = useState<string | null>(null)
  const [second, setSecond] = useState<string | null>(null)
  const [secondOpen, setSecondOpen] = useState(false)
  const [active, setActive] = useState<0 | 1>(0)
  const [helperOpen, setHelperOpen] = useState(false)
  const [helperSession, setHelperSession] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, MemoryMatch[]>>({})
  const validatingMemory = useRef(new Set<string>())
  const [page, setPage] = useState(() => typeof window === 'undefined' ? 1 : Number(window.location.hash.match(/^#page=(\d+)$/)?.[1] || 1))
  const [quoteReferences, setQuoteReferences] = useState<QuoteReference[]>([])
  const [workspaceReady, setWorkspaceReady] = useState(false)
  const draftTransition = useRef<Record<string, string>>({})
  const [settings, setSettings] = useState<PendingSettings[]>([
    { model: null, effort: undefined }, { model: null, effort: undefined }, { model: null, effort: undefined },
  ])
  const firstInitialized = useRef(false)
  const snapshotRevision = useRef<string | null>(null)
  const snapshotEnabled = useRef(false)
  const snapshotQueue = useRef<Promise<void>>(Promise.resolve())
  const memoryStatus = useQuery({ queryKey: ['readerMemory', 'status'], queryFn: readerMemoryApi.status, retry: false })
  const snapshotQuery = useQuery({
    queryKey: ['readerMemory', 'snapshot', sourceId],
    queryFn: () => readerMemoryApi.readSnapshot(sourceId),
    enabled: memoryStatus.data?.enabled === true,
    retry: false,
  })
  const formatQuote = (selection: PaperSelection) => quote(selection,
    selection.pageStart === selection.pageEnd
      ? t('reader.quotedPage', { page: selection.pageStart })
      : t('reader.quotedPages', { start: selection.pageStart, end: selection.pageEnd }))

  const movePendingDraft = useCallback((pendingKey: string, id: string) => {
    draftTransition.current[pendingKey] = id
    setDrafts(previous => {
      const pending = previous[pendingKey] || ''
      const existing = previous[id] || ''
      return { ...previous, [pendingKey]: '', [id]: [existing, pending].filter(Boolean).join('\n\n') }
    })
    setMemoryDrafts(previous => ({
      ...previous, [pendingKey]: [], [id]: [...(previous[id] ?? []), ...(previous[pendingKey] ?? [])],
    }))
  }, [])

  const choosePane = useCallback((index: 0 | 1, id: string | null) => {
    if (id && secondOpen && id === (index === 0 ? second : first)) {
      setActive(index === 0 ? 1 : 0)
      return
    }
    const previousId = index === 0 ? first : second
    const pendingKey = `new-${index}`
    if (id && !previousId) {
      movePendingDraft(pendingKey, id)
    } else if (!id) {
      delete draftTransition.current[pendingKey]
    }
    if (index === 0) setFirst(id)
    else setSecond(id)
  }, [first, second, secondOpen, movePendingDraft])
  const chooseHelper = useCallback((id: string | null) => {
    if (id && !helperSession) movePendingDraft('new-2', id)
    else if (!id) delete draftTransition.current['new-2']
    setHelperSession(id)
  }, [helperSession, movePendingDraft])
  const mainA = useSourceChat(sourceId, { sessionId: first, onSessionChange: id => choosePane(0, id) })
  const mainB = useSourceChat(sourceId, { sessionId: second, onSessionChange: id => choosePane(1, id) })
  const helper = useSourceChat(sourceId, { purpose: 'reader_assistant', sessionId: helperSession, onSessionChange: chooseHelper })

  useEffect(() => {
    const memoryResolved = memoryStatus.isError || (memoryStatus.isSuccess && (
      !memoryStatus.data.enabled || snapshotQuery.isSuccess || snapshotQuery.isError
    ))
    if (!firstInitialized.current && memoryResolved && !mainA.loadingSessions && !helper.loadingSessions) {
      firstInitialized.current = true
      const saved = snapshotQuery.data?.snapshot
      const mainIds = new Set(mainA.sessions.map(session => session.id))
      const helperIds = new Set(helper.sessions.map(session => session.id))
      setFirst(saved?.sessions[0] && mainIds.has(saved.sessions[0]) ? saved.sessions[0] : mainA.sessions[0]?.id ?? null)
      if (saved?.sessions[1] && mainIds.has(saved.sessions[1])) {
        setSecond(saved.sessions[1])
        setSecondOpen(true)
      }
      setHelperSession(saved?.helper_session && helperIds.has(saved.helper_session) ? saved.helper_session : helper.sessions[0]?.id ?? null)
      if (saved && typeof window !== 'undefined' && !window.location.hash.match(/^#page=\d+$/)) setPage(saved.page)
      if (saved) setQuoteReferences(saved.quotes)
      snapshotRevision.current = snapshotQuery.data?.revision ?? null
      snapshotEnabled.current = memoryStatus.data?.enabled === true && snapshotQuery.isSuccess
      setWorkspaceReady(true)
    }
  }, [mainA.loadingSessions, mainA.sessions, helper.loadingSessions, helper.sessions, memoryStatus.isError, memoryStatus.isSuccess, memoryStatus.data, snapshotQuery.isSuccess, snapshotQuery.isError, snapshotQuery.data])

  useEffect(() => {
    const followPageLink = () => {
      const target = Number(window.location.hash.match(/^#page=(\d+)$/)?.[1])
      if (Number.isInteger(target) && target > 0) setPage(target)
    }
    window.addEventListener('hashchange', followPageLink)
    return () => window.removeEventListener('hashchange', followPageLink)
  }, [])

  useEffect(() => {
    if (!workspaceReady || !snapshotEnabled.current) return
    const state = {
      page,
      sessions: [first, secondOpen ? second : null].filter((id): id is string => !!id),
      helper_session: helperSession,
      quotes: quoteReferences,
    }
    const timer = window.setTimeout(() => {
      snapshotQueue.current = snapshotQueue.current.then(async () => {
        if (!snapshotEnabled.current) return
        const result = await readerMemoryApi.writeSnapshot(sourceId, snapshotRevision.current, state)
        snapshotRevision.current = result.revision
      }).catch(() => {
        snapshotEnabled.current = false
        toast.error(t('reader.snapshotError'))
      })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [workspaceReady, sourceId, page, first, second, secondOpen, helperSession, quoteReferences, t])

  const getSettings = (index: number, chat: typeof mainA) => {
    if (chat.currentSession) return {
      model: chat.currentSession.model_override ?? undefined,
      effort: chat.currentSession.reasoning_effort ?? null,
    }
    const pending = settings[index]
    const model = models.find(item => item.id === (pending.model || defaults?.default_chat_model))
    const recommended: ReasoningEffort = index === 2 ? 'low' : 'medium'
    return {
      model: pending.model ?? undefined,
      effort: pending.effort === undefined
        ? (model?.supported_reasoning_efforts?.includes(recommended) ? recommended : null)
        : pending.effort,
    }
  }
  const setPending = (index: number, changes: Partial<PendingSettings>) => {
    setSettings(previous => previous.map((value, i) => i === index ? { ...value, ...changes } : value))
  }
  const draftKey = (index: number, id: string | null) => id || `new-${index}`
  const setDraft = (key: string, value: string) => setDrafts(previous => ({ ...previous, [key]: value }))
  const clearMigratedDraft = (key: string, message: string) => {
    const target = draftTransition.current[key]
    if (!target || draftsRef.current[target]?.trim() !== message) return
    setDrafts(previous => ({ ...previous, [target]: previous[target]?.trim() === message ? '' : previous[target] }))
    setMemoryDrafts(previous => ({ ...previous, [target]: [] }))
  }

  const rememberQuoteReference = (selection: PaperSelection) => {
    // No paper text or conversation is copied into the short-term snapshot.
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(selection.text)).then(hash => {
      const digest = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('')
      setQuoteReferences(previous => [...previous, { page_start: selection.pageStart, page_end: selection.pageEnd, sha256: digest }].slice(-8))
    }).catch(() => toast.error(t('reader.snapshotError')))
  }

  const insertMemory = (text: string, match: MemoryMatch) => {
    const chat = active === 0 ? mainA : mainB
    const key = draftKey(active, chat.currentSessionId)
    const excerpt = `> ${text.replace(/\n/g, '\n> ')}\n>\n> — ${match.kind.toUpperCase()} · ${match.label} · ${match.revision.slice(0, 12)}`
    setDrafts(previous => ({ ...previous, [key]: `${previous[key]?.trimEnd() || ''}\n\n${excerpt}\n\n` }))
    setMemoryDrafts(previous => ({ ...previous, [key]: [...(previous[key] ?? []), match] }))
  }

  const insertQuote = (selection: PaperSelection) => {
    rememberQuoteReference(selection)
    const chat = active === 0 ? mainA : mainB
    const key = draftKey(active, chat.currentSessionId)
    setDrafts(previous => ({
      ...previous,
      [key]: [previous[key]?.trimEnd(), formatQuote(selection), ''].filter(value => value !== undefined && value !== '').join('\n\n') + '\n\n',
    }))
  }

  const askHelper = (selection: PaperSelection, operation: 'translate' | 'explain') => {
    if (helper.isStreaming || helper.isUpdatingSession || (!!helper.currentSessionId && !helper.currentSession)) {
      toast.error(t('reader.assistantBusy'))
      return
    }
    setHelperOpen(true)
    rememberQuoteReference(selection)
    const instruction = operation === 'translate'
      ? '请忠实翻译以下选文为简体中文，保留公式与引用。'
      : '请用简体中文解释以下选文中的术语；如上下文不足请说明。'
    const chosen = getSettings(2, helper)
    void helper.sendMessage(`${instruction}\n\n${formatQuote(selection)}`, chosen.model, chosen.effort)
  }

  const deleteMainSession = (index: 0 | 1, sessionId: string) => {
    if (mainA.isSessionStreaming(sessionId) || mainB.isSessionStreaming(sessionId)) {
      toast.error(t('reader.sessionBusy'))
      return
    }
    const chat = index === 0 ? mainA : mainB
    void chat.deleteSessionAsync(sessionId).then(() => {
      setFirst(previous => previous === sessionId ? null : previous)
      setSecond(previous => previous === sessionId ? null : previous)
    }).catch(() => { /* the hook shows the error */ })
  }

  const renderPane = (index: 0 | 1) => {
    const chat = index === 0 ? mainA : mainB
    const chosen = getSettings(index, chat)
    const key = draftKey(index, chat.currentSessionId)
    return (
      <div className={`min-h-0 min-w-0 flex-1 ${active === index ? 'flex' : 'hidden xl:flex'}`}
        onFocusCapture={() => setActive(index)} onMouseDown={() => setActive(index)}>
        <ChatPanel
          title={`${t('reader.activeChat')} ${index + 1}`}
          messages={chat.messages} isStreaming={!workspaceReady || chat.isStreaming || (!!chat.currentSessionId && !chat.currentSession)}
          contextIndicators={chat.contextIndicators}
          onSendMessage={(message, model, effort) => {
            const attachments = memoryDrafts[key] ?? []
            if (attachments.length) {
              const destinationId = model || defaults?.default_chat_model
              const destination = models.find(item => item.id === destinationId)
              if (!destination || validatingMemory.current.has(key)) return false
              if (!window.confirm(t('reader.memoryConfirm', { name: `${destination.provider} / ${destination.name}` }))) return false
              validatingMemory.current.add(key)
              return (async () => {
                try {
                  // The file may have changed after the preview or model switch.
                  for (const match of attachments) await readerMemoryApi.preview(match)
                  if (await chat.sendMessage(message, destination.id, effort)) {
                    if (draftsRef.current[key]?.trim() === message) {
                      setMemoryDrafts(previous => ({ ...previous, [key]: [] }))
                    }
                    clearMigratedDraft(key, message)
                    return true
                  }
                  return false
                } catch {
                  toast.error(t('reader.memoryError'))
                  return false
                } finally {
                  validatingMemory.current.delete(key)
                }
              })()
            }
            return chat.sendMessage(message, model, effort).then(ok => {
              if (ok) clearMigratedDraft(key, message)
              return ok
            })
          }}
          modelOverride={chosen.model}
          onModelChange={model => {
            if (chat.currentSessionId) chat.updateSession(chat.currentSessionId, { model_override: model ?? null, reasoning_effort: null })
            else setPending(index, { model: model ?? null, effort: undefined })
          }}
          reasoningEffort={chosen.effort}
          settingsDisabled={chat.isUpdatingSession}
          onReasoningChange={effort => {
            if (chat.currentSessionId) chat.updateSession(chat.currentSessionId, { reasoning_effort: effort })
            else setPending(index, { effort })
          }}
          draft={drafts[key] ?? ''} onDraftChange={value => setDraft(key, value)} onComposerFocus={() => setActive(index)}
          sessions={chat.sessions} currentSessionId={chat.currentSessionId}
          onCreateSession={title => chat.createSession({ title, model_override: chosen.model, reasoning_effort: chosen.effort })}
          onSelectSession={id => choosePane(index, id)}
          onUpdateSession={(id, title) => chat.updateSession(id, { title })}
          onDeleteSession={id => deleteMainSession(index, id)} loadingSessions={chat.loadingSessions}
        />
      </div>
    )
  }

  const helperSettings = getSettings(2, helper)
  const helperKey = draftKey(2, helper.currentSessionId)
  return (
    <div className="flex-1 min-h-0 grid grid-rows-[minmax(420px,1fr)_minmax(500px,1fr)] lg:grid-rows-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(380px,1fr)] gap-4 overflow-y-auto px-4 pb-4">
      <div className="min-h-0 min-w-0 overflow-auto px-2">
        <SourceDetailContent sourceId={sourceId} showChatButton={false} onClose={onClose} initialPage={page} onPageChange={setPage}
          onQuote={workspaceReady ? insertQuote : undefined}
          onTranslate={workspaceReady ? selection => askHelper(selection, 'translate') : undefined}
          onExplain={workspaceReady ? selection => askHelper(selection, 'explain') : undefined} />
      </div>
      <div className="min-h-0 min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap gap-1 items-center" aria-label={t('reader.sessions')}>
          {secondOpen && ([0, 1] as const).map(index => (
            <Button key={`pane-${index}`} size="sm" variant={active === index ? 'secondary' : 'ghost'}
              aria-pressed={active === index} onClick={() => setActive(index)}>{t('reader.activeChat')} {index + 1}</Button>
          ))}
          {mainA.sessions.map(session => (
            <Button key={session.id} size="sm" variant={(active === 0 ? first : second) === session.id ? 'secondary' : 'ghost'}
              aria-pressed={(active === 0 ? first : second) === session.id} className="max-w-40 truncate"
              onClick={() => choosePane(active, session.id)}>{session.title}</Button>
          ))}
          <Button size="sm" variant="outline" disabled={!workspaceReady} onClick={() => {
            const chat = active === 0 ? mainA : mainB
            const chosen = getSettings(active, chat)
            chat.createSession({ title: t('reader.newSession'), model_override: chosen.model, reasoning_effort: chosen.effort })
          }}>{t('reader.newSession')}</Button>
          <Button size="sm" variant="outline" disabled={!workspaceReady} onClick={() => { setSecondOpen(!secondOpen); setActive(secondOpen ? 0 : 1) }}>
            {t(secondOpen ? 'reader.closePane' : 'reader.secondPane')}
          </Button>
          {workspaceReady ? <ReaderMemoryDialog sourceId={sourceId} page={page} sessionId={active === 0 ? first : second} onInsert={insertMemory} />
            : <Button variant="outline" size="sm" disabled>{t('reader.memory')}</Button>}
        </div>
        <div className="flex min-h-0 flex-1 gap-2">{renderPane(0)}{secondOpen && renderPane(1)}</div>
        <div className="shrink-0 rounded-md border bg-card">
          <Button variant="ghost" size="sm" className="w-full justify-start" aria-expanded={helperOpen} disabled={!workspaceReady} onClick={() => setHelperOpen(!helperOpen)}>
            {t('reader.assistant')}
          </Button>
          <div className={helperOpen ? 'h-[min(45vh,460px)] min-h-[300px] flex flex-col' : 'hidden'}>
            <p className="px-4 pb-2 text-xs text-muted-foreground">{t('reader.assistantHint')}</p>
            <ChatPanel title={t('reader.assistant')} messages={helper.messages} isStreaming={!workspaceReady || helper.isStreaming || (!!helper.currentSessionId && !helper.currentSession)}
              contextIndicators={helper.contextIndicators}
              onSendMessage={(message, model, effort) => helper.sendMessage(message, model, effort).then(ok => {
                if (ok) clearMigratedDraft(helperKey, message)
                return ok
              })}
              modelOverride={helperSettings.model}
              onModelChange={model => {
                if (helper.currentSessionId) helper.updateSession(helper.currentSessionId, { model_override: model ?? null, reasoning_effort: null })
                else setPending(2, { model: model ?? null, effort: undefined })
              }}
              reasoningEffort={helperSettings.effort}
              settingsDisabled={helper.isUpdatingSession}
              onReasoningChange={effort => {
                if (helper.currentSessionId) helper.updateSession(helper.currentSessionId, { reasoning_effort: effort })
                else setPending(2, { effort })
              }}
              draft={drafts[helperKey] ?? ''} onDraftChange={value => setDraft(helperKey, value)}
              sessions={helper.sessions} currentSessionId={helper.currentSessionId}
              onCreateSession={title => helper.createSession({ title, model_override: helperSettings.model, reasoning_effort: helperSettings.effort })}
              onSelectSession={helper.switchSession} onUpdateSession={(id, title) => helper.updateSession(id, { title })}
              onDeleteSession={id => {
                if (helper.isSessionStreaming(id)) toast.error(t('reader.sessionBusy'))
                else helper.deleteSession(id)
              }} loadingSessions={helper.loadingSessions} />
          </div>
        </div>
      </div>
    </div>
  )
}
