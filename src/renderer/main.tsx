import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { initNeutralino, createNeutralinoPlatform } from './api/neutralino'
import { createAgentRegistry, agentRegistry } from './agents/registry'
import { initKnowledgeBase } from './knowledge'
import { createDependencyAnalyzer } from './codebase'
import { initMemoryStore } from './memory'
import { useSidebarStore } from './stores/sidebarStore'
import { officeService } from './services/officeService'
import { usePluginStore } from './stores/pluginStore'

// 开发模式调试句柄（仅 DEV 构建暴露）
if (import.meta.env.DEV) {
  ;(window as any).__debug = { officeService, pluginStore: usePluginStore }
}

// 先渲染 UI，不等待 Neutralino
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
// 异步初始化 Neutralino（窗口控制等原生 API 需要）
initNeutralino().then(async () => {
  const platform = createNeutralinoPlatform()
  // 初始化记忆系统，Oliver(Leader) 通过对其做统一调度(记住/回忆/遗忘/统计)
  const memoryStore = await initMemoryStore(platform)
  createAgentRegistry(platform, memoryStore)
  useSidebarStore.getState().setAgents(agentRegistry.getAll())
  initKnowledgeBase(platform)
  createDependencyAnalyzer(platform)
  console.log('[AI Agent] Platform, Agent Registry, Memory, KB & Codebase analyzer initialized')
}).catch((err) => {
  console.warn('[AI Agent] Neutralino init failed:', err)
})
