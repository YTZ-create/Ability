import React, { useState } from 'react'
import { X, Coins, Trash2, BarChart3, Clock, Zap, Layers } from 'lucide-react'
import { useTokenUsageStore } from '../../stores/tokenUsageStore'

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: '#FFD440',
  openai: '#40C4FF',
  anthropic: '#FF4081',
  google: '#69F0AE',
  zhipu: '#B388FF',
  qwen: '#FF8A65',
  moonshot: '#80DEEA',
}

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  zhipu: '智谱',
  qwen: '通义千问',
  moonshot: '月之暗面',
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

type Tab = 'overview' | 'providers' | 'records'

export const TokenUsageDashboard: React.FC = () => {
  const { records, showDashboard, todayTotal, sessionTotal, totalRequests, toggleDashboard, clearRecords, getProviderStats } = useTokenUsageStore()
  const [tab, setTab] = useState<Tab>('overview')
  const providerStats = getProviderStats()

  if (!showDashboard) return null

  const maxProviderTokens = providerStats.length > 0 ? providerStats[0].totalTokens : 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={toggleDashboard}>
      <div
        className="w-[720px] max-h-[90vh] bg-white border-2 border-brutal-black flex flex-col"
        style={{ boxShadow: '6px 6px 0px #141111' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-brutal-yellow border-b-2 border-brutal-black flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <Coins size={18} className="text-brutal-black" />
            <span className="font-bold text-base text-brutal-black">Token 用量</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={clearRecords} className="p-1.5 hover:bg-white/50" title="清空记录">
              <Trash2 size={14} />
            </button>
            <button onClick={toggleDashboard} className="p-1.5 hover:bg-white/50">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b-2 border-brutal-black flex-shrink-0">
          {([
            { id: 'overview' as Tab, label: '概览', icon: BarChart3 },
            { id: 'providers' as Tab, label: '厂商', icon: Layers },
            { id: 'records' as Tab, label: '记录', icon: Clock },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors ${
                tab === t.id
                  ? 'bg-brutal-black text-brutal-yellow'
                  : 'bg-white text-brutal-black hover:bg-brutal-cream'
              }`}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'overview' && (
            <div className="p-5 space-y-5">
              {/* Stat Cards */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '今日用量', value: todayTotal, color: '#FFD440', icon: Zap },
                  { label: '会话用量', value: sessionTotal, color: '#40C4FF', icon: Coins },
                  { label: '请求次数', value: totalRequests, color: '#69F0AE', icon: Layers },
                ].map((card) => (
                  <div
                    key={card.label}
                    className="border-2 border-brutal-black p-3 relative"
                    style={{ boxShadow: '3px 3px 0px #141111', backgroundColor: card.color }}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <card.icon size={13} className="text-brutal-black" />
                      <span className="text-[10px] font-mono font-bold text-brutal-black">{card.label}</span>
                    </div>
                    <div className="text-2xl font-bold text-brutal-black">{fmt(card.value)}</div>
                  </div>
                ))}
              </div>

              {/* Provider Bar Chart */}
              {providerStats.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-brutal-black mb-2 flex items-center gap-1.5">
                    <BarChart3 size={13} />
                    厂商分布
                  </div>
                  <div className="space-y-2">
                    {providerStats.map((ps) => (
                      <div key={ps.provider}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <div
                              className="w-2.5 h-2.5 border border-brutal-black"
                              style={{ backgroundColor: PROVIDER_COLORS[ps.provider] || '#ccc' }}
                            />
                            <span className="text-xs font-bold">{PROVIDER_LABELS[ps.provider] || ps.provider}</span>
                          </div>
                          <span className="text-[10px] font-mono font-bold">{fmt(ps.totalTokens)} ({ps.requests} 次)</span>
                        </div>
                        <div className="h-4 border-2 border-brutal-black bg-white relative" style={{ boxShadow: '2px 2px 0px #141111' }}>
                          <div
                            className="h-full transition-all duration-300"
                            style={{
                              width: `${(ps.totalTokens / maxProviderTokens) * 100}%`,
                              backgroundColor: PROVIDER_COLORS[ps.provider] || '#ccc',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Input vs Output */}
              {sessionTotal > 0 && (
                <div>
                  <div className="text-xs font-bold text-brutal-black mb-2 flex items-center gap-1.5">
                    <Zap size={13} />
                    输入 / 输出 比例
                  </div>
                  <div className="h-6 border-2 border-brutal-black flex" style={{ boxShadow: '3px 3px 0px #141111' }}>
                    {(() => {
                      const totalPrompt = records.reduce((s, r) => s + r.promptTokens, 0)
                      const totalCompletion = records.reduce((s, r) => s + r.completionTokens, 0)
                      const total = totalPrompt + totalCompletion || 1
                      const promptPct = (totalPrompt / total) * 100
                      return (
                        <>
                          <div className="h-full flex items-center justify-center text-[10px] font-bold text-brutal-black" style={{ width: `${promptPct}%`, backgroundColor: '#FFD440' }}>
                            输入 {promptPct.toFixed(0)}%
                          </div>
                          <div className="h-full flex items-center justify-center text-[10px] font-bold text-white" style={{ width: `${100 - promptPct}%`, backgroundColor: '#FF4081' }}>
                            输出 {(100 - promptPct).toFixed(0)}%
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* Recent Activity */}
              {records.length > 0 && (
                <div>
                  <div className="text-xs font-bold text-brutal-black mb-2 flex items-center gap-1.5">
                    <Clock size={13} />
                    最近活动
                  </div>
                  <div className="space-y-1.5">
                    {[...records].reverse().slice(0, 5).map((r) => (
                      <div key={r.id} className="flex items-center gap-2 text-[11px] px-2 py-1.5 border border-brutal-black/30 bg-brutal-cream/30">
                        <div className="w-2 h-2 border border-brutal-black flex-shrink-0" style={{ backgroundColor: PROVIDER_COLORS[r.provider] || '#ccc' }} />
                        <span className="font-bold flex-shrink-0">{PROVIDER_LABELS[r.provider] || r.provider}</span>
                        <span className="text-black/60 font-mono flex-shrink-0">{r.model}</span>
                        {r.agentName && <span className="text-black/60 flex-shrink-0">· {r.agentName}</span>}
                        <span className="ml-auto font-mono font-bold flex-shrink-0">{fmt(r.totalTokens)}</span>
                        <span className="text-black/50 font-mono flex-shrink-0">{fmtTime(r.timestamp)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'providers' && (
            <div className="p-5">
              {providerStats.length === 0 ? (
                <div className="text-center text-sm text-black/60 py-10">暂无数据</div>
              ) : (
                <div className="space-y-3">
                  {providerStats.map((ps) => (
                    <div key={ps.provider} className="border-2 border-brutal-black" style={{ boxShadow: '3px 3px 0px #141111' }}>
                      <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-brutal-black" style={{ backgroundColor: PROVIDER_COLORS[ps.provider] || '#ccc' }}>
                        <span className="font-bold text-sm">{PROVIDER_LABELS[ps.provider] || ps.provider}</span>
                        <span className="text-[10px] font-mono font-bold ml-auto">{ps.requests} 次请求</span>
                      </div>
                      <div className="grid grid-cols-3 divide-x-2 divide-brutal-black">
                        <div className="p-2.5 text-center">
                          <div className="text-[10px] font-mono text-black/60">输入 Token</div>
                          <div className="text-sm font-bold">{fmt(ps.promptTokens)}</div>
                        </div>
                        <div className="p-2.5 text-center">
                          <div className="text-[10px] font-mono text-black/60">输出 Token</div>
                          <div className="text-sm font-bold">{fmt(ps.completionTokens)}</div>
                        </div>
                        <div className="p-2.5 text-center">
                          <div className="text-[10px] font-mono text-black/60">合计</div>
                          <div className="text-sm font-bold">{fmt(ps.totalTokens)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'records' && (
            <div className="p-5">
              {records.length === 0 ? (
                <div className="text-center text-sm text-black/60 py-10">暂无记录</div>
              ) : (
                <div className="border-2 border-brutal-black" style={{ boxShadow: '3px 3px 0px #141111' }}>
                  {/* Table Header */}
                  <div className="grid grid-cols-[1fr_1fr_80px_80px_80px_100px] bg-brutal-yellow border-b-2 border-brutal-black text-[10px] font-bold">
                    <div className="px-3 py-2">厂商 / 模型</div>
                    <div className="px-3 py-2">Agent</div>
                    <div className="px-2 py-2 text-center">输入</div>
                    <div className="px-2 py-2 text-center">输出</div>
                    <div className="px-2 py-2 text-center">合计</div>
                    <div className="px-3 py-2 text-right">时间</div>
                  </div>
                  {/* Table Rows */}
                  <div className="max-h-[400px] overflow-y-auto">
                    {[...records].reverse().map((r, i) => (
                      <div
                        key={r.id}
                        className={`grid grid-cols-[1fr_1fr_80px_80px_80px_100px] text-[11px] border-b border-brutal-black/20 ${
                          i % 2 === 0 ? 'bg-white' : 'bg-brutal-cream/30'
                        } hover:bg-brutal-yellow/30`}
                      >
                        <div className="px-3 py-2 flex items-center gap-1.5">
                          <div className="w-2 h-2 border border-brutal-black flex-shrink-0" style={{ backgroundColor: PROVIDER_COLORS[r.provider] || '#ccc' }} />
                          <span className="font-bold">{PROVIDER_LABELS[r.provider] || r.provider}</span>
                          <span className="text-black/50 font-mono text-[10px]">{r.model}</span>
                        </div>
                        <div className="px-3 py-2 text-black/70">{r.agentName || '-'}</div>
                        <div className="px-2 py-2 text-center font-mono">{fmt(r.promptTokens)}</div>
                        <div className="px-2 py-2 text-center font-mono">{fmt(r.completionTokens)}</div>
                        <div className="px-2 py-2 text-center font-mono font-bold">{fmt(r.totalTokens)}</div>
                        <div className="px-3 py-2 text-right font-mono text-black/60">{fmtTime(r.timestamp)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
