import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, ScrollText, RefreshCw } from 'lucide-react'
import { getMemoryStore } from '../../memory'
import type { MemoryCategory, MemoryEntry, MemoryStats } from '../../memory/types'
import { useFolderStore } from '../../stores/folderStore'

/** 分类主题色映射（Brutalist 风格） */
const CATEGORY_COLOR: Record<MemoryCategory, string> = {
  'user-preference': '#FF6B91',
  'project-context': '#BBAFE6',
  'analysis-result': '#FFD440',
  'session-summary': '#A9D877',
  'general': '#F5E2C8',
}

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  'user-preference': '用户偏好',
  'project-context': '项目上下文',
  'analysis-result': '分析结果',
  'session-summary': '会话摘要',
  'general': '通用',
}

const CATEGORIES = Object.keys(CATEGORY_LABEL) as MemoryCategory[]

const BORDER_BTN =
  'p-1.5 border-2 border-brutal-black bg-white hover:bg-brutal-yellow shadow-brutal-sm hover:shadow-brutal hover:-translate-x-[1px] hover:-translate-y-[1px] active:shadow-none active:translate-x-0 active:translate-y-0 transition-all duration-150 ease-out flex-shrink-0'

export const MemoryViewer: React.FC = () => {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [stats, setStats] = useState<MemoryStats>({ total: 0, byCategory: {}, oldestEntry: null, newestEntry: null })
  const [text, setText] = useState('')
  const [category, setCategory] = useState<MemoryCategory>('project-context')
  const [filter, setFilter] = useState<'all' | MemoryCategory>('all')
  const [notice, setNotice] = useState('')
  const activeFolderId = useFolderStore((s) => s.activeFolderId)
  const activeFolder = useFolderStore((s) => s.folders.find((f) => f.id === activeFolderId))

  const refresh = useCallback(() => {
    const store = getMemoryStore()
    setEntries(store.getAll())
    setStats(store.getStats())
  }, [])

  useEffect(() => {
    try {
      refresh()
    } catch {
      setNotice('记忆服务尚未初始化')
    }
  }, [refresh])

  const handleAdd = () => {
    const content = text.trim()
    if (!content) return
    try {
      getMemoryStore().upsert({
        key: `ui:${activeFolder?.path || 'global'}:${content.slice(0, 40)}:${Date.now()}`,
        category,
        content,
        tags: [],
        projectPath: activeFolder?.path,
      })
      setText('')
      refresh()
      setNotice('已添加')
      setTimeout(() => setNotice(''), 1200)
    } catch {
      setNotice('添加失败')
    }
  }

  const handleDelete = (id: string) => {
    try {
      getMemoryStore().delete(id)
      refresh()
    } catch {
      setNotice('删除失败')
    }
  }

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.category === filter)
  const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 提示条 */}
      {notice && (
        <div className="px-3 py-1 text-[10px] font-mono bg-brutal-yellow border-b-2 border-brutal-black">
          {notice}
        </div>
      )}

      {/* 统计卡 */}
      <div className="p-3 border-b-2 border-brutal-black">
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-xs">记忆统计</span>
          <button onClick={refresh} className={BORDER_BTN} title="刷新">
            <RefreshCw size={12} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="border-2 border-brutal-black bg-brutal-cream p-2 shadow-brutal-sm">
            <div className="text-[10px] text-black/70 font-mono">总条数</div>
            <div className="text-xl font-bold">{stats.total}</div>
          </div>
          <div className="border-2 border-brutal-black bg-brutal-cream p-2 shadow-brutal-sm">
            <div className="text-[10px] text-black/70 font-mono">分类</div>
            <div className="text-xl font-bold">{Object.keys(stats.byCategory).length}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {CATEGORIES.map((c) => {
            const count = stats.byCategory[c] || 0
            return (
              <span key={c} className="inline-flex items-center gap-1 text-[10px] font-mono border border-brutal-black px-1.5 py-0.5"
                style={{ backgroundColor: filter === c ? CATEGORY_COLOR[c] : 'transparent' }}
                onClick={() => setFilter(filter === c ? 'all' : c)}
                title={`${CATEGORY_LABEL[c]}：${count} 条`}
              >
                <span className="w-1.5 h-1.5 inline-block" style={{ backgroundColor: CATEGORY_COLOR[c] }} />
                {CATEGORY_LABEL[c]} {count}
              </span>
            )
          })}
        </div>
      </div>

      {/* 添加记忆 */}
      <div className="px-3 py-2 border-b-2 border-brutal-black bg-brutal-cream">
        <div className="text-[10px] font-bold mb-1.5 flex items-center gap-1">
          <Plus size={10} /> 添加记忆
        </div>
        <div className="flex gap-1 mb-1.5">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as MemoryCategory)}
            className="select-brutal !px-2 !py-1 !text-[10px] flex-shrink-0"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="输入要长期记住的内容..."
            className="input-brutal !py-1 !text-[10px] flex-1 min-w-0"
          />
        </div>
        <button onClick={handleAdd} className="btn-brutal bg-brutal-yellow text-[10px] px-3 py-1 w-full">
          + 保存到记忆
        </button>
      </div>

      {/* 记忆列表 */}
      <div className="flex-1 overflow-y-auto divide-y divide-black/10">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-black/70 text-xs">
            <ScrollText size={22} className="mx-auto mb-1.5 opacity-70" />
            <p className="font-mono">暂无记忆记录</p>
          </div>
        ) : (
          filtered.map((e) => (
            <div key={e.id} className="group px-3 py-2 flex items-start gap-2 border-l-4" style={{ borderColor: CATEGORY_COLOR[e.category] }}>
              <div className="w-2 h-2 flex-shrink-0 mt-0.5 border border-brutal-black" style={{ backgroundColor: CATEGORY_COLOR[e.category] }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-black/70">{CATEGORY_LABEL[e.category]}</span>
                  <span className="text-[9px] font-mono text-black/50">{fmt(e.updatedAt)}</span>
                </div>
                <div className="text-xs mt-0.5 break-words whitespace-pre-wrap">{e.content}</div>
                {e.projectPath && (
                  <div className="text-[9px] font-mono text-black/50 mt-0.5 truncate">{e.projectPath}</div>
                )}
              </div>
              <button onClick={() => handleDelete(e.id)} className="hidden group-hover:flex p-1 border border-brutal-black hover:bg-brutal-pink hover:text-white flex-shrink-0 transition-colors duration-150" title="删除">
                <Trash2 size={11} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}