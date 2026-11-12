import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF, useDocumentState } from '@embedpdf/core/react'
import type { PdfEngine } from '@embedpdf/models'
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation/react'
import { BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/react'
import {
  DocumentContent,
  DocumentManagerPluginPackage,
} from '@embedpdf/plugin-document-manager/react'
import {
  GlobalPointerProvider,
  InteractionManagerPluginPackage,
  PagePointerProvider,
} from '@embedpdf/plugin-interaction-manager/react'
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react'
import { SearchPluginPackage } from '@embedpdf/plugin-search/react'
import {
  type PageLayout,
  Scroller,
  ScrollPluginPackage,
  ScrollStrategy,
  useScroll,
} from '@embedpdf/plugin-scroll/react'
import {
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
} from '@embedpdf/plugin-selection/react'
import { SpreadMode, SpreadPluginPackage } from '@embedpdf/plugin-spread/react'
import { TilingLayer, TilingPluginPackage } from '@embedpdf/plugin-tiling/react'
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react'
import {
  useZoom,
  ZoomGestureWrapper,
  ZoomMode,
  ZoomPluginPackage,
} from '@embedpdf/plugin-zoom/react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EditableBookmark } from './bookmark'
import { CommentCards } from './comment-cards'
import { cn } from './cn'
import { loadPdfEngine } from './engine'
import { PdfFindLayer, PdfSearchLayer } from './find'
import { PdfLinkLayer } from './link-layer'
import { PdfOutlineLayer } from './outline'
import { PanDragHandler } from './pan-handler'
import { PdfToolbar } from './pdf-toolbar'
import { PageTranslationOverlay } from './translation/page-overlay'
import { usePageTranslation, type TranslatedPage } from './translation/use-page-translation'
import {
  PDF_PAGE_RASTER_DARK_CLASS,
  PDF_PAPER_SHELL_CLASS,
  type PdfPaperTone,
} from './page-theme'
import { PdfBottomBar } from './pdf-bottom-bar'
import { DEFAULT_HIGHLIGHT_COLOR, highlightFill } from './palette'
import { PDF_FLOAT_CARD } from './pdf-chrome-surface'
import type { PaintMark, PdfPageSize, PdfRect } from './pdf-panel'
import { TranslateCardPin } from './translate-card'
import { PDF_ZOOM_MAX, PDF_ZOOM_MIN } from './zoom'

/** Marks a rendered page so the selection menu can map page points to the screen. */
const EMBED_PAGE_ATTR = 'data-embed-pdf-page'

type PdfT = PropsLocale<'agentero.pdf'>['t']

export interface SelectionHit {
  quote: string
  page: number
  /** Page-point rectangles from the live selection. */
  rects: PdfRect[]
  /** Page size at scale 1, for normalizing per-id mark anchors. */
  pageWidth: number
  pageHeight: number
  screenX: number
  screenY: number
}

interface EmbedReaderProps {
  notesOpen: boolean
  onToggleNotes?: () => void
  bytes: ArrayBuffer
  docId: string
  marks: readonly PaintMark[]
  pdfTone: PdfPaperTone
  onSetPdfTone: (tone: PdfPaperTone) => void
  onSelect: (hit: SelectionHit) => void
  /** The live text selection went away; the floating menu must hide. */
  onDeselect: () => void
  /** Persist the outline back into the PDF; resolves after the host wrote it. */
  saveBookmarks: (nodes: EditableBookmark[]) => Promise<void>
  /** Translate one page's text through the host. */
  translate: (text: string, signal?: AbortSignal) => Promise<string>
  loadLayout: (ref: string, signal?: AbortSignal) => Promise<unknown>
  /** Pinned translation chip, drawn inside the page so it scrolls with it. */
  translatePin?: {
    page: number
    rects: PdfRect[]
    pageSize: PdfPageSize
    onOpen: (screen: { x: number, y: number }) => void
  }
  menu: ReactNode
  /** Increment after a mark is saved so the blue selection does not cover it. */
  selectionClearVersion: number
  t: PdfT
}

export function EmbedReader(props: EmbedReaderProps): ReactNode {
  const { bytes, docId, t } = props
  const [engine, setEngine] = useState<PdfEngine | undefined>(undefined)
  const [engineError, setEngineError] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadPdfEngine().then((next) => {
      if (!cancelled) setEngine(next)
    }).catch((error: unknown) => {
      if (cancelled) return
      const text = error instanceof Error ? error.message : ''
      setEngineError(text === '' ? t('loadFailed') : text)
    })
    return () => { cancelled = true }
  }, [t])

  const buffer = useMemo(() => bytes.slice(0), [bytes])
  const plugins = useMemo(() => {
    const initialDocument = { buffer, documentId: docId, name: docId }
    return [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [initialDocument],
      }),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(SpreadPluginPackage, {
        defaultSpreadMode: SpreadMode.None,
      }),
      createPluginRegistration(ScrollPluginPackage, {
        defaultBufferSize: 2,
        defaultStrategy: ScrollStrategy.Vertical,
      }),
      createPluginRegistration(RenderPluginPackage, {
        defaultImageType: 'image/bmp',
      }),
      createPluginRegistration(TilingPluginPackage),
      createPluginRegistration(ZoomPluginPackage, {
        defaultZoomLevel: ZoomMode.FitWidth,
        minZoom: PDF_ZOOM_MIN,
        maxZoom: PDF_ZOOM_MAX,
      }),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage, {
        marquee: { enabled: false },
      }),
      createPluginRegistration(SearchPluginPackage),
      createPluginRegistration(BookmarkPluginPackage),
      createPluginRegistration(AnnotationPluginPackage, {
        autoOpenLinks: false,
      }),
    ]
  }, [buffer, docId])

  if (engineError !== '') {
    return <p className="m-0 flex flex-1 items-center px-3 text-sm font-medium text-muted-foreground">{engineError}</p>
  }
  if (engine === undefined) {
    return <p className="m-0 flex flex-1 items-center px-3 text-sm font-medium text-muted-foreground">{t('loading')}</p>
  }

  return (
    <EmbedPDF key={docId} engine={engine} plugins={plugins}>
      <DocumentContent documentId={docId}>
        {({ isLoaded, isError, documentState }) => {
          if (isError) {
            const detail = documentState.error ?? ''
            return (
              <p className="m-0 flex flex-1 items-center px-3 text-sm font-medium text-muted-foreground">
                {detail === '' ? t('loadFailed') : detail}
              </p>
            )
          }
          if (!isLoaded) {
            return <p className="m-0 flex flex-1 items-center px-3 text-sm font-medium text-muted-foreground">{t('loading')}</p>
          }
          return <ReaderChrome {...props} engine={engine} />
        }}
      </DocumentContent>
    </EmbedPDF>
  )
}

