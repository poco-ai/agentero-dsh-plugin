import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from './button'
import { LibraryActions } from './library-actions'
import { controlButtonClass, sortValue, type CellCtx, type ColumnKey, type SortDir } from './library-columns'
import { LibraryPaperRow } from './library-paper-row'
import { LibraryTableHeader } from './library-table-header'
import { filterPapers, papersFrom, shown, type LibraryFace, type PaperRow, type VaultInfo } from './papers'

type LibraryPanelProps =
  PropsRuntime<'sidebar.right.pane.tab'> &
  PropsLocale<'agentero.library'> &
  LibraryFace

function compareRows(a: PaperRow, b: PaperRow, key: ColumnKey, dir: SortDir): number {
  let cmp = sortValue(a, key).localeCompare(sortValue(b, key), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
  if (cmp === 0) cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  if (cmp === 0) cmp = a.openId.localeCompare(b.openId)
  return dir === 'asc' ? cmp : -cmp
}

function defaultSortDir(key: ColumnKey): SortDir {
  return key === 'year' ? 'desc' : 'asc'
}

export function LibraryPanel({
  t,
  loadPapers,
  openPaper,
  importId,
  importBib,
  exportBib,
  discover,
  addTag,
  removeTag,
  deletePaper,
  download,
  setRead,
  notifyError,
  loadVault,
}: LibraryPanelProps): ReactNode {
  const [vault, setVault] = useState<VaultInfo | null>(null)
  // Keep the mounted table and its scroll position during background reloads.
  const [papers, setPapers] = useState<PaperRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ id: string, title: string }[]>([])
  const [sortKey, setSortKey] = useState<ColumnKey>('title')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useEffect(() => {
    let cancelled = false
    loadVault().then((value) => { if (!cancelled) setVault(value) })
      .catch((error: unknown) => {
        if (cancelled) return
        notifyError(shown(error instanceof Error ? error.message : '', t))
        setVault({ path: '', name: '', scope: '', recentVaults: [], canPick: false })
      })
    return () => { cancelled = true }
  }, [loadVault, notifyError, t])

  useEffect(() => {
    if (vault === null) return
    if (vault.path === '') {
      setLoaded(true)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    loadPapers()
      .then((body) => {
        if (cancelled) return
        setPapers(papersFrom(body))
        setLoadError('')
        setLoaded(true)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = shown(error instanceof Error ? error.message : '', t)
        setLoadError(message)
        notifyError(message)
        setLoaded(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loadPapers, notifyError, revision, t, vault])

  const filtered = useMemo(() => {
    const copy = filterPapers(papers, query, unreadOnly)
    copy.sort((a, b) => compareRows(a, b, sortKey, sortDir))
    return copy
  }, [papers, query, unreadOnly, sortKey, sortDir])

  /** Resolves true when the action succeeded, so callers can clear their draft. */
  const run = useCallback((action: () => Promise<void>): Promise<boolean> => {
    setBusy(true)
    return Promise.resolve().then(action)
      .then(() => true)
      .catch((error: unknown) => {
        notifyError(shown(error instanceof Error ? error.message : '', t))
        return false
      })
      .finally(() => { setBusy(false) })
  }, [notifyError, t])

  const reload = useCallback((): void => { setRevision(value => value + 1) }, [])
  const addTagFor = useCallback((ref: string, tag: string): Promise<boolean> => run(async () => {
    await addTag(ref, tag)
    reload()
  }), [addTag, reload, run])
  const removeTagFor = useCallback((ref: string, tag: string): void => {
    void run(async () => {
      await removeTag(ref, tag)
      reload()
    })
  }, [reload, removeTag, run])
  const setReadFor = useCallback((paper: PaperRow, read: boolean): void => {
    void run(async () => {
      await setRead(paper.openId, read, paper.revision)
      setPapers(current => current.map(row => row.openId === paper.openId ? { ...row, isRead: read } : row))
      reload()
    })
  }, [reload, run, setRead])
  const openFor = useCallback((ref: string): void => {
    if (!openPaper(ref)) notifyError(t('pdfDisabled'))
  }, [notifyError, openPaper, t])
  const downloadFor = useCallback((ref: string): void => {
    void run(async () => { await download(ref) })
  }, [download, run])
  const deleteFor = useCallback((ref: string): void => {
    void run(async () => {
      await deletePaper(ref)
      reload()
    })
  }, [deletePaper, reload, run])
  const ctx = useMemo<CellCtx>(() => ({
    t,
    busy,
    onAddTag: addTagFor,
    onRemoveTag: removeTagFor,
  }), [addTagFor, busy, removeTagFor, t])

  const onSort = (key: ColumnKey): void => {
    if (key === sortKey) {
      setSortDir(dir => dir === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortKey(key)
    setSortDir(defaultSortDir(key))
  }

  const actions = <LibraryActions
    t={t}
    busy={busy || loading}
    onReload={reload}
    onImport={(text) => run(async () => { await importId(text); reload() })}
    onDiscover={(keyword) => run(async () => { setFound(await discover(keyword)) })}
    onImportBib={(file) => run(async () => { await importBib(await file.text()); reload() })}
    onExport={() => {
      void run(async () => {
        const blob = new Blob([await exportBib()], { type: 'application/x-bibtex' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'library.bib'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
      })
    }}
  />

  return (
    <div className='agentero-library agentero-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground'>
      {found.length === 0 ? null : (
        <div className='flex shrink-0 items-start gap-2 border-b border-border/40 px-3 py-2'>
          <div className='flex min-w-0 flex-1 flex-col gap-1'>
            {found.map(item => (
              <Button key={item.id} type='button' variant='ghost' size='sm' disabled={busy} className='w-full justify-start' title={item.title} onClick={() => {
                void run(async () => {
                  await importId(item.id)
                  setFound(current => current.filter(row => row.id !== item.id))
                  reload()
                })
              }}><span className='min-w-0 truncate'>{item.title}</span></Button>
            ))}
          </div>
          <button type='button' className={controlButtonClass()} aria-label={t('clearResults')} onClick={() => { setFound([]) }}><X className='size-3.5' aria-hidden /></button>
        </div>
      )}
      <div data-library-scroll className='relative min-h-0 min-w-0 flex-1 overflow-auto' aria-busy={loading || busy}>
        <table className='w-full min-w-[38rem] table-fixed border-collapse text-left text-sm'>
          <colgroup>
            <col />
            <col style={{ width: '20%' }} />
            <col style={{ width: '4.5rem' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '4rem' }} />
          </colgroup>
          <LibraryTableHeader t={t} sortKey={sortKey} sortDir={sortDir} onSort={onSort} inputValue={query} onInputChange={setQuery} unreadOnly={unreadOnly} onUnreadOnlyChange={setUnreadOnly} actions={actions} />
          <tbody>
            {filtered.map(paper => <LibraryPaperRow key={paper.key} paper={paper} ctx={ctx} busy={busy || loading} onSetRead={setReadFor} onOpen={openFor} onDownload={downloadFor} onDelete={deleteFor} />)}
          </tbody>
        </table>
        {filtered.length !== 0 ? null : (
          <div className='sticky left-0 flex min-h-48 flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground' role='status'>
            <span>{!loaded ? t('loading') : vault?.path === '' ? t('vaultMissing') : loadError !== '' ? loadError : papers.length === 0 ? t('empty') : t('noMatches')}</span>
            {loadError === '' ? null : <Button variant='ghost' size='sm' disabled={loading} onClick={reload}>{t('refresh')}</Button>}
          </div>
        )}
      </div>
      <div className='shrink-0 border-t border-border/40 px-3 py-2 text-caption tabular-nums text-muted-foreground' role='status'>
        {t(query.trim() === '' && !unreadOnly ? 'paperCount' : 'filteredCount', { count: filtered.length, total: papers.length })}
      </div>
    </div>
  )
}
