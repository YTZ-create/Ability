import React, { useState, useEffect, useRef } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { api } from '../../api/neutralino'

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false)
  const dragRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.window.isMaximized().then(setIsMaximized)
    if (dragRef.current) api.window.setDraggableRegion(dragRef.current)

    // 监听窗口状态变化
    const handleMaximizeChange = () => {
      api.window.isMaximized().then(setIsMaximized)
    }

    // 如果 API 支持事件监听
    if ((api.window as any).on) {
      ;(api.window as any).on('maximize', handleMaximizeChange)
      ;(api.window as any).on('unmaximize', handleMaximizeChange)
      return () => {
        ;(api.window as any).off('maximize', handleMaximizeChange)
        ;(api.window as any).off('unmaximize', handleMaximizeChange)
      }
    }
  }, [])

  const handleMinimize = () => {
    console.log('[TitleBar] minimize clicked, Neutralino:', typeof window.Neutralino, 'NL_PORT:', (window as any).NL_PORT, 'NL_TOKEN:', !!(window as any).NL_TOKEN)
    try { api.window.minimize() } catch (e) { console.error('[TitleBar] minimize error:', e) }
  }
  const handleMaximize = async () => {
    console.log('[TitleBar] maximize clicked, Neutralino:', typeof window.Neutralino)
    try { await api.window.maximize(); setIsMaximized(!isMaximized) } catch (e) { console.error('[TitleBar] maximize error:', e) }
  }
  const handleClose = () => {
    console.log('[TitleBar] close clicked, Neutralino:', typeof window.Neutralino)
    try { api.window.close() } catch (e) { console.error('[TitleBar] close error:', e) }
  }

  return (
    <div className="h-10 bg-brutal-black text-brutal-cream flex items-center justify-between select-none flex-shrink-0">
      <div ref={dragRef} className="flex-1 h-full" />
      <div className="flex items-center h-full">
        <button onClick={handleMinimize} className="h-full px-3 hover:bg-white/20">
          <Minus size={14} />
        </button>
        <button onClick={handleMaximize} className="h-full px-3 hover:bg-white/20">
          <Square size={12} />
        </button>
        <button onClick={handleClose} className="h-full px-4 hover:bg-brutal-pink">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
