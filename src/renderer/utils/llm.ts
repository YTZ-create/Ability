import { api } from '../api/neutralino'

interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface LLMOptions {
  provider: string
  model: string
  messages: LLMMessage[]
  signal?: AbortSignal
  /** 可选：自定义 API Key 获取方式。不传则使用默认的 Neutralino storage */
  apiKeyProvider?: () => Promise<string | null>
  /** 可选：Token 用量回调 */
  onTokenUsage?: (promptTokens: number, completionTokens: number) => void
}

const PROVIDER_CONFIGS: Record<string, { baseURL: string; defaultModel: string }> = {
  openai: { baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-5.4' },
  anthropic: { baseURL: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-5' },
  google: { baseURL: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.5-flash' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-v4-flash' },
  zhipu: { baseURL: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.7' },
  qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  moonshot: { baseURL: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k3' },
  xiaomi: { baseURL: 'https://api.xiaomimimo.com/v1', defaultModel: 'mimo-v2.5-pro' },
}

export async function resolveProvider(provider: string): Promise<string> {
  const tryDetect = async (): Promise<string> => {
    for (const p of Object.keys(PROVIDER_CONFIGS)) {
      if (p === 'anthropic' || p === 'google') continue
      const key = await api.settings.getApiKey(p)
      if (key && key.trim() !== '') {
        console.log(`[LLM] 自动选择 provider: ${p}`)
        return p
      }
    }
    for (const p of ['anthropic', 'google']) {
      const key = await api.settings.getApiKey(p)
      if (key && key.trim() !== '') {
        console.log(`[LLM] 自动选择 provider: ${p}`)
        return p
      }
    }
    return 'deepseek'
  }

  if (provider === 'auto') {
    return await tryDetect()
  }
  if (!PROVIDER_CONFIGS[provider]) {
    console.warn(`[LLM] 未知 provider "${provider}"，自动检测`)
    return await tryDetect()
  }

  const key = await api.settings.getApiKey(provider)
  if (key && key.trim() !== '') {
    return provider
  }
  console.warn(`[LLM] ${provider} 未配置 API Key，尝试自动检测其他已配置的 provider`)
  return await tryDetect()
}

async function resolveApiKey(opts: LLMOptions): Promise<string> {
  let key: string | null = null
  if (opts.apiKeyProvider) {
    key = await opts.apiKeyProvider()
  } else {
    key = await api.settings.getApiKey(opts.provider)
  }
  if (!key || key.trim() === '') {
    throw new Error(`API Key 未配置或为空 (${opts.provider})。请在设置中配置 API Key。`)
  }
  return key
}

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1500
const FETCH_TIMEOUT_MS = 60000

/** 构建 OpenAI 兼容请求体。不同厂商的采样参数和思考模式控制各不相同，这里按 provider 差异化处理。 */
function buildRequestBody(provider: string, model: string, messages: LLMMessage[], stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: 4096,
    temperature: 0.7,
    stream,
  }

  if (provider === 'xiaomi') {
    // mimo-v2.5-pro 默认 thinking=enabled，关闭后模型直接输出 content，避免界面长时间只显示"思考中"
    body.thinking = { type: 'disabled' }
  } else if (provider === 'zhipu') {
    // GLM 系列默认 thinking=enabled，和 MiMo 一样会先输出大量 reasoning_content，这里显式关闭
    body.thinking = { type: 'disabled' }
  } else if (provider === 'moonshot') {
    // Kimi 系列 temperature 为固定值（kimi-k3 / kimi-k2.7 / kimi-k2.6 均为 1.0），
    // 传 0.7 会直接返回 invalid_request_error，故不显式传 temperature
    delete body.temperature
    // kimi-k2.7-code 是始终思考模型，只接受 thinking: enabled + keep: all，不要传 disabled
    // kimi-k3 用 reasoning_effort 控制，不支持 thinking 参数，也跳过
    if (/^kimi-k2\.6/.test(model)) {
      // k2.6 默认 thinking=enabled，为避免长时间只显示思考内容，显式关闭
      body.thinking = { type: 'disabled' }
    }
  }

  return body
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  const existingSignal = options.signal
  const mergedSignals = existingSignal
    ? AbortSignal.any([controller.signal, existingSignal])
    : controller.signal
  try {
    return await fetch(url, { ...options, signal: mergedSignals })
  } finally {
    clearTimeout(timeoutId)
  }
}

/** 判断错误是否值得重试（网络/超时/服务端错误可重试，认证/参数错误不重试） */
function isRetryableError(err: any): boolean {
  if (!err) return true
  const msg = (err.message || String(err)).toLowerCase()
  // 认证/权限/参数错误 — 重试无意义
  if (msg.includes('401') || msg.includes('403') || msg.includes('400') || msg.includes('422')) return false
  if (msg.includes('api key') || msg.includes('apikey') || msg.includes('unauthorized')) return false
  if (msg.includes('forbidden') || msg.includes('invalid_api_key')) return false
  // 网络/超时/服务端错误 — 可以重试
  return true
}

async function withRetry<T>(fn: () => Promise<T>, label: string, signal?: AbortSignal): Promise<T> {
  let lastErr: any
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new Error('Request aborted')
    try {
      return await fn()
    } catch (err: any) {
      lastErr = err
      if (signal?.aborted) throw new Error('Request aborted')
      if (!isRetryableError(err)) {
        console.error(`[LLM] ${label} 不可恢复的错误，不重试:`, err?.message || err)
        throw err
      }
      if (attempt >= MAX_RETRIES) break
      console.warn(`[LLM] ${label} 第 ${attempt + 1} 次失败，${RETRY_DELAY_MS}ms 后重试:`, err?.message || err)
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }
  throw lastErr
}

export async function callLLM(opts: LLMOptions): Promise<string> {
  const resolvedProvider = await resolveProvider(opts.provider)
  const apiKey = await resolveApiKey({ ...opts, provider: resolvedProvider })
  if (!apiKey) throw new Error(`未配置 ${resolvedProvider} 的 API Key，请在设置中填写。`)

  const config = PROVIDER_CONFIGS[resolvedProvider]
  if (!config) throw new Error(`不支持的模型厂商: ${resolvedProvider}`)

  const model = opts.model || config.defaultModel

  return withRetry(() => {
    if (resolvedProvider === 'anthropic') return callAnthropic(apiKey, model, opts)
    if (resolvedProvider === 'google') return callGoogle(apiKey, model, opts)
    return callOpenAICompatible(config.baseURL, apiKey, model, { ...opts, provider: resolvedProvider })
  }, `callLLM(${resolvedProvider}/${model})`, opts.signal)
}

export async function callLLMStream(
  opts: LLMOptions,
  onToken: (token: string) => void,
): Promise<string> {
  const resolvedProvider = await resolveProvider(opts.provider)
  const apiKey = await resolveApiKey({ ...opts, provider: resolvedProvider })
  if (!apiKey) throw new Error(`未配置 ${resolvedProvider} 的 API Key，请在设置中填写。`)

  const config = PROVIDER_CONFIGS[resolvedProvider]
  if (!config) throw new Error(`不支持的模型厂商: ${resolvedProvider}`)

  const model = opts.model || config.defaultModel

  return withRetry(() => {
    if (resolvedProvider === 'anthropic') return callAnthropicStream(apiKey, model, opts, onToken)
    if (resolvedProvider === 'google') return callGoogleStream(apiKey, model, opts, onToken)
    return callOpenAICompatibleStream(config.baseURL, apiKey, model, { ...opts, provider: resolvedProvider }, onToken)
  }, `callLLMStream(${resolvedProvider}/${model})`, opts.signal)
}

async function callOpenAICompatible(baseURL: string, apiKey: string, model: string, opts: LLMOptions): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.provider === 'xiaomi') {
    headers['api-key'] = apiKey
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  const res = await fetchWithTimeout(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildRequestBody(opts.provider, model, opts.messages, false)),
    signal: opts.signal,
  })
  if (!res.ok) { const err = await res.text(); throw new Error(`API 调用失败 (${res.status}): ${err}`) }
  const data = await res.json()
  if (opts.onTokenUsage && data.usage) {
    opts.onTokenUsage(data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0)
  }
  return data.choices?.[0]?.message?.content || ''
}

