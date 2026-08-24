import { create } from 'zustand'
import { api } from '../api/neutralino'

export interface ProviderConfig {
  id: string
  name: string
  color: string
  hasKey: boolean
}

export const PROVIDERS: ProviderConfig[] = [
  { id: 'openai', name: 'OpenAI', color: '#10A37F', hasKey: false },
  { id: 'anthropic', name: 'Anthropic (Claude)', color: '#D97757', hasKey: false },
  { id: 'google', name: 'Google (Gemini)', color: '#4285F4', hasKey: false },
  { id: 'deepseek', name: 'DeepSeek', color: '#4D6BFE', hasKey: false },
  { id: 'zhipu', name: '智谱 (GLM)', color: '#3859FF', hasKey: false },
  { id: 'qwen', name: '通义千问', color: '#6B4EF7', hasKey: false },
  { id: 'moonshot', name: 'Moonshot', color: '#161823', hasKey: false },
  { id: 'xiaomi', name: '小米 MIMO', color: '#FF6700', hasKey: false },
]

export const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-5.4',
  anthropic: 'claude-sonnet-5',
  google: 'gemini-2.5-flash',
  deepseek: 'deepseek-v4-flash',
  zhipu: 'glm-4.7',
  qwen: 'qwen-plus',
  moonshot: 'kimi-k3',
  xiaomi: 'mimo-v2.5-pro',
}

/** 每个 provider 的可用模型列表（可扩展） */
export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5', 'gpt-5-mini'],
  anthropic: ['claude-sonnet-5', 'claude-opus-5', 'claude-fable-5', 'claude-haiku-4-5'],
  google: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash'],
  zhipu: ['glm-4.7', 'glm-4.5-air', 'glm-4-flash', 'glm-4-flash-250414'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-flash', 'qwen-turbo'],
  moonshot: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'],
  xiaomi: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'],
}

interface AgentModelConfig {
  agentId: string
  provider: string
  model: string
}

interface SettingsState {
  showSettings: boolean
  setShowSettings: (show: boolean) => void
  providers: ProviderConfig[]
  setProviderKey: (id: string, hasKey: boolean) => void
  refreshProviderKeys: () => Promise<void>
  /** Per-Agent 模型配置 */
  agentModels: AgentModelConfig[]
  setAgentModel: (agentId: string, provider: string, model: string) => void
  /** 把所有 Agent 重置为 auto，让 resolveProvider 自动检测有 Key 的 provider */
  resetAllAgentsToAuto: () => void
  getAgentModel: (agentId: string) => { provider: string; model: string } | null
  loadAgentModels: () => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  showSettings: false,
  setShowSettings: (show) => set({ showSettings: show }),
  providers: [...PROVIDERS],
  setProviderKey: (id, hasKey) =>
    set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, hasKey } : p)) })),
  refreshProviderKeys: async () => {
    const updated = await Promise.all(
      PROVIDERS.map(async (p) => {
        const key = await api.settings.getApiKey(p.id)
        return { ...p, hasKey: !!key }
      })
    )
    set({ providers: updated })
  },
  agentModels: [],
  setAgentModel: (agentId, provider, model) =>
    set((s) => {
      const filtered = s.agentModels.filter((m) => m.agentId !== agentId)
      const updated = [...filtered, { agentId, provider, model }]
      try { api.settings.setData('agent_models', JSON.stringify(updated)) } catch { /* skip */ }
      return { agentModels: updated }
    }),
  resetAllAgentsToAuto: () => {
    set((s) => {
      const updated = s.agentModels.map((m) => ({ ...m, provider: 'auto', model: '' }))
      try { api.settings.setData('agent_models', JSON.stringify(updated)) } catch { /* skip */ }
      return { agentModels: updated }
    })
  },
  getAgentModel: (agentId) => {
    const found = get().agentModels.find((m) => m.agentId === agentId)
    return found ? { provider: found.provider, model: found.model } : null
  },
  loadAgentModels: async () => {
    try {
      const raw = await api.settings.getData('agent_models')
      if (raw) set({ agentModels: JSON.parse(raw) })
    } catch { /* skip */ }
  },
}))
