import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../../stores/chatStore'
import { formatChatTime } from '../../utils/formatters'
import { Bot, User, Info, Sparkles, FolderSearch, Code2, FileText, FolderCog, Brain, FlaskConical, FileOutput } from 'lucide-react'
import { agentRegistry } from '../../agents/registry'
import { AgentCard } from './AgentCard'
import { AnalysisProgress } from './AnalysisProgress'
import { cleanHandoffContent } from '../../utils/handoff'
import { cleanOfficeBlock, parseOfficeBlock } from '../../utils/officeParser'
import { officeService } from '../../services/officeService'
import { useOfficeStore } from '../../stores/officeStore'
import { OfficeCard } from './OfficeCard'
import type { OfficeItem } from '../../stores/officeStore'
import type { AgentConfig } from '../../agents/base'

const AGENT_ICONS: Record<string, React.ComponentType<{ size?: number | string; color?: string }>> = {
  'leader': Sparkles,
  'file-analyzer': FolderSearch,
  'code-reviewer': Code2,
  'doc-summarizer': FileText,
  'file-organizer': FolderCog,
  'memory': Brain,
  'form-filler': FileOutput,
}

export const MessageBubble: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const [showCard, setShowCard] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<AgentConfig | null>(null)
  const [fadingOut, setFadingOut] = useState(false)
  const [officeWorkbooks, setOfficeWorkbooks] = useState<OfficeItem[]>([])
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const officeProcessedRef = useRef(false)

  // 当进度完成时，延迟淡出
  useEffect(() => {
    if (message.analysisProgress) {
      const isComplete = message.analysisProgress.steps.every(s => s.status === 'done')
      const hasError = message.analysisProgress.steps.some(s => s.status === 'error')
      
      if (isComplete || hasError) {
        // 完成后停留 1.5 秒再淡出
        fadeTimerRef.current = setTimeout(() => {
          setFadingOut(true)
        }, 1500)
      } else {
        setFadingOut(false)
      }
    } else {
      setFadingOut(false)
    }

    return () => {
      if (fadeTimerRef.current) {
        clearTimeout(fadeTimerRef.current)
      }
    }
  }, [message.analysisProgress])

  // 检测并处理 Agent 消息中的 office 块
  const addWorkbook = useOfficeStore((s) => s.addWorkbook)
  useEffect(() => {
    if (!isAgent || !message.content || officeProcessedRef.current) return

    const officeRegex = /```office\s*\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    const newWorkbooks: OfficeItem[] = []

    while ((match = officeRegex.exec(message.content)) !== null) {
      const result = parseOfficeBlock(match[0])
      if (!result || 'error' in result) {
        if (result && 'error' in result) {
          console.error('[OfficeBlock] Parse error:', result.error)
        }
        continue
      }

      const cmd = result.command
      switch (cmd.action) {
        case 'create_workbook': {
          const execResult = officeService.createWorkbook(cmd.params.name)
          if (execResult.success && execResult.data?.id) {
            const wb: OfficeItem = {
              id: execResult.data.id,
              name: cmd.params.name || '未命名工作簿',
              state: 'draft',
              description: cmd.params.description || '',
            }
            newWorkbooks.push(wb)
            addWorkbook(wb)
          }
          break
        }
        case 'create_document': {
          const execResult = officeService.createDocument(cmd.params.name)
          if (execResult.success && execResult.data?.id) {
            const doc: OfficeItem = {
              id: execResult.data.id,
              name: cmd.params.name || '未命名文档',
              state: 'draft',
              description: cmd.params.description || '',
            }
            newWorkbooks.push(doc)
            addWorkbook(doc)
          }
          break
        }
        case 'insert_text': {
          officeService.insertText(cmd.params.text || cmd.params.content || '')
          break
        }
        case 'write_range': {
          officeService.writeRange(
            cmd.params.sheetName || 'Sheet1',
            cmd.params.startRow || 0,
            cmd.params.startCol || 0,
            cmd.params.data || []
          )
          break
        }
        case 'set_style': {
          officeService.setStyle(
            cmd.params.sheetName || 'Sheet1',
            cmd.params.row || 0,
            cmd.params.col || 0,
            cmd.params.style || {}
          )
          break
        }
        case 'export': {
          officeService.exportWorkbook().then(blob => {
            if (blob) {
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = cmd.params.filename || 'workbook.xlsx'
              a.click()
              URL.revokeObjectURL(url)
            }
          })
          break
        }
      }
    }

    if (newWorkbooks.length > 0) {
      setOfficeWorkbooks(prev => [...prev, ...newWorkbooks])
    }
    officeProcessedRef.current = true
  }, [message.content, isAgent, addWorkbook])

  if (message.role === 'system') {
    return <div className="msg-system flex items-center justify-center gap-2"><Info size={12} />{message.content}</div>
  }

  const isAgent = message.role === 'agent'
  const agentColor = message.agentColor || '#FFD440'
  const agentIcon = message.agentName
    ? (AGENT_ICONS[agentRegistry.getAll().find(a => a.name === message.agentName)?.id || ''] ?? Bot)
    : Bot

  const handleAvatarClick = () => {
    if (isAgent && message.agentName) {
      console.log('[AgentCard] Clicked avatar for:', message.agentName)
      const agentConfig = agentRegistry.getAll().find(a => a.name === message.agentName)
      console.log('[AgentCard] Found agent config:', agentConfig)
      if (agentConfig) {
        setSelectedAgent(agentConfig)
        setShowCard(true)
      }
    }
  }

  return (
    <>
      <div className={`flex gap-3 px-4 py-2 ${isAgent ? '' : 'flex-row-reverse'}`}>
        <div 
          className={`w-8 h-8 rounded-sm flex-shrink-0 flex items-center justify-center border-2 border-brutal-black mt-1 ${isAgent ? 'cursor-pointer hover:scale-110 transition-transform duration-75' : ''}`}
          style={{ backgroundColor: isAgent ? agentColor : '#141111' }}
          onClick={handleAvatarClick}
          title={isAgent ? `查看 ${message.agentName} 的名片` : ''}
        >
          {isAgent ? React.createElement(agentIcon, { size: 16, color: '#141111' }) : <User size={16} color="#FFFAEF" />}
        </div>
        <div className={`max-w-[75%] min-w-0 ${isAgent ? '' : 'items-end'}`}>
          <div className={`flex items-center gap-2 mb-1 ${isAgent ? '' : 'flex-row-reverse'}`}>
            <span className="font-bold text-xs">{isAgent ? message.agentName || 'Agent' : '你'}</span>
            <span className="text-[10px] text-black/70 font-mono">{formatChatTime(message.timestamp)}</span>
          </div>
          <div className={isAgent ? 'msg-agent bg-white border-2 border-l-4 border-brutal-black p-3 shadow-brutal-sm' : 'msg-user'}>
            {isAgent ? (
              <div className="prose prose-sm max-w-none text-sm leading-relaxed">
                {message.analysisProgress && (
                  <div className="mb-3" style={{ opacity: fadingOut ? 0 : 1, transform: fadingOut ? 'translateY(-8px)' : 'translateY(0)', transition: 'opacity 0.5s ease-out, transform 0.5s ease-out', maxHeight: fadingOut ? 0 : '400px', overflow: 'hidden' }}>
                    <AnalysisProgress steps={message.analysisProgress.steps} fileName={message.analysisProgress.fileName} fadingOut={fadingOut} />
                  </div>
                )}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{typeof message.content === 'string' ? cleanOfficeBlock(cleanHandoffContent(message.content)) : String(message.content || '')}</ReactMarkdown>
                {message.content === '' && !message.analysisProgress && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex gap-1">
                      <span className="inline-block w-2 h-2 bg-brutal-black rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="inline-block w-2 h-2 bg-brutal-black rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="inline-block w-2 h-2 bg-brutal-black rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-xs font-bold text-black/70 tracking-wide">正在思考中</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{String(message.content)}</div>
            )}
            {officeWorkbooks.length > 0 && (
              <div className="mt-3 space-y-2">
                {officeWorkbooks.map((wb) => (
                  <OfficeCard key={wb.id} workbook={wb} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showCard && selectedAgent && (
        <AgentCard agent={selectedAgent} onClose={() => setShowCard(false)} />
      )}
    </>
  )
}
