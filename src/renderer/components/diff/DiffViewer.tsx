import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Copy } from 'lucide-react'

export interface DiffLine {
  type: 'context' | 'add' | 'remove'
  oldLine: number | null
  newLine: number | null
  text: string
}

export interface ReviewNote {
  line: number
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  message: string
}

/** 简单行级 diff 解析：输入含 +/-/ 前缀行的文本 */
function parseDiff(source: string): DiffLine[] {
  return source.split('\n').reduce<DiffLine[]>((acc, line, i) => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      acc.push({ type: 'add', oldLine: null, newLine: acc.filter((l) => l.type !== 'remove').length + 1, text: line.slice(1) })
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      acc.push({ type: 'remove', oldLine: i + 1, newLine: null, text: line.slice(1) })
    } else {
      acc.push({ type: 'context', oldLine: i + 1, newLine: acc.filter((l) => l.type !== 'remove').length + 1, text: line })
    }
    return acc
  }, [])
}

const SEV_STYLE: Record<ReviewNote['severity'], string> = {
  HIGH: 'bg-brutal-pink text-white',
  MEDIUM: 'bg-brutal-yellow text-black',
  LOW: 'bg-brutal-lavender text-black',
}

const BLOCK_STYLE: Record<DiffLine['type'], string> = {
  add: 'bg-brutal-lime/40 border-l-2 border-brutal-lime',
  remove: 'bg-brutal-pink/30 border-l-2 border-brutal-pink line-through opacity-80',
  context: 'bg-transparent',
}

const DEMO_DIFF = `diff --git a/src/agents/avery.ts b/src/agents/avery.ts
@@ -42,6 +42,8 @@ export class QA_Agent extends BaseAgent {
   // 自动运行测试
-  if (!this.platform.shellExec) return
+  if (!this.platform.shellExec) return
+  this.registerDisposer(() => this.platform.shellExec?.dispose?.())
   const result = await this.runTests(folder)
+
+  // TODO: 接入 open-code-review 进行行级审查
   return result
`

const DEMO_NOTES: ReviewNote[] = [
  { line: 3, severity: 'HIGH', message: '调用 disposable 资源后需确保释放，避免内存泄漏。' },
  { line: 8, severity: 'MEDIUM', message: '新增 TODO 建议补充后续接入点说明。' },
]

interface DiffViewerProps {
  oldCode?: string
  newCode?: string
  notes?: ReviewNote[]
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ oldCode, newCode, notes }) => {
  const [source, setSource] = useState(DEMO_DIFF)
  const lines = useMemo(() => parseDiff(source), [source])

  const finalNotes = useMemo(() => (notes && notes.length ? notes : DEMO_NOTES), [notes])
  const humanRunDiff = useMemo(() => {
    if (oldCode && newCode) {
      const base = oldCode.split('\n').filter((l) => !l.trim() || !newCode.includes(l.trim()))
      const add = newCode.split('\n').filter((l) => !oldCode.includes(l.trim()))
      const ctx = newCode.split('\n')
      return ctx.map((l) => (base.includes(l) ? '- ' + l : add.includes(l) ? '+ ' + l : '  ' + l)).join('\n')
    }
    return source
  }, [oldCode, newCode, source])

  const active = oldCode && newCode ? humanRunDiff : source
  const usedLines = useMemo(() => parseDiff(active), [active])
  const stats = useMemo(
    () => ({ add: usedLines.filter((l) => l.type === 'add').length, remove: usedLines.filter((l) => l.type === 'remove').length }),
    [usedLines]
  )

  const copyDiff = () => navigator.clipboard?.writeText(active).catch(() => undefined)

  return (
    <div className="flex flex-col h-full bg-white font-mono text-xs">
      <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-brutal-black">
        <span className="font-bold text-xs flex-1">代码 Diff 预览</span>
        <span className="text-brutal-lime font-bold">+{stats.add}</span>
        <span className="text-brutal-pink font-bold">-{stats.remove}</span>
        <button onClick={copyDiff} className="p-1 border-2 border-brutal-black hover:bg-brutal-yellow shadow-brutal-sm transition-all duration-150" title="复制 diff">
          <Copy size={12} />
        </button>
      </div>

      <div className="px-3 py-2 border-b-2 border-brutal-black bg-brutal-cream">
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full h-24 input-brutal !text-[10px] !py-1.5 resize-none font-mono"
          placeholder="粘贴 diff 文本（+ 新增 / - 删除 / 其他上下文）"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {usedLines.map((l, i) => {
          const note = finalNotes.find((n) => n.line === l.newLine)
          return (
            <div key={i} className={`flex ${BLOCK_STYLE[l.type]}`}>
              <span className="w-8 px-1.5 text-right text-black/40 flex-shrink-0 select-none border-r border-black/10">{l.oldLine ?? ''}</span>
              <span className="w-8 px-1.5 text-right text-black/40 flex-shrink-0 select-none border-r border-black/10">{l.newLine ?? ''}</span>
              <span className="px-2 py-0 flex-1 whitespace-pre">{l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ''}{l.text}</span>
              {note && (
                <span className={`px-1.5 py-0 text-[9px] font-sans flex-shrink-0 ${SEV_STYLE[note.severity]}`}>
                  <ChevronUp size={8} className="inline" /> {note.message}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-3 py-2 border-t-2 border-brutal-black">
        <div className="text-[10px] font-bold mb-1 flex items-center gap-1"><ChevronDown size={10} /> 行级审查意见</div>
        {finalNotes.length === 0 ? (
          <div className="text-[10px] text-black/50">暂无审查意见。</div>
        ) : (
          finalNotes.map((n, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5">
              <span className={`px-1 text-[9px] font-bold flex-shrink-0 ${SEV_STYLE[n.severity]}`}>{n.severity}</span>
              <span className="text-[10px]">L{n.line}: {n.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}