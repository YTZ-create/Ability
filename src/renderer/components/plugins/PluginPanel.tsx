import React, { useState } from 'react'
import { Puzzle, ToggleLeft } from 'lucide-react'
import { usePluginStore, type PluginInfo } from '../../stores/pluginStore'

const CATEGORY_LABEL: Record<PluginInfo['category'], string> = {
  lark: '协作',
  seedream: '图像',
  seedance: '视频',
  browser: '浏览器',
  skill: 'Skill',
}

export const PluginPanel: React.FC = () => {
  const plugins = usePluginStore((s) => s.plugins)
  const toggle = usePluginStore((s) => s.toggle)
  const [filter, setFilter] = useState<'all' | PluginInfo['category']>('all')

  const shown = filter === 'all' ? plugins : plugins.filter((p) => p.category === filter)
  const enabledCount = plugins.filter((p) => p.enabled).length

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-3 py-2 border-b-2 border-brutal-black">
        <div className="font-bold text-xs mb-1.5 flex items-center gap-1">
          <Puzzle size={12} /> 插件管理 <span className="ml-auto text-[10px] text-black/50 font-mono">{enabledCount}/{plugins.length} 已启用</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {(['all', 'lark', 'seedream', 'seedance', 'browser', 'skill'] as const).map((c) => (
            <button key={c} onClick={() => setFilter(c)}
              className={`text-[10px] font-mono border-2 border-brutal-black px-2 py-0.5 transition-all duration-150 ${filter === c ? 'bg-brutal-yellow shadow-brutal-sm' : 'bg-white hover:bg-brutal-cream'}`}>
              {c === 'all' ? '全部' : CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto divide-y divide-black/10">
        {shown.map((p) => (
          <div key={p.id} className="group px-3 py-2.5 flex items-start gap-2 hover:bg-brutal-cream/50">
            <span className={`mt-0.5 w-6 h-6 flex items-center justify-center border-2 border-brutal-black rounded-[3px] flex-shrink-0 ${p.enabled ? 'bg-brutal-yellow' : 'bg-brutal-cream'}`} style={{ boxShadow: '2px 2px 0 #141111' }}>
              <Puzzle size={12} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold truncate">{p.name}</span>
                <span className="text-[9px] font-mono text-black/40">{p.version}</span>
                <span className={`px-1 text-[9px] font-bold ${p.enabled ? 'bg-brutal-lime text-black' : 'bg-brutal-pink/70 text-white'}`}>{p.enabled ? '已启用' : '未启用'}</span>
              </div>
              <div className="text-[10px] text-black/60 mt-0.5">{p.description}</div>
              <div className="text-[9px] font-mono text-black/40 mt-0.5">{CATEGORY_LABEL[p.category]}</div>
            </div>
            <button onClick={() => toggle(p.id)} className={`p-1 border-2 border-brutal-black shadow-brutal-sm transition-all duration-150 ${p.enabled ? 'bg-brutal-yellow' : 'bg-white hover:bg-brutal-cream'}`} title={p.enabled ? '停用' : '启用'} style={{ color: p.enabled ? 'inherit' : 'inherit' }}>
              <ToggleLeft size={14} className={p.enabled ? '' : 'opacity-40'} />
            </button>
          </div>
        ))}
      </div>

      {shown.length < plugins.length && (
        <div className="px-3 py-1.5 border-t border-black/10 text-[9px] font-mono text-black/50">已按类别筛选，显示 {shown.length}/{plugins.length}</div>
      )}
    </div>
  )
}