type ReaderChromeProps = EmbedReaderProps & { engine: PdfEngine }

function ReaderChrome(props: ReaderChromeProps): ReactNode {
  const { docId, marks, pdfTone, onSetPdfTone, onSelect, onDeselect, saveBookmarks, translate, loadLayout, translatePin, menu, selectionClearVersion, engine, t } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const pageFocusedRef = useRef(false)
  const [pageField, setPageField] = useState('1')
  const scroll = useScroll(docId)
  const zoom = useZoom(docId)
  const { provides: selection } = useSelectionCapability()
  const page = scroll.state.currentPage
  const total = scroll.state.totalPages
  const zoomLevel = zoom.state.currentZoomLevel
  const zoomRef = useRef(zoomLevel)
  zoomRef.current = zoomLevel
  const documentState = useDocumentState(docId)
  const documentStateRef = useRef(documentState)
  documentStateRef.current = documentState
  const [translateOpen, setTranslateOpen] = useState(false)

  useEffect(() => {
    if (selectionClearVersion === 0 || selection === null) return
    selection.forDocument(docId).clear()
  }, [selection, docId, selectionClearVersion])

  useEffect(() => {
    if (pageFocusedRef.current) return
    if (page > 0) setPageField(String(page))
  }, [page])

  useEffect(() => {
    if (selection === null) return undefined
    const scope = selection.forDocument(docId)
    return scope.onEndSelection(() => {
      const pages = selection.getFormattedSelection(docId)
      const anchor = pages[pages.length - 1]
      if (anchor === undefined) return
      const host = hostRef.current
      const pageEl = host?.querySelector(`[${EMBED_PAGE_ATTR}="${anchor.pageIndex}"]`)
      let screenX = 0
      let screenY = 0
      if (pageEl instanceof HTMLElement) {
        const box = pageEl.getBoundingClientRect()
        const scale = zoomRef.current
        screenX = box.left + (anchor.rect.origin.x + anchor.rect.size.width / 2) * scale
        screenY = box.top + anchor.rect.origin.y * scale
      }
      const pageNumber = anchor.pageIndex + 1
      const rects: PdfRect[] = anchor.segmentRects.length > 0 ? anchor.segmentRects : [anchor.rect]
      const size = documentStateRef.current?.document?.pages[anchor.pageIndex]?.size
      void selection.getSelectedText(docId).toPromise().then((lines) => {
        const quote = (lines ?? []).join(' ').replace(/\s+/g, ' ').trim()
        if (quote === '') return
        onSelect({
          quote,
          page: pageNumber,
          rects,
          pageWidth: size !== undefined && size.width > 0 ? size.width : 0,
          pageHeight: size !== undefined && size.height > 0 ? size.height : 0,
          screenX,
          screenY,
        })
      }).catch(() => undefined)
    })
  }, [selection, docId, onSelect])

  useEffect(() => {
    if (selection === null) return undefined
    const scope = selection.forDocument(docId)
    return scope.onSelectionChange((range) => {
      if (range === null) onDeselect()
    })
  }, [selection, docId, onDeselect])

  const commitPageField = (): void => {
    const parsed = Number.parseInt(pageField, 10)
    if (!Number.isFinite(parsed)) {
      setPageField(String(Math.max(page, 1)))
      return
    }
    const next = Math.min(Math.max(total, 1), Math.max(1, parsed))
    setPageField(String(next))
    scroll.provides?.scrollToPage({ pageNumber: next })
  }

  const translation = usePageTranslation({
    open: translateOpen,
    currentPage: Math.max(1, page),
    document: documentState?.document,
    engine,
    loadLayout: signal => loadLayout(docId, signal),
    translate,
  })

  const renderPage = useCallback((layout: PageLayout) => (
    <PdfPage
      documentId={docId}
      layout={layout}
      marks={marks}
      pdfTone={pdfTone}
      translation={translateOpen ? translation.pages.get(layout.pageIndex) : undefined}
      translatePin={translatePin}
      t={t}
    />
  ), [docId, marks, pdfTone, t, translateOpen, translation.pages, translatePin])

  return (
    <div className="relative h-full min-h-0">
      <div ref={hostRef} className="absolute inset-0">
        <Viewport documentId={docId} className="h-full bg-muted/40">
          <PanDragHandler hostRef={hostRef} />
          <ZoomGestureWrapper documentId={docId} enableWheel>
            <GlobalPointerProvider documentId={docId}>
              <Scroller documentId={docId} renderPage={renderPage} />
            </GlobalPointerProvider>
          </ZoomGestureWrapper>
        </Viewport>
      </div>
      {menu}
      <PdfFindLayer docId={docId} hostRef={hostRef} t={t} />
      <PdfToolbar
        notesOpen={props.notesOpen}
        onToggleNotes={props.onToggleNotes}
        comments={props.marks.flatMap(mark => (
          mark.kind === 'highlight' && mark.note.trim() !== ''
            ? [{ id: mark.id, page: mark.page, note: mark.note }]
            : []
        ))}
        translating={translateOpen && translation.running}
        translateOpen={translateOpen}
        onToggleTranslate={() => {
          selection?.forDocument(docId).clear()
          onDeselect()
          setTranslateOpen(value => !value)
        }}
        t={t}
      />
      {translateOpen && (!translation.running && translation.pages.get(Math.max(0, page - 1))?.source.paragraphs.length === 0) ? (
        <div data-pdf-chrome role="status" className={cn('absolute top-12 right-3 z-30 max-w-80 p-2 text-xs', PDF_FLOAT_CARD)}>
          {t('translationEmpty')}
        </div>
      ) : null}
      <PdfOutlineLayer
        docId={docId}
        currentPage={Math.max(page, 1)}
        onGoToPage={(pageNumber) => { scroll.provides?.scrollToPage({ pageNumber }) }}
        onSave={saveBookmarks}
        t={t}
      />
      <PdfBottomBar
        totalPages={total}
        pageField={pageField}
        onPageFieldChange={setPageField}
        pageFocusedRef={pageFocusedRef}
        onCommitPageField={commitPageField}
        pdfTone={pdfTone}
        onSetPdfTone={onSetPdfTone}
        zoomLevel={zoomLevel}
        onZoomChange={(level) => { zoom.provides?.requestZoom(level) }}
        t={t}
      />
    </div>
  )
}

