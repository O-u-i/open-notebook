'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'
import { sourceChatApi } from '@/lib/api/source-chat'
import {
  SourceChatSession, SourceChatSessionWithMessages, SourceChatMessage, SourceChatContextIndicator,
  CreateSourceChatSessionRequest, UpdateSourceChatSessionRequest,
  SourceChatPurpose, ReasoningEffort,
} from '@/lib/types/api'

interface SourceChatOptions {
  sessionId?: string | null
  onSessionChange?: (sessionId: string | null) => void
  purpose?: SourceChatPurpose
}

/** Each async result belongs to its captured session, not the currently visible tab. */
export function useSourceChat(sourceId: string, options: SourceChatOptions = {}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const purpose = options.purpose ?? 'main'
  const controlled = options.sessionId !== undefined
  const [localSessionId, setLocalSessionId] = useState<string | null>(null)
  const currentSessionId = controlled ? options.sessionId! : localSessionId
  const onSessionChangeRef = useRef(options.onSessionChange)
  onSessionChangeRef.current = options.onSessionChange
  const [messagesBySession, setMessagesBySession] = useState<Record<string, SourceChatMessage[]>>({})
  const [indicatorsBySession, setIndicatorsBySession] = useState<Record<string, SourceChatContextIndicator | null>>({})
  const [streamingBySession, setStreamingBySession] = useState<Record<string, boolean>>({})
  const controllers = useRef(new Map<string, AbortController>())
  const inFlight = useRef(new Set<string>())

  const selectSession = useCallback((id: string | null) => {
    if (controlled) onSessionChangeRef.current?.(id)
    else setLocalSessionId(id)
  }, [controlled])

  const sessionListKey = ['sourceChatSessions', sourceId, purpose]
  const { data: sessions = [], isLoading: loadingSessions, refetch: refetchSessions } = useQuery<SourceChatSession[]>({
    queryKey: sessionListKey,
    queryFn: () => sourceChatApi.listSessions(sourceId, purpose),
    enabled: !!sourceId,
    retry: false,
  })
  const { data: currentSession } = useQuery({
    queryKey: ['sourceChatSession', sourceId, currentSessionId],
    queryFn: () => sourceChatApi.getSession(sourceId, currentSessionId!),
    enabled: !!sourceId && !!currentSessionId,
    retry: false,
  })

  useEffect(() => {
    if (!currentSessionId || currentSession?.id !== currentSessionId || inFlight.current.has(currentSessionId)) return
    setMessagesBySession(prev => ({ ...prev, [currentSessionId]: currentSession.messages ?? [] }))
    setIndicatorsBySession(prev => ({ ...prev, [currentSessionId]: currentSession.context_indicators ?? null }))
  }, [currentSession, currentSessionId])

  useEffect(() => {
    if (!controlled && sessions.length > 0 && !currentSessionId) selectSession(sessions[0].id)
  }, [controlled, sessions, currentSessionId, selectSession])

  useEffect(() => {
    const active = controllers.current
    return () => { active.forEach(controller => controller.abort()) }
  }, [])

  const showError = useCallback((err: unknown, fallback: string) => {
    const error = err as { response?: { data?: { detail?: string } }, message?: string }
    toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, key => t(key), fallback))
  }, [t])

  const createSessionMutation = useMutation({
    retry: false,
    mutationFn: (data: Omit<CreateSourceChatSessionRequest, 'source_id'>) =>
      sourceChatApi.createSession(sourceId, { ...data, purpose }),
    onSuccess: newSession => {
      void queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId, purpose] })
      selectSession(newSession.id)
      toast.success(t('chat.sessionCreated'))
    },
    onError: err => showError(err, 'apiErrors.failedToCreateSession'),
  })
  const updateSessionMutation = useMutation({
    retry: false,
    mutationFn: ({ sessionId, data }: { sessionId: string; data: UpdateSourceChatSessionRequest }) =>
      sourceChatApi.updateSession(sourceId, sessionId, data),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData<SourceChatSessionWithMessages>(['sourceChatSession', sourceId, variables.sessionId], old => old ? { ...old, ...updated } : old)
      void queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId, purpose] })
      void queryClient.invalidateQueries({ queryKey: ['sourceChatSession', sourceId, variables.sessionId] })
      toast.success(t('chat.sessionUpdated'))
    },
    onError: err => showError(err, 'apiErrors.failedToUpdateSession'),
  })
  const deleteSessionMutation = useMutation({
    retry: false,
    mutationFn: (id: string) => sourceChatApi.deleteSession(sourceId, id),
    onSuccess: (_, deletedId) => {
      void queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId, purpose] })
      if (currentSessionId === deletedId) selectSession(null)
      toast.success(t('chat.sessionDeleted'))
    },
    onError: err => showError(err, 'apiErrors.failedToDeleteSession'),
  })

  const sendMessage = useCallback(async (message: string, modelOverride?: string, reasoningEffort?: ReasoningEffort | null) => {
    let sessionId = currentSessionId
    const pendingKey = sessionId ?? '__new__'
    if (inFlight.current.has(pendingKey)) return false
    inFlight.current.add(pendingKey)
    if (!sessionId) {
      try {
        const title = message.length > 30 ? `${message.substring(0, 30)}...` : message
        const newSession = await sourceChatApi.createSession(sourceId, {
          title, purpose, model_override: modelOverride, reasoning_effort: reasoningEffort,
        })
        sessionId = newSession.id
        inFlight.current.add(sessionId)
        inFlight.current.delete(pendingKey)
        selectSession(sessionId)
        void queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId, purpose] })
      } catch (error) {
        inFlight.current.delete(pendingKey)
        showError(error, 'apiErrors.failedToCreateSession')
        return false
      }
    }
    const capturedId = sessionId
    const tempId = `temp-${Date.now()}-${Math.random()}`
    const controller = new AbortController()
    controllers.current.set(capturedId, controller)
    setMessagesBySession(prev => ({ ...prev, [capturedId]: [...(prev[capturedId] ?? []), {
      id: tempId, type: 'human', content: message, timestamp: new Date().toISOString(),
    }] }))
    setStreamingBySession(prev => ({ ...prev, [capturedId]: true }))

    try {
      const stream = await sourceChatApi.sendMessage(sourceId, capturedId, {
        message, model_override: modelOverride, reasoning_effort: reasoningEffort,
      }, controller.signal)
      if (!stream) throw new Error('No response body')
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let completed = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let data: { type: string; content?: string; data?: SourceChatContextIndicator; message?: string }
          try { data = JSON.parse(line.slice(6).trim()) } catch { continue }
          if (data.type === 'ai_message') {
            const aiMessage: SourceChatMessage = {
              id: `ai-${tempId}`, type: 'ai', content: data.content || '', timestamp: new Date().toISOString(),
            }
            setMessagesBySession(prev => ({ ...prev, [capturedId]: [...(prev[capturedId] ?? []), aiMessage] }))
          } else if (data.type === 'context_indicators' && data.data) {
            setIndicatorsBySession(prev => ({ ...prev, [capturedId]: data.data! }))
          } else if (data.type === 'complete') {
            completed = true
          } else if (data.type === 'error') {
            throw new Error(data.message || 'Stream error')
          }
        }
      }
      if (!completed) throw new Error('Stream ended before completion')
      return true
    } catch (error) {
      if (!controller.signal.aborted) showError(error, 'apiErrors.failedToSendMessage')
      setMessagesBySession(prev => ({ ...prev, [capturedId]: (prev[capturedId] ?? []).filter(msg => msg.id !== tempId) }))
      return false
    } finally {
      controllers.current.delete(capturedId)
      inFlight.current.delete(capturedId)
      setStreamingBySession(prev => ({ ...prev, [capturedId]: false }))
      void queryClient.invalidateQueries({ queryKey: ['sourceChatSession', sourceId, capturedId] })
    }
  }, [currentSessionId, sourceId, purpose, selectSession, queryClient, showError])

  return {
    sessions,
    currentSession: currentSession?.id === currentSessionId ? currentSession : sessions.find(s => s.id === currentSessionId),
    currentSessionId,
    messages: currentSessionId ? messagesBySession[currentSessionId] ?? [] : [],
    isStreaming: !!(currentSessionId && streamingBySession[currentSessionId]),
    contextIndicators: currentSessionId ? indicatorsBySession[currentSessionId] ?? null : null,
    loadingSessions,
    isUpdatingSession: updateSessionMutation.isPending,
    createSession: (data: Omit<CreateSourceChatSessionRequest, 'source_id'>) => createSessionMutation.mutate(data),
    updateSession: (sessionId: string, data: UpdateSourceChatSessionRequest) => updateSessionMutation.mutate({ sessionId, data }),
    deleteSession: (sessionId: string) => deleteSessionMutation.mutate(sessionId),
    deleteSessionAsync: (sessionId: string) => deleteSessionMutation.mutateAsync(sessionId),
    isSessionStreaming: (sessionId: string) => inFlight.current.has(sessionId),
    switchSession: (sessionId: string) => selectSession(sessionId),
    sendMessage,
    cancelStreaming: () => { if (currentSessionId) controllers.current.get(currentSessionId)?.abort() },
    refetchSessions,
  }
}
