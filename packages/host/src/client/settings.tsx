/** Shared Agentero settings for the Settings dialog and Plugins page. */
import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AlertCircle, BookOpen, Check, Download, FolderOpen, FolderPlus, Github, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AgenteroSettingsFace } from './settings-model'
import { Button, buttonVariants } from '@/ui/button'
import { Input } from '@/ui/input'
import { cn } from '@/utils'

/** Vault facts the page reads before offering the native picker. */
export interface SettingsVault {
  path: string
  canPick: boolean
}

/** Local CLI state reported by the Host; mirrors `cliStatus` on the Node side. */
export interface SettingsCliStatus {
  available: boolean
  /** False when the CLI predates the commands this plugin calls. */
  supported: boolean
  minimumVersion: string
  version: string | null
  bin: string | null
  source: 'configured' | 'managed' | null
  configured: string
  managedPath: string | null
  managedInstalled: boolean
  shimPath: string
  shimInstalled: boolean
  shimOnPath: boolean
  canInstall: boolean
  platform: string | null
  releasePageUrl: string
  installing: boolean
  installError: string | null
}

/** Host calls the page uses for the vault; the CLI field persists through the form face. */
export interface SettingsFace {
  loadVault(): Promise<SettingsVault>
  pickVault(): Promise<string | null>
  saveVault(path: string): Promise<void>
  createVault(path: string): Promise<void>
  loadCli(): Promise<SettingsCliStatus>
  installCli(): Promise<SettingsCliStatus>
  reload(): void
}

export type AgenteroFace = SettingsFace & AgenteroSettingsFace

export type AgenteroSettingsProps =
  PropsLocale<'agentero.settings'>
  & InjectFace<AgenteroFace>

export type SettingsLocaleKey =
  | 'pluginSummary'
  | 'nav' | 'vaultTitle' | 'vaultPlaceholder' | 'choose' | 'apply' | 'applying' | 'invalidVault'
  | 'createVault' | 'creating' | 'createFailed'
  | 'cliTitle' | 'cliPlaceholder' | 'save' | 'saving' | 'saved' | 'saveFailed' | 'reset'
  | 'cliChecking' | 'cliReady' | 'cliMissing' | 'cliOutdated' | 'cliOutdatedHint' | 'cliUpdate' | 'cliStatusFailed'
  | 'install' | 'installing' | 'installFailed'
  | 'promoTitle' | 'promoDescription' | 'promoGithub'
  | 'loadFailed' | 'unavailable'

export const en: Record<SettingsLocaleKey, string> = {
  nav: 'Agentero',
  pluginSummary: 'Configure the knowledge base and Agentero CLI.',
  vaultTitle: 'Knowledge base',
  vaultPlaceholder: '/path/to/vault',
  choose: 'Choose folder',
  apply: 'Apply',
  applying: 'Applying…',
  invalidVault: 'Choose an existing Agentero Vault folder.',
  createVault: 'New vault',
  creating: 'Creating…',
  createFailed: 'Could not create the vault.',
  cliTitle: 'Agentero CLI',
  cliPlaceholder: 'agentero',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'The Host did not accept this change.',
  reset: 'Reset to default',
  cliChecking: 'Checking…',
  cliReady: 'Ready',
  cliMissing: 'Not found',
  cliOutdated: 'Too old',
  cliOutdatedHint: 'This plugin needs Agentero CLI {version} or newer. Update it to list, import, and organize papers.',
  cliUpdate: 'Update',
  cliStatusFailed: 'Could not read the CLI status.',
  install: 'Install',
  installing: 'Installing…',
  installFailed: 'Could not install the CLI.',
  promoTitle: 'Agentero for desktop',
  promoDescription: 'A local-first research workbench for papers, PDF reading, notes, and citations.',
  promoGithub: 'GitHub',
  loadFailed: 'Could not read the current knowledge base.',
  unavailable: 'These settings are not available in this deployment.',
}

export const zh: Record<SettingsLocaleKey, string> = {
  nav: 'Agentero',
  pluginSummary: '配置知识库和 Agentero CLI。',
  vaultTitle: '知识库',
  vaultPlaceholder: '/path/to/vault',
  choose: '选择目录',
  apply: '应用',
  applying: '应用中…',
  invalidVault: '请选择一个有效的 Agentero Vault 目录。',
  createVault: '新建知识库',
  creating: '创建中…',
  createFailed: '无法创建知识库。',
  cliTitle: 'Agentero CLI',
  cliPlaceholder: 'agentero',
  save: '保存',
  saving: '保存中…',
  saved: '已保存',
  saveFailed: 'Host 没有接受这次修改。',
  reset: '恢复默认',
  cliChecking: '检查中…',
  cliReady: '可用',
  cliMissing: '未找到',
  cliOutdated: '版本过旧',
  cliOutdatedHint: '本插件需要 Agentero CLI {version} 或更高版本，请更新后再使用知识库功能。',
  cliUpdate: '更新',
  cliStatusFailed: '无法读取 CLI 状态。',
  install: '安装',
  installing: '安装中…',
  installFailed: '无法安装 CLI。',
  promoTitle: 'Agentero 桌面版',
  promoDescription: '本地优先的科研工作台：论文、PDF 阅读、笔记与引用集中在一处。',
  promoGithub: 'GitHub',
  loadFailed: '无法读取当前知识库。',
  unavailable: '当前部署不提供这项设置。',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'agentero.settings': SettingsLocaleKey
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback
}

