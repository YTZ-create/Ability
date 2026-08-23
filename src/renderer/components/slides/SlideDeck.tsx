import React, { useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'

export interface Slide {
  title: string
  subtitle?: string
  bullets: string[]
  accent?: string
}

const DEFAULT_SLIDES: Slide[] = [
  { title: '能力扩展方案', subtitle: '11 人 Agent 团队 · 记忆系统 · 多能力面板', bullets: ['团队从 7 人扩展至 11 人', 'Oliver 统一调度记忆与路由', '新增 Atlas / Audrey / Avery 等成员'], accent: '#FFD440' },
  { title: '核心架构', bullets: ['registry.ts 统一注册 Agent', 'Zustand store 管理状态', 'Neutralino 平台 API 桥接'], accent: '#FF6B91' },
  { title: '记忆系统', bullets: ['MemoryStore 支持 upsert/query/stats', 'Oliver 记忆调度（记住/回忆/遗忘/统计）', 'Brutalist 记忆面板可视化'], accent: '#A9D877' },
  { title: '下一步', bullets: ['Phase C 能力 UI 组件落地', 'Phase D 服务层与 Skill 集成', '全程保持 Brutalist 设计一致'], accent: '#27CCF3' },
]

interface SlideDeckProps {
  slides?: Slide[]
}

export const SlideDeck: React.FC<SlideDeckProps> = ({ slides = DEFAULT_SLIDES }) => {
  const [index, setIndex] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const total = slides.length
  const slide = slides[index]

  const go = (d: number) => setIndex((i) => Math.min(total - 1, Math.max(0, i + d)))

  return (
    <div className={`flex flex-col bg-white transition-all duration-200 ${fullscreen ? 'fixed inset-0 z-50 p-4 border-brutal-black flex-col' : 'h-full'}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-brutal-black shrink-0">
        <span className="font-bold text-xs flex-1">HTML 幻灯片</span>
        <span className="text-[10px] font-mono text-black/50">{index + 1} / {total}</span>
        <button onClick={() => setFullscreen((f) => !f)} className="p-1 border-2 border-brutal-black hover:bg-brutal-yellow shadow-brutal-sm transition-all duration-150">
          {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>

      <div className={`flex-1 p-4 overflow-auto ${fullscreen ? 'bg-brutal-cream' : ''}`}>
        <div className="border-4 max-w-none mx-auto my-2 shadow-brutal bg-white flex flex-col min-h-full">
          <div className="h-8 w-full" style={{ backgroundColor: slide.accent || '#FFD440' }} />
          <div className="p-8 flex-1 flex flex-col">
            <div className="text-3xl font-extrabold tracking-tight leading-tight">{slide.title}</div>
            {slide.subtitle && <div className="mt-2 text-sm text-black/60 font-mono">{slide.subtitle}</div>}
            <ul className="mt-6 space-y-3 text-lg font-bold">
              {slide.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-2 w-3 h-3 border-2 border-brutal-black shrink-0" style={{ backgroundColor: slide.accent || '#FFD440' }} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="h-8 w-full" style={{ backgroundColor: slide.accent || '#FFD440' }} />
        </div>
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t-2 border-brutal-black shrink-0">
        <button onClick={() => go(-1)} disabled={index === 0} className="p-1.5 border-2 border-brutal-black shadow-brutal-sm hover:bg-brutal-yellow disabled:opacity-30 disabled:shadow-none transition-all duration-150"><ChevronLeft size={14} /></button>
        <div className="flex-1 px-3">
          <div className="h-2 border-2 border-brutal-black bg-brutal-cream relative">
            <div className="absolute inset-y-0 left-0 bg-brutal-black transition-all duration-200" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
        </div>
        <button onClick={() => go(1)} disabled={index === total - 1} className="p-1.5 border-2 border-brutal-black shadow-brutal-sm hover:bg-brutal-yellow disabled:opacity-30 disabled:shadow-none transition-all duration-150"><ChevronRight size={14} /></button>
      </div>
    </div>
  )
}