import React, { useMemo, useState } from 'react'
import { File, Folder, Download, Trash2, RefreshCw, Pencil, Copy } from 'lucide-react'

interface FileItem {
  id: string
  name: string
  type: 'file' | 'folder'
  category: string
  size: string
  updatedAt: string
}

const INITIAL: FileItem[] = [
  { id: 'f1', name: 'Agent-5', type: 'folder', category: 'folder', size: '—', updatedAt: '07-21 14:02' },
  { id: 'f2', name: 'report.docx', type: 'file', category: '文档', size: '84 KB', updatedAt: '07-21 10:30' },
  { id: 'f3', name: 'architecture.png', type: 'file', category: '图片', size: '1.2 MB', updatedAt: '07-20 18:44' },
  { id: 'f4', name: 'data.xlsx', type: 'file', category: '表格', size: '220 KB', updatedAt: '07-19 09:12' },
  { id: 'f5', name: 'README.md', type: 'file', category: '文档', size: '3 KB', updatedAt: '07-18 20:01' },
  { id: 'f6', name: 'demo.zip', type: 'file', category: '压缩包', size: '9.4 MB', updatedAt: '07-17 08:55' },
  { id: 'f7', name: 'slides.pptx', type: 'file', category: '演示', size: '2.1 MB', updatedAt: '07-16 16:20' },
]

const CATEGORY_COLOR: Record<string, string> = {
  文档: '#FFD440',
  图片: '#FF6B91',
  表格: '#A9D877',
  压缩包: '#BBAFE6',
  演示: '#27CCF3',
  代码: '#4ADE80',
  folder: '#F5E2C8',
}

export const FileManager: React.FC = () => {
  const [items, setItems] = useState<FileItem[]>(INITIAL)
  const [filter, setFilter] = useState('全部')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  const categories = useMemo(() => ['全部', ...Array.from(new Set(items.map((i) => i.category)))], [items])
  const shown = useMemo(() => (filter === '全部' ? items : items.filter((i) => i.category === filter)), [items, filter])

  const removeItem = (id: string) => setItems((s) => s.filter((i) => i.id !== id))
  const doRename = (id: string) => {
    if (renameVal.trim()) setItems((s) => s.map((i) => (i.id === id ? { ...i, name: renameVal.trim() } : i)))
    setRenaming(null)
  }

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-brutal-black">
        <span className="font-bold text-xs flex-1">文件管理</span>
        <button onClick={() => setItems([...INITIAL])} className="p-1 border-2 border-brutal-black hover:bg-brutal-cream shadow-brutal-sm transition-all duration-150" title="刷新示例">
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="px-3 py-2 border-b-2 border-brutal-black bg-brutal-cream">
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`text-[10px] font-mono border-2 border-brutal-black px-2 py-0.5 transition-all duration-150 ${filter === c ? 'bg-brutal-yellow shadow-brutal-sm' : 'bg-white hover:bg-brutal-cream'}`}
            >
              {c} {c === '全部' ? items.length : items.filter((i) => i.category === c).length}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto divide-y divide-black/10">
        {shown.map((it) => (
          <div key={it.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-brutal-cream/50">
            <span className="w-6 h-6 flex items-center justify-center border-2 border-brutal-black rounded-[3px] shrink-0" style={{ backgroundColor: CATEGORY_COLOR[it.category] || '#ccc', boxShadow: '2px 2px 0 #141111' }}>
              {it.type === 'folder' ? <Folder size={13} /> : <File size={13} />}
            </span>
            <div className="min-w-0 flex-1">
              {renaming === it.id ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={() => doRename(it.id)}
                  onKeyDown={(e) => e.key === 'Enter' && doRename(it.id)}
                  className="input-brutal !py-0.5 !text-[11px] w-40"
                />
              ) : (
                <div className="text-xs font-bold truncate">{it.name}</div>
              )}
              <div className="text-[9px] text-black/50 font-mono">{it.category} · {it.size} · {it.updatedAt}</div>
            </div>
            <div className="hidden group-hover:flex gap-1 items-center">
              <button onClick={() => { setRenaming(it.id); setRenameVal(it.name) }} className="p-1 border border-brutal-black hover:bg-brutal-yellow" title="重命名"><Pencil size={11} /></button>
              <button onClick={() => { const m = it.name.match(/^(.+?)(\.[^.]+)?$/); const copy = m ? `${m[1]} (副本)${m[2] || ''}` : it.name; setItems((s) => [...s, { ...it, id: `${it.id}-copy-${Date.now()}`, name: copy, category: it.type === 'folder' ? 'folder' : it.category, updatedAt: new Date().toLocaleDateString('zh-CN') }]) } } className="p-1 border border-brutal-black hover:bg-brutal-yellow" title="复制"><Copy size={11} /></button>
              <button className="p-1 border border-brutal-black hover:bg-brutal-yellow" title="下载"><Download size={11} /></button>
              <button onClick={() => removeItem(it.id)} className="p-1 border border-brutal-black hover:bg-brutal-pink hover:text-white" title="删除"><Trash2 size={11} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}