import React from 'react'
import { Star } from 'lucide-react'

export interface MemoCriterion {
  name: string
  score: number // 1-5
  weight: number // 0-1
  note: string
}

export interface MemoRow {
  option: string
  provider: string
  price: string
  scores: Record<string, number>
  verdict: '推荐' | '备选' | '不推荐'
}

const DEFAULT_CRITERIA: MemoCriterion[] = [
  { name: '功能完整度', score: 4, weight: 0.3, note: '覆盖主要场景，缺批量操作' },
  { name: '生态/维护', score: 5, weight: 0.25, note: '社区活跃、文档完善' },
  { name: '性能', score: 3, weight: 0.2, note: '大数据量下略有卡顿' },
  { name: '成本', score: 4, weight: 0.25, note: '企业授权费用可接受' },
]

const DEFAULT_ROWS: MemoRow[] = [
  { option: '方案 A · 自建', provider: 'In-house', price: '低', scores: { '功能完整度': 3, '生态/维护': 2, '性能': 4, '成本': 5 }, verdict: '备选' },
  { option: '方案 B · 开源套件', provider: 'OpenSource', price: '中', scores: { '功能完整度': 4, '生态/维护': 5, '性能': 3, '成本': 5 }, verdict: '推荐' },
  { option: '方案 C · 商业 SaaS', provider: 'Vendor', price: '高', scores: { '功能完整度': 5, '生态/维护': 4, '性能': 5, '成本': 1 }, verdict: '不推荐' },
]

/** Star rating 卡片 */
function StarRating({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={11} className={i <= value ? 'fill-brutal-yellow text-brutal-black' : 'text-black/25'} />
      ))}
    </span>
  )
}

const VERDICT_STYLE: Record<MemoRow['verdict'], string> = {
  推荐: 'bg-brutal-lime text-black',
  备选: 'bg-brutal-yellow text-black',
  不推荐: 'bg-brutal-pink text-white',
}

interface EvaluationMemoProps {
  criteria?: MemoCriterion[]
  rows?: MemoRow[]
  title?: string
}

export const EvaluationMemo: React.FC<EvaluationMemoProps> = ({ criteria = DEFAULT_CRITERIA, rows = DEFAULT_ROWS, title = '评估备忘录' }) => {
  const weightedTotal = (row: MemoRow) =>
    criteria.reduce((sum, c) => sum + c.weight * (row.scores[c.name] ?? 0), 0)

  return (
    <div className="flex flex-col h-full bg-white overflow-auto">
      <div className="px-3 py-2 border-b-2 border-brutal-black">
        <div className="font-bold text-xs">{title}</div>
        <div className="text-[10px] text-black/70 font-mono">基于 {criteria.length} 项加权标准评估</div>
      </div>

      {/* 评估标准 */}
      <div className="px-3 py-2 border-b-2 border-brutal-black bg-brutal-cream">
        <div className="text-[10px] font-bold mb-1.5">评估标准</div>
        <div className="space-y-1">
          {criteria.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <StarRating value={c.score} />
              <span className="font-bold flex-1">{c.name}</span>
              <span className="text-black/50 font-mono">{Math.round(c.weight * 100)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* 方案对比表 */}
      <div className="px-3 py-2 flex-1">
        <div className="border-2 border-brutal-black overflow-hidden">
          <div className="grid grid-cols-[auto_1fr] bg-brutal-black text-white text-[10px] font-bold">
            <div className="px-2 py-1 border-r border-white/15">方案</div>
            <div className="px-2 py-1">加权评分（满分 {criteria.length * 5 * 1}）</div>
          </div>
          {rows.map((r, i) => (
            <div key={i} className={`grid grid-cols-[auto_1fr] items-center ${i % 2 ? 'bg-brutal-cream/40' : 'bg-white'}`}>
              <div className="px-2 py-2 border-r border-black/10">
                <div className="text-[11px] font-bold">{r.option}</div>
                <div className="text-[9px] text-black/50 font-mono">{r.provider} · {r.price}</div>
              </div>
              <div className="px-2 py-2 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  {criteria.map((c, ci) => (
                    <span key={ci} className="w-9 h-9 border-2 border-brutal-black flex flex-col items-center justify-center bg-white">
                      <span className="text-[10px] font-bold leading-none">{r.scores[c.name] ?? 0}</span>
                      <span className="text-[7px] text-black/40 leading-none">{c.name.slice(0, 2)}</span>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs">{weightedTotal(r).toFixed(1)}</span>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold ${VERDICT_STYLE[r.verdict]}`}>{r.verdict}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}