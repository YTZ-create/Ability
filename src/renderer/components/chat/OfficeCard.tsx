/**
 * OfficeCard — 在对话流中展示工作簿草稿/审批卡片
 */

import React from 'react'
import { FileSpreadsheet, Check, X, ExternalLink } from 'lucide-react'
import { useOfficeStore, type OfficeItem } from '../../stores/officeStore'
import { useOfficeDrawerStore } from '../../stores/officeDrawerStore'

interface OfficeCardProps {
  workbook: OfficeItem
}

export const OfficeCard: React.FC<OfficeCardProps> = ({ workbook }) => {
  const approve = useOfficeStore((s) => s.approve)
  const discard = useOfficeStore((s) => s.discard)
  const openDrawer = useOfficeDrawerStore((s) => s.open)

  return (
    <div className="border-2 border-brutal-black bg-white shadow-brutal-sm">
      {/* 标题栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b-2 border-brutal-black bg-brutal-cream">
        <span className="w-6 h-6 flex items-center justify-center border-2 border-brutal-black bg-brutal-yellow" style={{ boxShadow: '2px 2px 0 #141111' }}>
          <FileSpreadsheet size={12} />
        </span>
        <span className="text-xs font-bold flex-1 truncate">{workbook.name}</span>
        <span
          className={`text-[9px] font-bold px-1.5 py-0.5 border border-brutal-black ${
            workbook.state === 'ready' ? 'bg-brutal-lime' : 'bg-brutal-yellow'
          }`}
        >
          {workbook.state === 'ready' ? '已批准' : '草稿'}
        </span>
        <button
          onClick={() => openDrawer()}
          className="p-1 border-2 border-brutal-black hover:bg-brutal-yellow transition-colors flex-shrink-0"
          title="在抽屉中打开"
        >
          <ExternalLink size={10} />
        </button>
      </div>

      {/* 内容 */}
      <div className="px-3 py-2 space-y-1">
        {workbook.description && (
          <p className="text-[10px] text-black/70">{workbook.description}</p>
        )}
        <p className="text-[9px] font-mono text-black/50">
          ID: {workbook.id.slice(0, 8)}...
        </p>
      </div>

      {/* 操作按钮（仅 draft 显示） */}
      {workbook.state === 'draft' && (
        <div className="flex border-t-2 border-brutal-black divide-x-2 divide-brutal-black">
          <button
            onClick={() => approve(workbook.id)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-bold hover:bg-brutal-lime transition-colors"
          >
            <Check size={12} /> 批准
          </button>
          <button
            onClick={() => discard(workbook.id)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-bold hover:bg-brutal-pink hover:text-white transition-colors"
          >
            <X size={12} /> 丢弃
          </button>
        </div>
      )}
    </div>
  )
}