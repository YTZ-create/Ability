import React, { useState } from 'react'
import { Clock, Plus, Trash2, Play, Pause } from 'lucide-react'
import { useTaskStore, type ScheduledTask } from '../../stores/taskStore'

const STATUS_STYLE: Record<'enabled' | 'paused', string> = {
  enabled: 'bg-brutal-lime text-black',
  paused: 'bg-brutal-yellow text-black',
}

export const TaskPanel: React.FC = () => {
  const tasks = useTaskStore((s) => s.tasks)
  const addTask = useTaskStore((s) => s.addTask)
  const removeTask = useTaskStore((s) => s.removeTask)
  const toggleTask = useTaskStore((s) => s.toggleTask)
  const markRun = useTaskStore((s) => s.markRun)

  const [name, setName] = useState('')
  const [cron, setCron] = useState('0 9 * * *')
  const [desc, setDesc] = useState('')

  const add = () => {
    if (!name.trim()) return
    addTask({ name: name.trim(), cron: cron.trim() || '0 9 * * *', description: desc.trim() })
    setName(''); setCron('0 9 * * *'); setDesc('')
  }

  const fmt = (t: ScheduledTask) => {
    const parts = t.cron.split(' ')
    const [m, h, dom, mon, dow] = parts
    const dowName = ['日', '一', '二', '三', '四', '五', '六'][Number(dow)] || dow
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')} · 每周${dowName}`
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-3 py-2 border-b-2 border-brutal-black">
        <div className="font-bold text-xs mb-2 flex items-center gap-1"><Clock size={12} /> 定时任务</div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="任务名称" className="input-brutal !py-1 !text-[11px] mb-1.5" />
        <div className="flex gap-1 mb-1.5">
          <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="cron，如 0 9 * * *" className="input-brutal !py-1 !text-[10px] font-mono flex-1 min-w-0" />
        </div>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="描述（可选）" className="input-brutal !py-1 !text-[11px] mb-1.5" />
        <button onClick={add} className="btn-brutal bg-brutal-yellow text-[11px] px-3 py-1 w-full flex items-center justify-center gap-1">
          <Plus size={12} /> 添加任务
        </button>
      </div>

      <div className="flex-1 overflow-auto divide-y divide-black/10">
        {tasks.map((t) => (
          <div key={t.id} className="group px-3 py-2 flex items-start gap-2 hover:bg-brutal-cream/50">
            <span className={`mt-0.5 w-2 h-2 border border-brutal-black flex-shrink-0 ${t.enabled ? 'bg-brutal-lime' : 'bg-brutal-yellow'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold truncate">{t.name}</span>
                <span className={`px-1 text-[9px] font-bold ${STATUS_STYLE[t.enabled ? 'enabled' : 'paused']}`}>{t.enabled ? '运行' : '暂停'}</span>
              </div>
              <div className="text-[10px] font-mono text-black/50 mt-0.5">{fmt(t)}</div>
              {t.description && <div className="text-[10px] text-black/60 mt-0.5">{t.description}</div>}
              {t.lastRunAt && <div className="text-[9px] font-mono text-black/40 mt-0.5">最近执行：{new Date(t.lastRunAt).toLocaleTimeString('zh-CN')}</div>}
            </div>
            <div className="hidden group-hover:flex gap-1 items-center">
              <button onClick={() => toggleTask(t.id)} className="p-1 border border-brutal-black hover:bg-brutal-yellow" title={t.enabled ? '暂停' : '启用'}>
                {t.enabled ? <Pause size={11} /> : <Play size={11} />}
              </button>
              <button onClick={() => { toggleTask(t.id); markRun(t.id) }} className="p-1 border border-brutal-black hover:bg-brutal-lime" title="立即执行">
                <Play size={11} />
              </button>
              <button onClick={() => removeTask(t.id)} className="p-1 border border-brutal-black hover:bg-brutal-pink hover:text-white" title="删除"><Trash2 size={11} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}