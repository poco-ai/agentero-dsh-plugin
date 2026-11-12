import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Languages, Loader2, NotebookPen } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from './button'
import { cn } from './cn'
import { PDF_CHROME_CHIP, PDF_FLOAT_CARD } from './pdf-chrome-surface'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

type PdfT = PropsLocale<'agentero.pdf'>['t']

export interface PdfComment {
  id: string
  page: number
  note: string
}

/** Top-right chrome: notes, comments, and full-text translate. */
export function PdfToolbar({
  notesOpen,
  onToggleNotes,
  comments,
  translating,
  translateOpen,
  onToggleTranslate,
  t,
}: {
  notesOpen: boolean
  onToggleNotes?: () => void
  comments: readonly PdfComment[]
  translating: boolean
  translateOpen: boolean
  onToggleTranslate: () => void
  t: PdfT
}): ReactNode {
  const [commentsOpen, setCommentsOpen] = useState(false)
  useEffect(() => {
    if (!commentsOpen) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCommentsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [commentsOpen])

  return (
    <div className="absolute top-2 right-3 z-30">
      <TooltipProvider>
        <div
          data-pdf-chrome
          className={cn(
            'flex h-7 items-center gap-0.5 rounded-lg p-0.5',
            PDF_CHROME_CHIP,
          )}
        >
          {onToggleNotes === undefined ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="icon-xs" variant={notesOpen ? 'secondary' : 'ghost'}
                  aria-pressed={notesOpen} aria-label={t('notes')} onClick={onToggleNotes}>
                  <NotebookPen className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('notes')}</TooltipContent>
            </Tooltip>
          )}
          {comments.length === 0 ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon-xs"
                  variant={commentsOpen ? 'secondary' : 'ghost'}
                  aria-expanded={commentsOpen}
                  aria-haspopup="dialog"
                  aria-label={t('comments')}
                  onClick={() => { setCommentsOpen(open => !open) }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setCommentsOpen(true)
                  }}
                >
                  <span className="size-2.5 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.85)]" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('comments')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-xs"
                variant={translateOpen ? 'secondary' : 'ghost'}
                aria-pressed={translateOpen}
                aria-label={translateOpen ? t('showOriginal') : t('translateAll')}
                onClick={onToggleTranslate}
              >
                {translating ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Languages className="size-3.5" aria-hidden />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{translateOpen ? t('showOriginal') : t('translateAll')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      {comments.length === 0 || !commentsOpen ? null : (
        <div
          role="dialog"
          aria-label={t('comments')}
          data-pdf-chrome
          className={cn('absolute top-full right-0 mt-1 max-h-72 w-64 overflow-y-auto p-2', PDF_FLOAT_CARD)}
          onContextMenu={(event) => { event.preventDefault() }}
        >
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {comments.map(comment => (
              <li key={comment.id} className="text-sm leading-relaxed">
                <span className="text-xs text-muted-foreground">{t('commentPage').replace('{page}', String(comment.page))}</span>
                <p className="m-0 whitespace-pre-wrap break-words text-foreground/90">{comment.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

