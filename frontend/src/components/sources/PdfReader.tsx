'use client'

import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import 'pdfjs-dist/web/pdf_viewer.css'
import { sourcesApi } from '@/lib/api/sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export interface PaperSelection {
  sourceId: string
  title: string
  text: string
  pageStart: number
  pageEnd: number
}

type PDFViewer = import('pdfjs-dist/web/pdf_viewer.mjs').PDFViewer
type PDFLoadingTask = import('pdfjs-dist').PDFDocumentLoadingTask

interface PdfReaderProps {
  sourceId: string
  title: string
  onQuote?: (selection: PaperSelection) => void
  onTranslate?: (selection: PaperSelection) => void
  onExplain?: (selection: PaperSelection) => void
  onPageChange?: (page: number) => void
  initialPage?: number
}

const assetRoot = '/pdfjs/6.4.299/'

export function PdfReader({ sourceId, title, onQuote, onTranslate, onExplain, onPageChange, initialPage = 1 }: PdfReaderProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerElementRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PDFViewer | null>(null)
  const onPageChangeRef = useRef(onPageChange)
  onPageChangeRef.current = onPageChange
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [pageCount, setPageCount] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selection, setSelection] = useState<(PaperSelection & { x: number; y: number }) | null>(null)

  useEffect(() => {
    let disposed = false
    let task: PDFLoadingTask | undefined
    let viewer: PDFViewer | undefined
    let unsubscribe: (() => void) | undefined
    const controller = new AbortController()

    async function load() {
      try {
        const response = await sourcesApi.downloadFile(sourceId, controller.signal)
        const data = new Uint8Array(await response.data.arrayBuffer())
        // The viewer consumes the global installed by the core module, so the
        // two imports must be awaited in this order, and only in the browser.
        const pdf = await import('pdfjs-dist')
        const components = await import('pdfjs-dist/web/pdf_viewer.mjs')
        if (disposed || !containerRef.current || !viewerElementRef.current) return
        pdf.GlobalWorkerOptions.workerSrc = `${assetRoot}build/pdf.worker.mjs`
        const eventBus = new components.EventBus()
        const linkService = new components.PDFLinkService({
          eventBus, externalLinkTarget: components.LinkTarget.BLANK,
        })
        viewer = new components.PDFViewer({
          container: containerRef.current,
          viewer: viewerElementRef.current,
          eventBus,
          linkService,
          imageResourcesPath: `${assetRoot}web/images/`,
          removePageBorders: false,
        })
        viewerRef.current = viewer
        linkService.setViewer(viewer)
        const onPagesInit = () => {
          if (!viewer) return
          viewer.currentScaleValue = 'page-width'
          if (initialPage > 1 && initialPage <= viewer.pagesCount) {
            viewer.scrollPageIntoView({ pageNumber: initialPage })
          }
        }
        const onPage = (event: { pageNumber: number }) => {
          setPage(event.pageNumber)
          setPageInput(String(event.pageNumber))
          onPageChangeRef.current?.(event.pageNumber)
        }
        eventBus.on('pagesinit', onPagesInit)
        eventBus.on('pagechanging', onPage)
        unsubscribe = () => {
          eventBus.off('pagesinit', onPagesInit)
          eventBus.off('pagechanging', onPage)
        }
        task = pdf.getDocument({
          data, cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true,
          standardFontDataUrl: `${assetRoot}standard_fonts/`,
          iccUrl: `${assetRoot}iccs/`, wasmUrl: `${assetRoot}wasm/`,
        })
        const document = await task.promise
        if (disposed) return
        setPageCount(document.numPages)
        linkService.setDocument(document)
        viewer.setDocument(document)
        setStatus('ready')
      } catch (error) {
        if (!disposed && !controller.signal.aborted) {
          console.error('PDF loading failed:', error)
          setStatus('error')
        }
      }
    }
    void load()
    return () => {
      disposed = true
      controller.abort()
      unsubscribe?.()
      viewer?.setDocument(null)
      viewer?.cleanup()
      viewerRef.current = null
      if (task) void task.destroy()
    }
    // Initial page applies once per source; ordinary page changes never reload PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId])

  useEffect(() => {
    if (status === 'ready' && initialPage >= 1 && initialPage <= pageCount && viewerRef.current?.currentPageNumber !== initialPage) {
      viewerRef.current?.scrollPageIntoView({ pageNumber: initialPage })
    }
  }, [initialPage, pageCount, status])

  const captureSelection = () => {
    const current = window.getSelection()
    const container = containerRef.current
    if (!container || !current || current.isCollapsed || current.rangeCount === 0) {
      setSelection(null)
      return
    }
    const range = current.getRangeAt(0)
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return
    const pageOf = (node: Node) => {
      const element = node instanceof Element ? node : node.parentElement
      return Number(element?.closest<HTMLElement>('.page[data-page-number]')?.dataset.pageNumber)
    }
    const pageStart = pageOf(range.startContainer)
    const pageEnd = pageOf(range.endContainer)
    const text = current.toString().replace(/\r\n?/g, '\n').replace(/\0/g, '').trim()
    if (!text || !pageStart || !pageEnd) return
    if (text.length > 30000) {
      setSelection(null)
      toast.error(t('reader.selectionTooLong'))
      return
    }
    const rect = range.getBoundingClientRect()
    setSelection({
      sourceId, title, text, pageStart, pageEnd,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
      y: Math.max(8, rect.top - 46),
    })
  }

  const jump = () => {
    const target = Number(pageInput)
    if (Number.isInteger(target) && target >= 1 && target <= pageCount) {
      viewerRef.current?.scrollPageIntoView({ pageNumber: target })
    } else setPageInput(String(page))
  }

  return (
    <div className="rounded-md border bg-muted/30 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2 text-sm">
        <label htmlFor="pdf-page" className="text-muted-foreground">{t('reader.page')}</label>
        <input id="pdf-page" type="number" min={1} max={pageCount || 1} value={pageInput}
          onChange={event => setPageInput(event.target.value)} onBlur={jump}
          onKeyDown={event => { if (event.key === 'Enter') jump() }}
          className="w-16 rounded border bg-background px-2 py-1 text-center" disabled={status !== 'ready'} />
        <span className="text-muted-foreground">{t('reader.ofPages', { count: pageCount })}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" aria-label={t('reader.zoomOut')} disabled={status !== 'ready'}
            onClick={() => { if (viewerRef.current) viewerRef.current.currentScale = Math.max(0.25, viewerRef.current.currentScale / 1.2) }}><Minus className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label={t('reader.zoomIn')} disabled={status !== 'ready'}
            onClick={() => { if (viewerRef.current) viewerRef.current.currentScale = Math.min(4, viewerRef.current.currentScale * 1.2) }}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="relative h-[min(75vh,1100px)] min-h-[420px]">
        {status !== 'ready' && <p role={status === 'error' ? 'alert' : 'status'} className="absolute inset-0 flex items-center justify-center px-4 text-sm text-muted-foreground">{t(status === 'error' ? 'reader.pdfError' : 'reader.pdfLoading')}</p>}
        <div ref={containerRef} className="absolute inset-0 overflow-auto" onMouseUp={captureSelection} onKeyUp={captureSelection}>
          <div ref={viewerElementRef} className="pdfViewer" />
        </div>
      </div>
      {selection && (onQuote || onTranslate || onExplain) && (
        <div className="fixed z-50 flex gap-1 rounded-md border bg-popover p-1 shadow-lg" style={{ left: selection.x, top: selection.y }}
          onMouseDown={event => event.preventDefault()} role="toolbar" aria-label={t('reader.activeChat')}>
          {onQuote && <Button variant="ghost" size="sm" onClick={() => { onQuote(selection); setSelection(null) }}>{t('reader.quote')}</Button>}
          {onTranslate && <Button variant="ghost" size="sm" onClick={() => { onTranslate(selection); setSelection(null) }}>{t('reader.translate')}</Button>}
          {onExplain && <Button variant="ghost" size="sm" onClick={() => { onExplain(selection); setSelection(null) }}>{t('reader.explain')}</Button>}
        </div>
      )}
    </div>
  )
}