async function callOpenAICompatibleStream(
  baseURL: string, apiKey: string, model: string, opts: LLMOptions,
  onToken: (token: string) => void,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.provider === 'xiaomi') {
    headers['api-key'] = apiKey
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  const res = await fetchWithTimeout(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildRequestBody(opts.provider, model, opts.messages, true)),
    signal: opts.signal,
  })
  if (!res.ok) { const err = await res.text(); throw new Error(`API 调用失败 (${res.status}): ${err}`) }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('不支持的响应流')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (data === '[DONE]') return fullText
        try {
          const json = JSON.parse(data)
          const token = json.choices?.[0]?.delta?.content || ''
          if (token) { fullText += token; onToken(token) }
          // OpenAI 兼容格式的 usage 在最后一条消息中
          if (opts.onTokenUsage && json.usage) {
            opts.onTokenUsage(json.usage.prompt_tokens || 0, json.usage.completion_tokens || 0)
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return fullText
}

async function callAnthropic(apiKey: string, model: string, opts: LLMOptions): Promise<string> {
  const systemMsg = opts.messages.find((m) => m.role === 'system')
  const chatMessages = opts.messages.filter((m) => m.role !== 'system')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      system: systemMsg?.content || '',
      messages: chatMessages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      max_tokens: 4096,
    }),
    signal: opts.signal,
  })
  if (!res.ok) { const err = await res.text(); throw new Error(`Anthropic API 调用失败 (${res.status}): ${err}`) }
  const data = await res.json()
  if (opts.onTokenUsage && data.usage) {
    opts.onTokenUsage(data.usage.input_tokens || 0, data.usage.output_tokens || 0)
  }
  return data.content?.[0]?.text || ''
}

