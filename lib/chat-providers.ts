export const CHAT_PROVIDERS = [
  { id: 'anthropic', label: 'Claude',    model: 'anthropic/claude-haiku-4.5' },
  { id: 'openai',    label: 'GPT',       model: 'openai/gpt-5.4'             },
  { id: 'google',    label: 'Gemini',    model: 'google/gemini-2.5-flash'    },
  { id: 'xai',       label: 'Grok',      model: 'xai/grok-3-mini'            },
  { id: 'deepseek',  label: 'DeepSeek',  model: 'deepseek/deepseek-v3.2'    },
] as const

export type ProviderId = typeof CHAT_PROVIDERS[number]['id']
export const DEFAULT_PROVIDER: ProviderId = 'anthropic'