/** One-line CLI verdict: installing, ready, too old, missing, or still unknown. */
function CliStatusBadge({ status, loading, t }: {
  status: SettingsCliStatus | null
  loading: boolean
  t: PropsLocale<'agentero.settings'>['t']
}) {
  if (status?.installing === true) {
    return <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <LoaderCircle className="size-3 animate-spin" aria-hidden />{t('installing')}
    </span>
  }
  if (status === null) {
    return <span className="text-xs text-muted-foreground">{loading ? t('cliChecking') : t('cliStatusFailed')}</span>
  }
  const version = status.version === null ? '' : ` · v${status.version}`
  if (!status.available) {
    return <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <AlertCircle className="size-3" aria-hidden />{t('cliMissing')}
    </span>
  }
  if (!status.supported) {
    return <span className="flex items-center gap-1 text-xs text-destructive" title={status.bin ?? undefined}>
      <AlertCircle className="size-3" aria-hidden />{t('cliOutdated')}{version}
    </span>
  }
  return <span className="flex items-center gap-1 text-xs text-muted-foreground" title={status.bin ?? undefined}>
    <Check className="size-3" aria-hidden />{t('cliReady')}{version}
  </span>
}

// The plugin owner supplies a generic form; both entry points use our shared model instead.
export function AgenteroPluginSettings(props: AgenteroSettingsProps & PluginConfigViewProps) {
  if (props.view === 'summary') return <>{props.t('pluginSummary')}</>
  return <AgenteroSettings {...props} />
}

