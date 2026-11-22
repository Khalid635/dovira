/**
 * Phase 7 (v1.0) — local-model hook (OPTIONAL).
 *
 * Calls a local Ollama or LM Studio server for the cases the rules cannot
 * decide (ambiguous category / garbled title). Default OFF, no model is
 * bundled, one call per download at most, 5s timeout — any failure falls
 * back to the rules silently. Nothing leaves the machine: the endpoint is
 * localhost by default.
 */
import { CATEGORIES, type Category } from './categorize'

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

/** Settings > Smart "Test" button: is a model reachable at this endpoint? */
export async function testLocalModel(
  s: LocalModelSettings
): Promise<{ ok: boolean; error?: string }> {
  if (!s.endpoint) return { ok: false, error: 'no-endpoint' }
  const answer = await askLocalModel({ ...s, enabled: true }, 'Reply with the single word: ok')
  if (answer === null) return { ok: false, error: 'unreachable' }
  return { ok: true }
}