function PdfPage(props: {
  documentId: string
  layout: PageLayout
  marks: readonly PaintMark[]
  pdfTone: PdfPaperTone
  translation: TranslatedPage | undefined
  translatePin: EmbedReaderProps['translatePin']
  t: PdfT
}): ReactNode {
  const { documentId, layout, marks, pdfTone, translation, translatePin, t } = props
  const documentState = useDocumentState(documentId)
  const size = documentState?.document?.pages[layout.pageIndex]?.size
  const cssW = layout.rotatedWidth || layout.width
  const cssH = layout.rotatedHeight || layout.height
  const pageNumber = layout.pageIndex + 1
  const pageMarks = marks.filter(mark => mark.page === pageNumber)
  const pageSize = {
    width: size?.width && size.width > 0 ? size.width : cssW,
    height: size?.height && size.height > 0 ? size.height : cssH,
  }
  const dark = pdfTone === 'dark'
  const pinRect = translatePin !== undefined && translatePin.page === pageNumber
    ? translatePin.rects[0]
    : undefined
  const pinX = pinRect !== undefined && translatePin !== undefined && translatePin.pageSize.width > 0
    ? (pinRect.origin.x + pinRect.size.width) / translatePin.pageSize.width
    : 0
  const pinY = pinRect !== undefined && translatePin !== undefined && translatePin.pageSize.height > 0
    ? pinRect.origin.y / translatePin.pageSize.height
    : 0
  const overlays = pageMarks.flatMap(mark => mark.rects.map((rect, index) => {
    const x = mark.space === 'pt' ? rect.x / pageSize.width : rect.x
    const y = mark.space === 'pt' ? rect.y / pageSize.height : rect.y
    const w = mark.space === 'pt' ? rect.w / pageSize.width : rect.w
    const h = mark.space === 'pt' ? rect.h / pageSize.height : rect.h
    const color = mark.kind === 'translate'
      ? 'rgba(80, 140, 255, 0.28)'
      : mark.kind === 'ask'
        ? 'rgba(80, 180, 120, 0.28)'
        : mark.kind === 'visual'
          ? 'rgba(120, 120, 120, 0.14)'
          : highlightFill(mark.color ?? DEFAULT_HIGHLIGHT_COLOR)
    return (
      <div
        key={`${mark.id}:${index}`}
        className="pointer-events-none absolute z-[1]"
        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%`, background: color }}
      />
    )
  }))

  return (
    <PagePointerProvider
      documentId={documentId}
      pageIndex={layout.pageIndex}
      {...{ [EMBED_PAGE_ATTR]: layout.pageIndex }}
      className={cn('relative', PDF_PAPER_SHELL_CLASS[pdfTone])}
      style={{ width: cssW, height: cssH }}
    >
      <RenderLayer
        documentId={documentId}
        pageIndex={layout.pageIndex}
        className={cn('pointer-events-none absolute inset-0', dark && PDF_PAGE_RASTER_DARK_CLASS)}
      />
      <TilingLayer
        documentId={documentId}
        pageIndex={layout.pageIndex}
        className={cn('pointer-events-none absolute inset-0', dark && PDF_PAGE_RASTER_DARK_CLASS)}
      />
      {overlays}
      <PdfLinkLayer
        docId={documentId}
        pageIndex={layout.pageIndex}
        pageWidth={pageSize.width}
        pageHeight={pageSize.height}
        t={t}
      />
      <PdfSearchLayer docId={documentId} pageIndex={layout.pageIndex} />
      <SelectionLayer documentId={documentId} pageIndex={layout.pageIndex} />
      <PageTranslationOverlay state={translation} width={cssW} height={cssH} tone={pdfTone} />
      <CommentCards marks={pageMarks} pageHeight={cssH} pageSize={pageSize} t={t} />
      {pinRect === undefined || translatePin === undefined ? null : (
        <TranslateCardPin x={pinX} y={pinY} onOpen={translatePin.onOpen} t={t} />
      )}
    </PagePointerProvider>
  )
}
