/**
 * OfficeDrawer — 办公文档抽屉
 *
 * 特性：
 * - 右侧停靠式抽屉（docked）
 * - 左侧拉取手柄可拖拽调整宽度（min 400 / max 1200）
 * - 严格 brutalist 设计：粗黑边框、硬阴影、黄色主题色
 * - 关闭按钮（X）+ 标题栏
 * - 显示状态由 zustand store 全局控制
 */

import React, { useCallback, useRef, useState, useEffect } from 'react'
import { X, GripVertical, FileSpreadsheet } from 'lucide-react'
import { OfficePanel } from './OfficePanel'
import {
  useOfficeDrawerStore,
  OFFICE_DRAWER_MIN_WIDTH,
  OFFICE_DRAWER_MAX_WIDTH,
} from '../../stores/officeDrawerStore'
import { usePluginStore } from '../../stores/pluginStore'
import { useFormFillStore } from '../../stores/formFillStore'

export const OfficeDrawer: React.FC = () => {
  const isOpen = useOfficeDrawerStore((s) => s.isOpen)
  const width = useOfficeDrawerStore((s) => s.width)
  const close = useOfficeDrawerStore((s) => s.close)
  const setWidth = useOfficeDrawerStore((s) => s.setWidth)
  const feedback = useOfficeDrawerStore((s) => (s.activeKind === 'docs' ? s.docsFeedback : s.sheetsFeedback))

  // Ethan 抽屉同步状态徽标（M3）：会话进行中显示同步中/已完成，异常时显示降级提示
  const drawerSyncMode = useFormFillStore((s) => s.drawerSyncMode)
  const drawerSyncError = useFormFillStore((s) => s.drawerSyncError)
  const docStatus = useFormFillStore((s) => s.activeDocument?.status)
  const isSyncing = drawerSyncMode === 'sheets' || drawerSyncMode === 'docs'

  const plugins = usePluginStore((s) => s.plugins)
  const isOfficeEnabled = plugins.find((p) => p.id === 'univer-office')?.enabled ?? false

  const [isResizing, setIsResizing] = useState(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width
  }, [width])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      // 抽屉在右侧，鼠标向左拖 → 宽度增加
      const delta = startXRef.current - e.clientX
      setWidth(startWidthRef.current + delta)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setWidth])

  // 抽屉始终挂载（避免卸载破坏 Univer 实例），通过 display 控制显隐
  // isOpen=false 时 display:none，重新打开时 Univer 容器仍是原 DOM，不会白屏
  return (
    <>
      {/* 抽屉本体 */}
      <div
        className="flex-shrink-0 border-l-2 border-brutal-black bg-white flex flex-col relative"
        style={{ width: `${width}px`, boxShadow: '-4px 0 0 #141111', display: isOpen ? 'flex' : 'none' }}
      >
        {/* 标题栏（brutalist 风格） */}
        <div className="flex items-center gap-2 px-2 py-1.5 border-b-2 border-brutal-black bg-brutal-cream shrink-0">
          <span
            className="w-6 h-6 flex items-center justify-center border-2 border-brutal-black bg-brutal-lime flex-shrink-0"
            style={{ boxShadow: '2px 2px 0 #141111' }}
            title="办公文档"
          >
            <FileSpreadsheet size={12} />
          </span>
          <span className="font-bold text-xs">办公文档</span>
          <span className="text-[9px] text-black/50 font-mono">Univer</span>
          {/* Ethan 同步状态徽标（brutalist：粗边框 + 硬底色，与现有状态徽章同款） */}
          {isSyncing && (
            <span
              className={`text-[9px] font-bold font-mono px-1.5 py-0.5 border-2 border-brutal-black flex-shrink-0 ${
                docStatus === 'completed' ? 'bg-brutal-lime' : 'bg-brutal-yellow'
              }`}
              title={docStatus === 'completed' ? 'Ethan 填写已完成' : 'Ethan 答案实时同步中'}
            >
              {docStatus === 'completed' ? '✓ 已完成' : '● Ethan 同步中'}
            </span>
          )}
          {feedback && (
            <span className="min-w-0 flex-1 text-[10px] px-1.5 py-0.5 bg-white border border-brutal-black font-mono text-black/70 truncate" title={feedback}>
              {feedback}
            </span>
          )}
          <button
            onClick={close}
            className="ml-auto p-1 border-2 border-brutal-black hover:bg-brutal-pink hover:text-white transition-colors duration-150 flex-shrink-0"
            title="关闭抽屉"
          >
            <X size={12} />
          </button>
        </div>

        {/* 抽屉内容区 */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {isOfficeEnabled ? (
            <OfficePanel />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <div
                className="w-12 h-12 flex items-center justify-center border-2 border-brutal-black bg-brutal-cream"
                style={{ boxShadow: '3px 3px 0 #141111' }}
              >
                <FileSpreadsheet size={20} />
              </div>
              <p className="text-xs font-bold">办公文档 (Univer) 未启用</p>
              <p className="text-[10px] text-black/60 max-w-xs">
                请在插件管理中启用「办公文档 (Univer)」插件后再使用此功能
              </p>
            </div>
          )}
        </div>

        {/* 拉取手柄（左侧垂直条） */}
        <div
          onMouseDown={handleResizeStart}
          className={`absolute top-0 left-0 w-1.5 h-full cursor-col-resize flex items-center justify-center group transition-colors duration-150 ${
            isResizing ? 'bg-brutal-yellow' : 'hover:bg-brutal-yellow'
          }`}
          style={{
            boxShadow: isResizing ? 'inset -2px 0 0 #141111' : 'none',
          }}
          title="拖拽调整宽度"
        >
          <div
            className={`w-1 h-12 border-2 border-brutal-black bg-white transition-all duration-150 ${
              isResizing ? 'bg-brutal-yellow' : 'group-hover:bg-brutal-yellow'
            }`}
            style={{ boxShadow: '1px 1px 0 #141111' }}
          />
        </div>
      </div>
    </>
  )
}

/** 浮动「办公文档」快捷入口按钮（用于 TitleBar 等位置） */
export const OfficeDrawerHandle: React.FC<{ onClick?: () => void }> = ({ onClick }) => {
  const toggle = useOfficeDrawerStore((s) => s.toggle)
  const isOpen = useOfficeDrawerStore((s) => s.isOpen)

  return (
    <button
      onClick={onClick || toggle}
      className={`flex items-center gap-1.5 px-2 py-1 border-2 border-brutal-black transition-all duration-150 ease-out ${
        isOpen
          ? 'bg-brutal-yellow shadow-none translate-x-[1px] translate-y-[1px]'
          : 'bg-white hover:bg-brutal-yellow shadow-brutal-sm hover:shadow-brutal hover:-translate-x-[1px] hover:-translate-y-[1px] active:shadow-none active:translate-x-0 active:translate-y-0'
      }`}
      title={isOpen ? '关闭办公抽屉' : '打开办公抽屉'}
    >
      <FileSpreadsheet size={12} />
      <span className="text-xs font-bold">办公</span>
    </button>
  )
}