async function callAnthropicStream(
  apiKey: string, model: string, opts: LLMOptions,
  onToken: (token: string) => void,
): Promise<string> {
  const systemMsg = opts.messages.find((m) => m.role === 'system')
  const chatMessages = opts.messages.filter((m) => m.role !== 'system')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      system: systemMsg?.content || '',
      messages: chatMessages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      max_tokens: 4096,
      stream: true,
    }),
    signal: opts.signal,
  })
  if (!res.ok) { const err = await res.text(); throw new Error(`Anthropic API 调用失败 (${res.status}): ${err}`) }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('不支持的响应流')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let anthropicInputTokens = 0
  let anthropicOutputTokens = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        try {
          const json = JSON.parse(data)
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
            const token = json.delta.text || ''
            if (token) { fullText += token; onToken(token) }
          }
          if (json.type === 'message_start' && json.message?.usage) {
            anthropicInputTokens = json.message.usage.input_tokens || 0
          }
          if (json.type === 'message_delta' && json.usage) {
            anthropicOutputTokens = json.usage.output_tokens || 0
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (opts.onTokenUsage) {
    opts.onTokenUsage(anthropicInputTokens, anthropicOutputTokens)
  }
  return fullText
}

async function callGoogle(apiKey: string, model: string, opts: LLMOptions): Promise<string> {
  const systemMsg = opts.messages.find((m) => m.role === 'system')
  const contents = opts.messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      system_instruction: systemMsg ? { parts: { text: systemMsg.content } } : undefined,
      contents,
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
    }),
    signal: opts.signal,
  })
  if (!res.ok) { const err = await res.text(); throw new Error(`Google API 调用失败 (${res.status}): ${err}`) }
  const data = await res.json()
  if (opts.onTokenUsage && data.usageMetadata) {
    opts.onTokenUsage(data.usageMetadata.promptTokenCount || 0, data.usageMetadata.candidatesTokenCount || 0)
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function callGoogleStream(
  apiKey: string, model: string, opts: LLMOptions,
  onToken: (token: string) => void,
): Promise<string> {
  const systemMsg = opts.messages.find((m) => m.role === 'system')
  const contents = opts.messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      system_instruction: systemMsg ? { parts: { text: systemMsg.content } } : undefined,
      contents,
      generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
    }),
    signal: opts.signal,
  })
  if (!res.ok) { const err = await res.text(); throw new Error(`Google API 调用失败 (${res.status}): ${err}`) }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('不支持的响应流')
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let googleInputTokens = 0
  let googleOutputTokens = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        try {
          const json = JSON.parse(data)
          const token = json.candidates?.[0]?.content?.parts?.[0]?.text || ''
          if (token) { fullText += token; onToken(token) }
          // Google 流式响应的 token 统计
          if (json.usageMetadata) {
            googleInputTokens = json.usageMetadata.promptTokenCount || 0
            googleOutputTokens = json.usageMetadata.candidatesTokenCount || 0
          }
        } catch { /* skip */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  
  // 报告 token 使用情况
  if (opts.onTokenUsage && (googleInputTokens > 0 || googleOutputTokens > 0)) {
    opts.onTokenUsage(googleInputTokens, googleOutputTokens)
  }
  
  return fullText
}
