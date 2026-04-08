'use client'

import { useRef, useEffect, useState, type FormEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { MessageCircle, X, ArrowUp } from 'lucide-react'
import { useLocale } from 'next-intl'
import { CHAT_PROVIDERS, DEFAULT_PROVIDER, type ProviderId } from '@/lib/chat-providers'

const UI_TEXT = {
  vi: { title: 'Trợ lý danh mục', placeholder: 'Hỏi về danh mục của bạn...', error: 'Đã xảy ra lỗi. Thử lại nhé.' },
  en: { title: 'Portfolio Assistant', placeholder: 'Ask about your portfolio...', error: 'Something went wrong. Please try again.' },
} as const

// ChatInner is keyed by model so useChat resets when provider switches
function ChatInner({ model, locale }: { model: string; locale: string }) {
  const ui = UI_TEXT[locale as keyof typeof UI_TEXT] ?? UI_TEXT.en
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState('')

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: '/api/v1/chat', body: { model } }),
  })

  const isLoading = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const text = inputValue.trim()
    if (!text || isLoading) return
    setInputValue('')
    sendMessage({ text })
  }

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-6">{ui.placeholder}</p>
        )}
        {messages.map((msg) => {
          const text = msg.parts.filter((p) => p.type === 'text').map((p) => (p as { type: 'text'; text: string }).text).join('')
          if (!text && msg.role !== 'user') return null
          const isUser = msg.role === 'user'
          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words leading-relaxed ${
                  isUser
                    ? 'bg-violet-600 text-white rounded-br-sm'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-sm'
                }`}
              >
                {text}
              </div>
            </div>
          )
        })}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-3 py-2">
              <span className="flex gap-1 items-center h-4">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 bg-gray-400 dark:bg-gray-500 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
        {error && (
          <p className="text-xs text-red-500 text-center">{ui.error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-100 dark:border-gray-700 flex gap-2 items-center">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={ui.placeholder}
          disabled={isLoading}
          className="flex-1 text-sm px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none focus:border-violet-400 dark:focus:border-violet-500 disabled:opacity-50 transition-colors"
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || isLoading}
          className="w-8 h-8 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shrink-0"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </form>
    </>
  )
}

export default function ChatWidget() {
  const locale = useLocale()
  const ui = UI_TEXT[locale as keyof typeof UI_TEXT] ?? UI_TEXT.en
  const [isOpen, setIsOpen] = useState(false)
  const [providerId, setProviderId] = useState<ProviderId>(DEFAULT_PROVIDER)

  const selectedModel = CHAT_PROVIDERS.find((p) => p.id === providerId)!.model

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {/* Chat panel */}
      {isOpen && (
        <div className="w-[min(380px,calc(100vw-2.5rem))] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
          style={{ height: 'min(520px, calc(100dvh - 100px))' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 bg-gradient-to-r from-violet-600 to-indigo-600">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-white" />
              <span className="text-sm font-semibold text-white">{ui.title}</span>
            </div>
            <button onClick={() => setIsOpen(false)} className="text-white/70 hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Provider selector */}
          <div className="flex gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex-wrap">
            {CHAT_PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => setProviderId(p.id)}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                  providerId === p.id
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Chat content — keyed by model to reset conversation on switch */}
          <ChatInner key={selectedModel} model={selectedModel} locale={locale} />
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className="w-12 h-12 rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-lg hover:shadow-xl transition-all flex items-center justify-center"
        aria-label={ui.title}
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </div>
  )
}
