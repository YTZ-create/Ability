import React, { useState, useEffect } from 'react'
import { TitleBar } from './components/layout/TitleBar'
import { Sidebar } from './components/layout/Sidebar'
import { StatusBar } from './components/layout/StatusBar'
import { TokenUsageDashboard } from './components/layout/TokenUsagePanel'
import { ChatView } from './components/chat/ChatView'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { AgentConversation } from './components/detail/AgentConversation'
import { MemoryViewer } from './components/memory/MemoryViewer'
import { CapabilitiesHub } from './components/capabilities/CapabilitiesHub'
import { useChatStore } from './stores/chatStore'
import { useFormFillStore } from './stores/formFillStore'
import { useFolderStore } from './stores/folderStore'
import { useSettingsStore } from './stores/settingsStore'
import type { FileEntry } from './api/neutralino'
import { X, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react'

const App: React.FC = () => {
  const [showDetail, setShowDetail] = useState(true)
  const [detailView, setDetailView] = useState<'agent' | 'memory' | 'capabilities'>('agent')
  const [detailFile, setDetailFile] = useState<FileEntry | null>(null)
  const messages = useChatStore((s) => s.messages)
  const clearChat = useChatStore((s) => s.clearChat)
  const endSession = useFormFillStore((s) => s.endSession)
  const loadAgentModels = useSettingsStore((s) => s.loadAgentModels)
  const activeFolderId = useFolderStore((s) => s.activeFolderId)
  const activeFolder = useFolderStore((s) => s.folders.find((f) => f.id === activeFolderId))

  const lastAgentMsg = [...messages].reverse().find((m) => m.role === 'agent')

  // 启动时加载 Agent 模型配置
  useEffect(() => {
    loadAgentModels()
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-brutal-cream">
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 flex-shrink-0 h-full overflow-hidden">
          <Sidebar />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-shrink-0 px-4 py-3 border-b-2 border-brutal-black bg-white flex items-center justify-between">
            <div>
              <h1 className="font-bold text-sm">对话</h1>
              {messages.length === 0 && (
                <p className="text-[10px] text-black/70 font-mono">
                  {activeFolder ? `${activeFolder.fileCount} 个文件 · ${activeFolder.path}` : '选择一个文件夹开始分析'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  clearChat()
                  endSession()
                }}
                className="p-1.5 hover:bg-brutal-yellow transition-colors flex-shrink-0 border-2 border-brutal-black"
                title="新建对话"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => setShowDetail(!showDetail)}
                className="p-1.5 hover:bg-brutal-yellow transition-colors flex-shrink-0 border-2 border-brutal-black"
                title={showDetail ? '隐藏详情' : '显示详情'}
              >
                {showDetail ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <ChatView />
          </div>
        </div>

        {showDetail && (
          <div className="w-72 flex-shrink-0 border-l-2 border-brutal-black bg-white flex flex-col">
            <div className="flex items-center justify-between px-2 py-2 border-b-2 border-brutal-black gap-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDetailView('agent')}
                  className={`tab-brutal !px-2 !py-1 !text-[11px] ${detailView === 'agent' ? 'active' : ''}`}
                >
                  Agent 对话
                </button>
                <button
                  onClick={() => setDetailView('memory')}
                  className={`tab-brutal !px-2 !py-1 !text-[11px] ${detailView === 'memory' ? 'active' : ''}`}
                >
                  记忆
                </button>
                <button
                  onClick={() => setDetailView('capabilities')}
                  className={`tab-brutal !px-2 !py-1 !text-[11px] ${detailView === 'capabilities' ? 'active' : ''}`}
                >
                  能力
                </button>
              </div>
              <button onClick={() => setShowDetail(false)} className="p-0.5 hover:bg-brutal-pink hover:text-white flex-shrink-0">
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {detailView === 'memory' ? <MemoryViewer /> : detailView === 'capabilities' ? <CapabilitiesHub /> : <AgentConversation />}
            </div>
          </div>
        )}
      </div>

      <StatusBar />
      <SettingsPanel />
      <TokenUsageDashboard />
    </div>
  )
}

export default App
