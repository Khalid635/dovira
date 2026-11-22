import { useEffect, useRef, useState } from 'react'
import { useStore, useT } from '../store'
import type { AssistantAnswer, AssistantLine } from '../../../main/smart/assistant'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  source?: 'rules' | 'model'
}

const SUGGESTION_KEYS = [
  'assistant.suggestion1',
  'assistant.suggestion2',
  'assistant.suggestion3',
  'assistant.suggestion4'
]

/** findOne lines carry a raw status code — render it translated. */
const STATUS_KEY: Record<string, string> = {
  queued: 'status.queued',
  fetching_info: 'status.fetchingInfo',
  downloading: 'status.downloading',
  paused: 'status.paused',
  processing: 'status.processing',
  completed: 'status.completed',
  failed: 'status.failed',
  cancelled: 'status.cancelled'
}

type TFn = (key: string, params?: Record<string, string | number>) => string

function renderLine(t: TFn, line: AssistantLine): string {
  const params = { ...(line.params ?? {}) }
  if (line.key === 'assistant.findOne' && typeof params.status === 'string') {
    params.status = t(STATUS_KEY[params.status] ?? 'status.unknownSize')
  }
  return t(line.key, params)
}

export default function AssistantPage(): React.JSX.Element {
  const t = useT()
  const settings = useStore((s) => s.settings)
  const setView = useStore((s) => s.setView)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, sending])

  const send = async (raw: string): Promise<void> => {
    const q = raw.trim()
    if (!q || sending) return
    setMessages((m) => [...m.slice(-49), { role: 'user', text: q }])
    setInput('')
    setSending(true)
    try {
      if (typeof window.dovira === 'undefined') {
        setMessages((m) => [...m.slice(-49), { role: 'assistant', text: t('assistant.error') }])
        return
      }
      const res: AssistantAnswer = await window.dovira.askAssistant(q)
      const text =
        res.source === 'model' && res.modelText
          ? res.modelText
          : res.lines.map((l) => renderLine(t, l)).join('\n')
      setMessages((m) => [...m.slice(-49), { role: 'assistant', text, source: res.source }])
    } catch {
      setMessages((m) => [...m.slice(-49), { role: 'assistant', text: t('assistant.error') }])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const assistantOff = settings?.assistantEnabled === false

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="text-[16px] font-semibold">{t('assistant.title')}</div>
        <div className="text-[12px] text-[var(--muted)]">{t('assistant.emptyHint')}</div>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3">
          {messages.length === 0 && !assistantOff && (
            <div className="card mx-auto w-full max-w-[420px] p-8 text-center">
              <div className="text-[16px] font-medium">{t('assistant.emptyTitle')}</div>
              <div className="mx-auto mt-1 max-w-[320px] text-[13px] text-[var(--muted)]">
                {t('assistant.emptyHint')}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {SUGGESTION_KEYS.map((key) => (
                  <button key={key} className="btn btn-sm" onClick={() => void send(t(key))}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {assistantOff && (
            <div className="card mx-auto w-full max-w-[420px] p-8 text-center">
              <div className="text-[14px] leading-relaxed">{t('assistant.disabled')}</div>
              <button className="btn btn-primary mt-5" onClick={() => setView('settings')}>
                {t('sidebar.settings')}
              </button>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[var(--accent)] text-white'
                    : 'border border-[var(--border)] bg-[var(--surface)]'
                }`}
              >
                {m.text.split('\n').map((line, j) => (
                  <div key={j}>{line}</div>
                ))}
                {m.role === 'assistant' && m.source === 'model' && (
                  <div className="mt-1 text-[11px] opacity-70">{t('assistant.modelBadge')}</div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px] text-[var(--muted)]">
                {t('assistant.thinking')}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="mx-auto flex w-full max-w-[680px] gap-2">
          <input
            ref={inputRef}
            className="input flex-1"
            value={input}
            placeholder={t('assistant.placeholder')}
            disabled={assistantOff || sending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send(input)
            }}
          />
          <button
            className="btn btn-accent"
            disabled={assistantOff || sending || !input.trim()}
            onClick={() => void send(input)}
          >
            {t('assistant.send')}
          </button>
        </div>
      </div>
    </div>
  )
}