/** Render the shared knowledge base and CLI fields. */
export function AgenteroSettings(props: AgenteroSettingsProps) {
  const { t } = props
  const state = props.useAgenteroSettings(snapshot => snapshot)
  const [vault, setVault] = useState('')
  const [vaultDraft, setVaultDraft] = useState('')
  const [canPick, setCanPick] = useState(false)
  const [picking, setPicking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [creating, setCreating] = useState(false)
  const [vaultError, setVaultError] = useState('')
  const [saved, setSaved] = useState(false)
  const [cli, setCli] = useState<SettingsCliStatus | null>(null)
  const [cliLoading, setCliLoading] = useState(true)
  const [cliError, setCliError] = useState('')
  const [installing, setInstalling] = useState(false)
  const saving = useRef(false)

  useEffect(() => {
    let cancelled = false
    props.loadVault().then((info) => {
      if (cancelled) return
      setVault(info.path)
      setVaultDraft(info.path)
      setCanPick(info.canPick)
    }).catch((error: unknown) => {
      if (!cancelled) setVaultError(messageOf(error, t('loadFailed')))
    })
    return () => { cancelled = true }
  }, [props.loadVault, t])

  useEffect(() => {
    let cancelled = false
    props.loadCli().then((status) => {
      if (!cancelled) setCli(status)
    }).catch((error: unknown) => {
      if (!cancelled) setCliError(messageOf(error, t('cliStatusFailed')))
    }).finally(() => {
      if (!cancelled) setCliLoading(false)
    })
    return () => { cancelled = true }
  }, [props.loadCli, t])

  useEffect(() => {
    if (state.saving) {
      saving.current = true
      setSaved(false)
      return
    }
    if (!saving.current) return
    saving.current = false
    if (!state.failed) setSaved(true)
  }, [state.saving, state.failed])

  useEffect(() => {
    if (!saved) return
    let cancelled = false
    props.loadCli().then((status) => {
      if (!cancelled) setCli(status)
    }).catch(() => {
      // The saved path stays visible; the next settings open retries the probe.
    })
    return () => { cancelled = true }
  }, [saved, props.loadCli])

  useEffect(() => {
    if (cli?.installing !== true) return
    let cancelled = false
    const timer = setInterval(() => {
      props.loadCli().then((status) => {
        if (!cancelled) setCli(status)
      }).catch(() => {
        // Keep the last known state; the next tick retries.
      })
    }, 2_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [cli?.installing, props.loadCli])

  const busy = picking || applying || creating
  const installingCli = installing || cli?.installing === true
  const cliFailure = cliError !== '' ? cliError : cli?.installError ?? ''
  /** A missing CLI and one too old for this plugin are both fixed by an install. */
  const cliUnusable = cli === null || !cli.available || !cli.supported
  const draft = vaultDraft.trim()
  const vaultReady = draft !== '' && draft !== vault && !busy
  const disabled = !state.writable || state.saving

  const pick = async (): Promise<void> => {
    setPicking(true)
    setVaultError('')
    try {
      const path = await props.pickVault()
      if (path !== null) setVaultDraft(path)
    } catch (error) {
      setVaultError(messageOf(error, t('loadFailed')))
    } finally {
      setPicking(false)
    }
  }

  const applyVault = async (): Promise<void> => {
    if (!vaultReady) return
    setApplying(true)
    setVaultError('')
    try {
      await props.saveVault(draft)
      props.reload()
    } catch (error) {
      const message = messageOf(error, t('saveFailed'))
      setVaultError(message === 'invalid vault' ? t('invalidVault') : message)
    } finally {
      setApplying(false)
    }
  }

  const createVault = async (): Promise<void> => {
    setCreating(true)
    setVaultError('')
    try {
      const path = await props.pickVault()
      if (path === null) return
      await props.createVault(path)
      props.reload()
    } catch (error) {
      setVaultError(messageOf(error, t('createFailed')))
    } finally {
      setCreating(false)
    }
  }

  const installCli = async (): Promise<void> => {
    setInstalling(true)
    setCliError('')
    try {
      setCli(await props.installCli())
    } catch (error) {
      setCliError(messageOf(error, t('installFailed')))
      // The POST may have reached the Host even when the response was lost.
      try { setCli(await props.loadCli()) } catch { /* keep the request error */ }
    } finally {
      setInstalling(false)
    }
  }

  return <div className="agentero-settings agentero-surface flex flex-col gap-6 py-1">
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[0.875rem] font-normal">{t('vaultTitle')}</h3>
      <div className="flex items-center gap-2">
        <Input
          value={vaultDraft}
          aria-label={t('vaultTitle')}
          placeholder={t('vaultPlaceholder')}
          spellCheck={false}
          disabled={busy}
          className="font-mono text-xs"
          onChange={(event) => { setVaultDraft(event.target.value) }}
        />
        {canPick ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void pick() }}>
          <FolderOpen aria-hidden />{t('choose')}
        </Button> : null}
        {canPick ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void createVault() }}>
          <FolderPlus aria-hidden />{creating ? t('creating') : t('createVault')}
        </Button> : null}
        <Button type="button" size="sm" disabled={!vaultReady} onClick={() => { void applyVault() }}>
          {applying ? t('applying') : t('apply')}
        </Button>
      </div>
      {vaultError !== '' ? <p role="status" className="text-xs text-destructive">{vaultError}</p> : null}
    </section>

    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[0.875rem] font-normal">{t('cliTitle')}</h3>
        <div className="flex items-center gap-2">
          <CliStatusBadge status={cli} loading={cliLoading} t={t} />
          {state.available && cliUnusable
            ? <Button
              type="button"
              size="sm"
              disabled={installingCli || (cli !== null && !cli.canInstall)}
              onClick={() => { void installCli() }}
            >
              <Download aria-hidden />{installingCli ? t('installing') : cli?.supported === false ? t('cliUpdate') : t('install')}
            </Button>
            : null}
        </div>
      </div>
      {cli?.available === true && !cli.supported
        ? <p role="status" className="text-xs text-muted-foreground">{t('cliOutdatedHint', { version: cli.minimumVersion })}</p>
        : null}
      {!state.available
        ? <p role="status" className="text-xs text-muted-foreground">{t('unavailable')}</p>
        : <div className="flex items-center gap-2">
          <Input
            value={state.agenteroBin.text}
            aria-label={t('cliTitle')}
            placeholder={t('cliPlaceholder')}
            spellCheck={false}
            disabled={disabled}
            className="font-mono text-xs"
            onChange={(event) => { props.edit('agenteroBin', event.target.value); setSaved(false) }}
          />
          {state.agenteroBin.overridden
            ? <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => { props.resetField('agenteroBin'); setSaved(false) }}>{t('reset')}</Button>
            : null}
          <Button type="button" size="sm" disabled={disabled || !state.dirty || state.invalid} onClick={() => { props.save() }}>
            {state.saving ? t('saving') : t('save')}
          </Button>
        </div>}
      {cliFailure !== '' ? <p role="status" className="text-xs text-destructive">{cliFailure}</p> : null}
      {state.failed ? <p role="status" className="text-xs text-destructive">{t('saveFailed')}</p> : null}
      {saved && !state.failed ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" aria-hidden />{t('saved')}</p> : null}
    </section>

    <section className="rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2 text-[0.875rem] font-normal">
          <BookOpen className="size-4" aria-hidden />{t('promoTitle')}
        </h3>
        <a
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')}
          href="https://github.com/poco-ai/Agentero"
          target="_blank"
          rel="noreferrer"
        >
          <Github aria-hidden />{t('promoGithub')}
        </a>
      </div>
      <p className="m-0 mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{t('promoDescription')}</p>
    </section>
  </div>
}
