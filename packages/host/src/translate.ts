/** One-shot PDF translation through the Harness model registry. No chat session or tools are used. */

import { randomUUID } from 'node:crypto'

import { retryTranslation } from './translation/retry.js'
import { buildTranslateMessages } from './translation/prompt.js'
import { translateDocumentText } from './translation/pipeline.js'

/** Stable per-process identity; relays use it for routing and prompt-cache affinity. */
const SESSION_ID = randomUUID()

export interface TranslationSettings {
  translationProvider: string
  translationModel: string
  translationSystemPrompt?: string
  translationUserPrompt?: string
}

interface CallControls {
  temperature?: number
  maxTokens?: number
  reasoningEffort?: string
}

interface CallConfig extends CallControls {
  provider: string
  model: string
}

/** Routing identity forwarded as transport metadata; some providers reject calls without one. */
interface CallIdentity {
  sessionId?: string
}

/** Minimal public dsh-llm seam, like the host's other injected service faces. */
export interface TranslationLlm {
  prepareCall(
    config: CallConfig,
    signal: AbortSignal,
    configure: (controls: CallControls, model: {
      reasoning?: { efforts: readonly { id: string }[] }
    }) => CallControls,
  ): Promise<{
    config: CallConfig
    stream(options: CallConfig & CallIdentity & {
      system: string
      messages: { role: 'user', content: { type: 'text', text: string }[] }[]
      signal: AbortSignal
    }): AsyncIterable<{
      type: string
      index?: number
      block?: { type: string, text?: string }
      reason?: { kind: string, failure?: { message: string, status?: number, statusCode?: number, code?: string } }
    }>
  }>
}

export interface DefaultTranslationModel {
  currentSelection(): { provider: string, model: string }
}

export type TranslateText = (text: string, target: string, signal: AbortSignal) => Promise<string>

export function translationTarget(value: unknown): string {
  const target = typeof value === 'string' ? value.trim() : ''
  return /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})?$/.test(target) ? target : 'zh-CN'
}

/** The prompt rules and customization semantics are shared with motif. */
export function translationMessages(text: string, target: string, settings: TranslationSettings): { system: string, user: string } {
  const language = /^zh(?:-CN)?$/i.test(target) ? 'Simplified Chinese'
    : /^zh-(TW|HK)$/i.test(target) ? 'Traditional Chinese'
      : /^en(?:-|$)/i.test(target) ? 'English' : target
  return buildTranslateMessages({ text, targetLangName: language,
    customSystem: settings.translationSystemPrompt, customUser: settings.translationUserPrompt })
}

export function createTranslator(
  settings: TranslationSettings,
  getLlm: () => TranslationLlm | undefined,
  getDefault: () => DefaultTranslationModel | undefined,
): TranslateText {
  return async (input, target, parentSignal) => {
    const text = input.trim()
    if (text === '' || text.length > 20_000) throw new Error('Translation requires 1–20000 characters.')
    const provider = settings.translationProvider.trim()
    const model = settings.translationModel.trim()
    if ((provider === '') !== (model === '')) {
      throw new Error('Configure translationProvider and translationModel together in agentero-host.')
    }
    const route = provider === '' ? getDefault()?.currentSelection() : { provider, model }
    if (route === undefined || route.provider === '' || route.model === '') {
      throw new Error('Select a default model in Harness, or configure translationProvider and translationModel in agentero-host.')
    }
    const llm = getLlm()
    if (llm === undefined) throw new Error('Harness LLM service is unavailable. Enable a model provider for PDF translation.')
    const operationSignal = AbortSignal.any([parentSignal, AbortSignal.timeout(300_000)])
    const translateChunk = (source: string): Promise<string> => retryTranslation(async () => {
      const signal = AbortSignal.any([operationSignal, AbortSignal.timeout(90_000)])
      signal.throwIfAborted()
      const call = await llm.prepareCall({ provider: route.provider, model: route.model, temperature: 0.2, maxTokens: 8192 }, signal, (controls, info) => {
        // Effort IDs belong to the adapter. Its catalog orders them least to greatest.
        const effort = info.reasoning?.efforts[0]?.id
        return { ...controls, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
      })
      signal.throwIfAborted()
      const messages = translationMessages(source, translationTarget(target), settings)
      const blocks = new Map<number, string>()
      let complete = false
      for await (const chunk of call.stream({
        ...call.config,
        system: messages.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: messages.user }] }],
        signal,
        sessionId: SESSION_ID,
      })) {
        signal.throwIfAborted()
        // block-end is authoritative; accumulating deltas as well would duplicate text.
        if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string' && typeof chunk.index === 'number') {
          blocks.set(chunk.index, chunk.block.text)
        }
        if (chunk.type === 'finish') {
          if (chunk.reason?.kind !== 'stop') {
            const error = new Error(chunk.reason?.failure?.message ?? `Translation incomplete (${chunk.reason?.kind ?? 'unknown'}). Try a smaller selection.`)
            Object.assign(error, chunk.reason?.failure)
            if (chunk.reason?.kind === 'max-tokens') Object.assign(error, { code: 'TRANSLATION_INCOMPLETE' })
            throw error
          }
          complete = true
        }
      }
      signal.throwIfAborted()
      if (!complete) throw new Error('Translation stream ended before completion. Please retry.')
      const result = [...blocks].sort(([a], [b]) => a - b).map(([, value]) => value).join('\n').trim()
      if (result === '') throw new Error('The model returned no translation. Please retry or select another model.')
      return result
    }, operationSignal)
    return translateDocumentText(text, translationTarget(target), translateChunk, operationSignal)
  }
}
