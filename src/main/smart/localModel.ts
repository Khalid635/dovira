/**
 * Phase 7 (v1.0) — local-model hook (OPTIONAL).
 *
 * Calls a local Ollama or LM Studio server for the cases the rules cannot
 * decide (ambiguous category / garbled title). Default OFF, no model is
 * bundled, one call per download at most, 5s timeout — any failure falls
 * back to the rules silently. Nothing leaves the machine: the endpoint is
 * localhost by default.
 */
import { CATEGORIES, type Category } from './categorize.ts'
import { classifyLocalModelTestError } from '../util/errors.ts'

export interface LocalModelSettings {
  enabled: boolean
  provider: 'ollama' | 'lmstudio'
  endpoint: string
  model: string
}

const TIMEOUT_MS = 5000

function baseUrl(endpoint: string): string {
  return endpoint.replace(/\/+$/, '')
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) return null
  return (await res.json()) as unknown
}

/** One prompt to the local model. Returns the raw text, or null on any failure. */
export async function askLocalModel(s: LocalModelSettings, prompt: string): Promise<string | null> {
  if (!s.enabled || !s.endpoint || !s.model) return null
  try {
    const base = baseUrl(s.endpoint)
    if (s.provider === 'lmstudio') {
      const json = await postJson(`${base}/v1/chat/completions`, {
        model: s.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 64
      })
      const content = (json as { choices?: { message?: { content?: unknown } }[] } | null)
        ?.choices?.[0]?.message?.content
      return typeof content === 'string' ? content : null
    }
    const json = await postJson(`${base}/api/generate`, {
      model: s.model,
      prompt,
      stream: false
    })
    const response = (json as { response?: unknown } | null)?.response
    return typeof response === 'string' ? response : null
  } catch {
    // Timeout, connection refused, bad JSON — the caller falls back to rules.
    return null
  }
}

/** Ask the local model to pick a category for a title. Null = use the rules. */
export async function askCategory(s: LocalModelSettings, title: string): Promise<Category | null> {
  const prompt =
    `Categorize this download title into exactly one of: ${CATEGORIES.join(', ')}.\n` +
    `Title: ${title}\n` +
    `Reply with only the category name.`
  const answer = await askLocalModel(s, prompt)
  if (!answer) return null
  const cleaned = answer.trim().replace(/[."']/g, '')
  const match = CATEGORIES.find((c) => c.toLowerCase() === cleaned.toLowerCase())
  return match ?? null
}

/**
 * Settings > Smart "Test" button: is a model reachable at this endpoint?
 * Issue #5: the result now says WHAT failed — no endpoint/model set,
 * unreachable, timed out, server error, or a bad (empty/unusable) answer —
 * so the Settings status line can name it instead of showing only ok/fail.
 * Same request shape as askLocalModel, but with the failure classified
 * instead of collapsed to null.
 */
export async function testLocalModel(
  s: LocalModelSettings
): Promise<{ ok: boolean; error?: string }> {
  if (!s.endpoint) return { ok: false, error: 'no-endpoint' }
  if (!s.model) return { ok: false, error: 'no-model' }
  const base = baseUrl(s.endpoint)
  const isLmStudio = s.provider === 'lmstudio'
  const url = isLmStudio ? `${base}/v1/chat/completions` : `${base}/api/generate`
  const body = isLmStudio
    ? {
        model: s.model,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        temperature: 0,
        max_tokens: 64
      }
    : { model: s.model, prompt: 'Reply with the single word: ok', stream: false }
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    return { ok: false, error: classifyLocalModelTestError(err) }
  }
  if (!res.ok) return { ok: false, error: 'http' }
  let json: unknown
  try {
    json = (await res.json()) as unknown
  } catch {
    return { ok: false, error: 'bad-answer' }
  }
  const content = isLmStudio
    ? (json as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message
        ?.content
    : (json as { response?: unknown } | null)?.response
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { ok: false, error: 'bad-answer' }
  }
  return { ok: true }
}
