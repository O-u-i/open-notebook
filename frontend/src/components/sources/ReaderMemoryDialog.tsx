'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MemoryMatch, readerMemoryApi } from '@/lib/api/reader-memory'
import { useTranslation } from '@/lib/hooks/use-translation'

export function ReaderMemoryDialog({ sourceId, page, sessionId, onInsert }: {
  sourceId: string
  page: number
  sessionId: string | null
  onInsert: (text: string, match: MemoryMatch) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [claim, setClaim] = useState('')
  const [selected, setSelected] = useState<MemoryMatch | null>(null)
  const search = useMutation({ mutationFn: readerMemoryApi.search, retry: false, onError: () => toast.error(t('reader.memoryError')) })
  const preview = useMutation({ mutationFn: readerMemoryApi.preview, retry: false, onError: () => toast.error(t('reader.memoryError')) })
  const candidate = useMutation({ mutationFn: readerMemoryApi.candidate, retry: false,
    onSuccess: result => { setClaim(''); toast.success(`${t('reader.memorySaved')} ${result.proposal_id}`) },
    onError: () => toast.error(t('reader.memoryError')),
  })
  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline" size="sm">{t('reader.memory')}</Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('reader.memory')}</DialogTitle>
          <DialogDescription>{t('reader.memoryHint')}</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={event => {
          event.preventDefault()
          setSelected(null)
          preview.reset()
          if (query.trim()) search.mutate(query.trim())
        }}>
          <Input value={query} onChange={event => setQuery(event.target.value)} maxLength={120} aria-label={t('reader.memorySearch')} />
          <Button type="submit" disabled={!query.trim() || search.isPending}>{t('reader.memorySearch')}</Button>
        </form>
        {search.isSuccess && search.data.matches.length === 0 && <p className="text-sm text-muted-foreground">{t('reader.memoryEmpty')}</p>}
        {search.data?.matches.map(match => (
          <div key={`${match.kind}-${match.id}`} className="flex items-center justify-between gap-3 border-b py-2">
            <div className="min-w-0 text-sm"><p className="break-words">{match.label}</p><p className="text-xs text-muted-foreground">{match.scope}</p></div>
            <Button variant="outline" size="sm" onClick={() => { setSelected(match); preview.mutate(match) }}>{t('reader.memoryPreview')}</Button>
          </div>
        ))}
        {selected && preview.data && !preview.isPending && (
          <section className="space-y-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">{selected.label}</p>
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-sans text-sm">{preview.data.text}</pre>
            {preview.data.truncated && <p className="text-xs text-muted-foreground">{t('reader.memoryTruncated')}</p>}
            <Button size="sm" onClick={async () => {
              try {
                // Re-read and recheck the hash before inserting anything into a draft.
                const verified = await preview.mutateAsync(selected)
                onInsert(verified.text, selected)
              } catch { /* the mutation shows a scoped error */ }
            }}>{t('reader.memoryInsert')}</Button>
          </section>
        )}
        <section className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-medium">{t('reader.memoryRemember')}</h3>
          <p className="text-xs text-muted-foreground">{t('reader.memoryClaimHint')}</p>
          <Textarea value={claim} onChange={event => setClaim(event.target.value)} maxLength={1200} aria-label={t('reader.memoryRemember')} />
          <Button size="sm" variant="outline" disabled={!claim.trim() || candidate.isPending}
            onClick={() => candidate.mutate({ source_id: sourceId, page, session_id: sessionId, claim: claim.trim() })}>
            {t('reader.memoryCandidate')}
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  )
}
