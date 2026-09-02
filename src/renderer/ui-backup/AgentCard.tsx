import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import type { AgentConfig } from '../../agents/base'

interface AgentCardProps {
  agent: AgentConfig
  onClose: () => void
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, onClose }) => {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const Icon = agent.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />
      
      {/* Card */}
      <div 
        className="relative bg-white border-4 border-brutal-black p-6 max-w-sm w-full"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '8px 8px 0px #141111' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 hover:bg-brutal-yellow transition-colors border-2 border-transparent hover:border-brutal-black"
        >
          <X size={16} />
        </button>

        {/* Avatar */}
        <div className="flex justify-center mb-4">
          <div 
            className="w-20 h-20 rounded-none border-4 border-brutal-black flex items-center justify-center"
            style={{ backgroundColor: agent.color, boxShadow: '4px 4px 0px #141111' }}
          >
            <Icon size={40} color="#141111" strokeWidth={2.5} />
          </div>
        </div>

        {/* Name */}
        <h2 className="text-center font-black text-2xl tracking-wider uppercase mb-2">
          {agent.name}
        </h2>

        {/* ID */}
        <div className="text-center mb-4">
          <span className="inline-block px-3 py-1 bg-brutal-yellow border-2 border-brutal-black text-xs font-mono font-bold">
            {agent.id}
          </span>
        </div>

        {/* Description */}
        <div className="border-t-2 border-brutal-black pt-4 mb-4">
          <h3 className="font-bold text-xs uppercase tracking-wider mb-2 text-black/80">职责</h3>
          <p className="text-sm leading-relaxed">{agent.description}</p>
        </div>

        {/* Provider */}
        <div className="border-t-2 border-brutal-black pt-4">
          <h3 className="font-bold text-xs uppercase tracking-wider mb-2 text-black/80">模型提供商</h3>
          <p className="text-sm font-mono">{agent.provider || '未配置'}</p>
        </div>

        {/* Decorative elements */}
        <div className="absolute -top-2 -left-2 w-4 h-4 bg-brutal-yellow border-2 border-brutal-black" />
        <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-brutal-yellow border-2 border-brutal-black" />
      </div>
    </div>
  )
}
