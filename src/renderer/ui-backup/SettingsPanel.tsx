import React, { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Key, Check, Cpu } from 'lucide-react'
import { useSettingsStore, PROVIDERS, DEFAULT_MODELS } from '../../stores/settingsStore'
import { agentRegistry } from '../../agents/registry'
import { Button } from '../ui/Button'
import { getPlatform } from '../../api/neutralino'

export const SettingsPanel: React.FC = () => {
  const { showSettings, setShowSettings, providers, setProviderKey, refreshProviderKeys, agentModels, setAgentModel, loadAgentModels } = useSettingsStore()
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<'api' | 'models'>('api')

  useEffect(() => {
    if (showSettings) {
      refreshProviderKeys()
      loadAgentModels()
      const platform = getPlatform()
      if (platform) {
        PROVIDERS.forEach(async (p) => {
          const key = await platform.storage.getApiKey(p.id)
          if (key) setKeys((prev) => ({ ...prev, [p.id]: key }))
        })
      }
    }
  }, [showSettings])

  if (!showSettings) return null

  const handleSave = async (providerId: string) => {
    const platform = getPlatform()
    if (platform) {
      await platform.storage.setApiKey(providerId, keys[providerId] || '')
      setProviderKey(providerId, !!keys[providerId])
      setSaved((prev) => ({ ...prev, [providerId]: true }))
      setTimeout(() => setSaved((prev) => ({ ...prev, [providerId]: false })), 2000)
    }
  }

  const allAgents = agentRegistry.getAll().filter((a) => a.id !== 'leader')
  const currentModel = (agentId: string) => agentModels.find((m) => m.agentId === agentId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="card-brutal w-[560px] max-h-[80vh] overflow-y-auto bg-brutal-cream">
        {/* 标题栏 */}
        <div className="flex items-center justify-between p-5 border-b-2 border-brutal-black">
          <div className="flex items-center gap-2"><Key size={18} /><h2 className="font-bold text-lg">设置</h2></div>
          <button onClick={() => setShowSettings(false)} className="p-1 hover:bg-brutal-pink hover:text-white"><X size={18} /></button>
        </div>

        {/* Tab 切换 */}
        <div className="flex border-b-2 border-brutal-black">
          <button
            onClick={() => setActiveTab('api')}
            className={`flex-1 py-2.5 font-bold text-sm border-r-2 border-brutal-black transition-colors ${activeTab === 'api' ? 'bg-brutal-black text-brutal-yellow' : 'bg-brutal-cream hover:bg-brutal-yellow'}`}
          >
            <span className="flex items-center justify-center gap-1.5"><Key size={14} /> API Key</span>
          </button>
          <button
            onClick={() => setActiveTab('models')}
            className={`flex-1 py-2.5 font-bold text-sm transition-colors ${activeTab === 'models' ? 'bg-brutal-black text-brutal-yellow' : 'bg-brutal-cream hover:bg-brutal-yellow'}`}
          >
            <span className="flex items-center justify-center gap-1.5"><Cpu size={14} /> Agent 模型</span>
          </button>
        </div>

        {/* API Key Tab */}
        {activeTab === 'api' && (
          <>
            <div className="px-5 py-3 text-sm text-black/80 border-b-2 border-brutal-black bg-brutal-cream">
              输入各厂商 API Key，即可使用对应模型。Key 加密存储在本地。
            </div>
            <div className="p-5 space-y-4">
              {providers.map((p) => (
                <div key={p.id} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm border-2 border-brutal-black" style={{ backgroundColor: p.color }} />
                    <span className="font-bold text-sm">{p.name}</span>
                    {p.hasKey && <span className="text-[10px] text-brutal-lime font-mono flex items-center gap-1"><Check size={10} />已配置</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input type={showKeys[p.id] ? 'text' : 'password'} value={keys[p.id] || ''}
                        onChange={(e) => setKeys((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder={`输入 ${p.name} API Key...`} className="input-brutal w-full pr-10 text-sm"
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(p.id) }} />
                      <button onClick={() => setShowKeys((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-black/70 hover:text-black">
                        {showKeys[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => handleSave(p.id)}>{saved[p.id] ? '已保存' : '保存'}</Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t-2 border-brutal-black flex justify-between items-center">
              <span className="text-[10px] text-black/70 font-mono">Key 仅保存在本地</span>
              <Button variant="secondary" size="sm" onClick={() => setShowSettings(false)}>完成</Button>
            </div>
          </>
        )}

        {/* Agent 模型 Tab */}
        {activeTab === 'models' && (
          <>
            <div className="px-5 py-3 text-sm text-black/80 border-b-2 border-brutal-black bg-brutal-cream">
              为每个 Agent 选择使用的厂商和模型。留空则使用默认配置。
            </div>
            <div className="p-5 space-y-3">
              {allAgents.map((agent) => {
                const cfg = currentModel(agent.id)
                const provider = cfg?.provider || agent.provider
                const model = cfg?.model || agent.model || DEFAULT_MODELS[agent.provider] || ''
                return (
                  <div key={agent.id} className="border-2 border-brutal-black shadow-brutal-sm bg-white">
                    <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-brutal-black" style={{ backgroundColor: agent.color }}>
                      <span className="font-bold text-sm text-white">{agent.name}</span>
                      <span className="text-[10px] text-white/80 font-mono">{agent.id}</span>
                    </div>
                    <div className="p-3 flex items-center gap-2">
                      <select
                        value={provider}
                        onChange={(e) => setAgentModel(agent.id, e.target.value, model)}
                        className="input-brutal flex-1 text-xs"
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <input
                        value={model}
                        onChange={(e) => setAgentModel(agent.id, provider, e.target.value)}
                        placeholder="模型名称（留空用默认）"
                        className="input-brutal flex-1 text-xs"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="px-5 py-3 border-t-2 border-brutal-black flex justify-between items-center">
              <span className="text-[10px] text-black/70 font-mono">配置自动保存</span>
              <Button variant="secondary" size="sm" onClick={() => setShowSettings(false)}>完成</Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
