import { BaseAgent, type AgentConfig, type AgentContext } from './base'
import type { FolderProject } from '../stores/folderStore'
import { agentRegistry } from './registry'
import type { PlatformAPI } from '../api/platformAPI'
import type { MemoryStore } from '../memory/memoryStore'
import { Sparkles } from 'lucide-react'
import { callLLM, resolveProvider } from '../utils/llm'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { START_REPLIES, END_REPLIES, randomPick } from '../utils/replies'

export class LeaderAgent extends BaseAgent {
  private memoryStore?: MemoryStore

  constructor(platform: PlatformAPI, memoryStore?: MemoryStore) {
    super(platform)
    this.memoryStore = memoryStore
  }

  config: AgentConfig = {
    id: 'leader',
    name: 'Oliver',
    description: '理解你的问题，自动分配给最合适的 Agent 处理',
    icon: Sparkles,
    color: '#FFD440',
    provider: 'auto',
    model: '',
    systemPrompt: `你是 Oliver，智能任务调度助手。

## 你的团队（11 位成员）
- **Oliver** (你) - 智能调度助手，负责理解用户需求并分配任务
- **Charlotte** - 文件分析专家，分析文件夹结构和文件类型分布
- **Amelia** - 文档摘要专家，读取文档内容，总结项目核心信息
- **Ethan** - 信息采集与文档填写专家，对话式文档填写
- **Atlas** - 系统架构设计专家，生成架构图、模块依赖图
- **Audrey** - 深度研究专家，多来源调研、竞品分析
- **Avery** - 测试修复与代码审查专家，自动测试、Bug 修复、代码审查
- **Aurora** - 日常事务专家，新闻摘要、日常提醒、文件分类
- **Aria** - 内容生成专家，文章、文案、邮件、社交媒体内容
- **Arthur** - 文档与演示全能专家，Word/PPT/Excel/PDF/HTML 处理
- **Alice** - 浏览器控制专家，AI 驱动的网页自动化

## 工作流程
1. 分析用户意图，判断最适合的子 Agent
2. 将用户问题转发给对应 Agent 处理

## 路由规则（严格按关键词匹配，不要自由判断）
- 用户提到"填写"、"填表"、"信息采集"、"问卷"、"表单"、"待填"、"填入"、"Ethan"、"帮我填"、"完成附件"、"完成文档"、"完成表格"、"帮我完成" → Ethan (form-filler)
- 用户提到"分析"、"概览"、"结构"、"技术栈"、"文件类型"、"项目情况" → Charlotte (file-analyzer)
- 用户提到"审查"、"代码质量"、"代码审查"、"bug"、"漏洞"、"改进"、"优化"、"测试"、"修复" → Avery (qa)
- 用户提到"总结"、"摘要"、"readme"、"项目介绍"、"功能"、"读取文档" → Amelia (doc-summarizer)
- 用户提到"整理"、"分类"、"重组"、"归档"、"移动文件"、"文件操作" → Aurora (daily)
- 用户提到"架构"、"设计"、"系统设计"、"模块"、"依赖"、"数据流"、"mermaid" → Atlas (architect)
- 用户提到"研究"、"调研"、"分析竞品"、"对比"、"搜索"、"查找" → Audrey (researcher)
- 用户提到"文章"、"文案"、"邮件"、"写作"、"生成内容"、"社交媒体" → Aria (writer)
- 用户提到"文档"、"word"、"ppt"、"excel"、"pdf"、"演示"、"报告" → Arthur (archivist)
- 用户提到"网页"、"浏览器"、"自动化"、"网页操作"、"抓取"、"爬取" → Alice (browser)
- 如果不确定，优先使用 Charlotte

## 重要：关于"文档"关键词
- 如果用户说"填写文档"、"填表"等包含"填写"的，必须路由给 Ethan (form-filler)，不要路由给 Amelia
- Amelia 只负责"总结"、"摘要"、"读取文档内容"，不负责填写
- 提到 Word/PPT/Excel/PDF 格式处理 → Arthur (archivist)

## 连续对话规则
如果用户是在回复之前某个 Agent 的工作（如确认、追问、修改），应该路由回同一个 Agent。
例如：用户说"同意"、"好的"、"执行"，而之前是 Avery 提出的修复计划，应该路由给 qa。

## 记忆调度（记住 / 回忆 / 遗忘 / 统计）
你拥有跨会话记忆能力（通过 MemoryStore），当用户在表达以下意图时，**不要路由给子 Agent**，直接由你处理：
- **记住**：用户说"记住"、"保存"、"记下"、"别忘了"、"记住这个"、"以后记得" — 把用户想让长期保存的信息存入记忆（category 优先 user-preference / project-context）
- **回忆**：用户说"回忆"、"记得吗"、"我上次说"、"之前提过"、"我们之前讨论过"、"查一下记忆" — 从记忆中检索相关内容并回显给用户
- **遗忘**：用户说"忘记"、"遗忘"、"删除记忆"、"忘掉"、"删掉这条记忆" — 从记忆中删除对应条目
- **统计**：用户说"统计记忆"、"记忆有多少"、"记忆数量"、"记忆概况" — 返回记忆总量、各分类数量、最早/最新时间

## 输出格式
只回复一句话，说明你选择了哪个 Agent。例如："已分配给 Charlotte 处理。"
语言: 中文。`,
  }

  private pushConv(agentName: string, agentColor: string, content: string, isLeader = false) {
    useChatStore.getState().addAgentConversation({ agentName, agentColor, content, isLeader })
  }

  async execute(ctx: AgentContext, onToken?: (token: string) => void): Promise<string> {
    const agents = agentRegistry.getAll().filter((a) => a.id !== 'leader')
    const agentList = agents.map((a) => `- ${a.id}: ${a.name} (${a.description})`).join('\n')

    // Step 0: 检查是否是关于团队介绍的问题
    if (this.isTeamIntroduction(ctx.userMessage)) {
      return await this.answerTeamIntroduction(onToken)
    }

    // Step 0.3: 检查是否是 Oliver 自我介绍
    if (this.isSelfIntroduction(ctx.userMessage)) {
      return await this.answerSelfIntroduction(onToken)
    }

    // Step 0.45: 记忆调度命令（记住/回忆/遗忘/统计）—— 由 Oliver 直接处理，不路由给子 Agent
    const memoryIntents = this.detectMemoryIntent(ctx.userMessage)
    if (memoryIntents.type !== 'none') {
      return await this.handleMemoryCommand({ memoryIntents, folderPath: ctx.folder.path, userMessage: ctx.userMessage, signal: ctx.signal, history: ctx.history }, onToken)
    }

    // Step 0.5: 用 LLM 判断是否是问候/闲聊，如果是则由 Oliver 直接回应
    if (await this.isCasualConversation(ctx.userMessage)) {
      return await this.answerCasual(ctx.userMessage, onToken)
    }

    // Step 0.8: 查询跨会话记忆
    let memoryContext = ''
    if (this.memoryStore && ctx.folder.path) {
      try {
        const memories = this.memoryStore.query({
          projectPath: ctx.folder.path,
          limit: 5,
        })
        if (memories.length > 0) {
          memoryContext = '\n\n## 历史分析记录\n' + memories.map((m) => `- [${m.category}] ${m.content.substring(0, 200)}`).join('\n')
          // 将记忆上下文注入到后续的用户消息中
          this.pushConv(this.config.name, this.config.color, `📚 回忆起了 ${memories.length} 条相关历史分析记录`, true)
        }
      } catch {
        // 记忆查询失败不影响主流程
      }
    }

    // Step 1: 分析用户意图，生成上下文简报
    const analysisPrompt = `请分析用户的自然语言需求，生成一份简洁的任务简报。

## 用户问题
${ctx.userMessage}
${memoryContext}

## 要求
1. 用 2-3 句话概括用户的核心需求
2. 指出用户可能关心的重点
3. 如果有隐含需求，也请指出
4. 保持简洁，不要超过 150 字

请直接输出分析结果，不要加标题。`

    const analysisMessages = [
      { role: 'system' as const, content: '你是任务分析助手，负责将用户的自然语言需求转化为清晰的任务简报。' },
      { role: 'user' as const, content: analysisPrompt },
    ]

    try {
      let leaderContext = ''
      try {
        const settingsStore = useSettingsStore.getState()
        const userConfig = settingsStore.getAgentModel(this.config.id)
        const provider = userConfig?.provider || this.config.provider
        const model = userConfig?.model || this.config.model || ''
        
        leaderContext = await callLLM({
          provider,
          model,
          messages: analysisMessages,
          signal: ctx.signal,
        })
      } catch {
        // 分析失败不影响主流程
      }

      // 推送到对话面板
      if (leaderContext) {
        this.pushConv(this.config.name, this.config.color, leaderContext, true)
      }

      // Step 2: 检查是否是连续对话
      let targetAgentId = this.detectContinuousConversation(ctx.userMessage, ctx.history)

      // Step 2.5: 确定性关键词预检（不走 LLM，直接匹配）
      if (!targetAgentId) {
        targetAgentId = this.keywordRoute(ctx.userMessage)
      }

      // Step 3: 表单填写类任务强制拦截（在LLM路由之前，避免LLM返回无法匹配的id）
      if (!targetAgentId) {
        // 宽泛匹配：包含"完成/弄/处理/搞定" + 文档相关词，或明确的表单填写关键词
        const hasDocWord = /文档|表格|附件|申报书|表单|问卷|表/i.test(ctx.userMessage)
        const hasActionWord = /完成|弄|处理|搞定|填/i.test(ctx.userMessage)
        const explicitFormKeywords = /填写|填表|信息采集|待填|填入|帮我填|附件[一二三四五六七八九十\d]/i
        if (explicitFormKeywords.test(ctx.userMessage) || (hasDocWord && hasActionWord)) {
          targetAgentId = 'form-filler'
        }
      }

      // Step 4: 单 Agent 路由（LLM 路由，作为 fallback）
      if (!targetAgentId) {
        const routePrompt = `根据用户意图，选择唯一合适的 Agent。只回复 agent id，不要其他内容。

Agent 列表：
- form-filler：填写文档、填表、完成附件/表格/申报书
- file-analyzer：分析文件夹、项目结构、技术栈
- qa：代码审查、测试修复、bug 修复、代码审查
- doc-summarizer：总结文档内容、摘要、项目介绍
- daily：文件整理、新闻摘要、日常提醒
- architect：系统架构设计、生成架构图、mermaid
- researcher：深度研究、竞品分析、多来源调研
- writer：文章/文案/邮件/社交媒体内容生成
- archivist：Word/PPT/Excel/PDF/HTML 文档处理
- browser：网页自动化、表单填写、数据抓取

用户问题：${ctx.userMessage}

只回复一个 agent id（必须是上面列表中的id，如 form-filler、file-analyzer 等）：`

        const routeMessages = [
          { role: 'system' as const, content: '只回复一个 agent id，不要解释，必须是列表中的id。' },
          { role: 'user' as const, content: routePrompt },
        ]

        const settingsStore = useSettingsStore.getState()
        const userConfig = settingsStore.getAgentModel(this.config.id)
        const provider = userConfig?.provider || this.config.provider
        const model = userConfig?.model || this.config.model || ''

        const routeResult = await callLLM({
          provider,
          model,
          messages: routeMessages,
          signal: ctx.signal,
        })

        // 提取 Agent id
        const trimmed = routeResult.trim().toLowerCase()
        for (const a of agents) {
          if (trimmed.includes(a.id)) {
            targetAgentId = a.id
            break
          }
        }
        
        // 如果LLM返回了无法匹配的id，再次检查是否是表单填写任务
        if (!targetAgentId) {
          const formFillPatterns = /填写|填表|附件|文档|表格|申报书|弄一下|处理|搞定/i
          if (formFillPatterns.test(ctx.userMessage)) {
            targetAgentId = 'form-filler'
          }
        }
      }

      // Step 5: 如果单 Agent 路由仍然失败，检测是否需要多 Agent 协作
      if (!targetAgentId) {
        const multiAgentCheck = await this.detectMultiAgentTask(ctx.userMessage, ctx.signal)
        if (multiAgentCheck.needCollaboration) {
          return await this.handleMultiAgentCollaboration(ctx, multiAgentCheck.agents, onToken)
        }
        targetAgentId = 'file-analyzer'
      }

      const targetAgent = agentRegistry.get(targetAgentId)
      if (!targetAgent) {
        return ` 未找到 Agent: ${targetAgentId}`
      }

      const agentConfig = agentRegistry.getConfig(targetAgentId)
      const reply = `已分配给 **${agentConfig?.name}** 处理。`

      // 流式输出 Oliver 的简短回复
      if (onToken) {
        for (const char of reply) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 15))
        }
      }

      // 推送路由信息到对话面板
      this.pushConv(this.config.name, this.config.color, `已将任务分配给 **${agentConfig?.name}**`, true)

      // 子 Agent 简短确认（随机）
      this.pushConv(agentConfig?.name || targetAgentId, agentConfig?.color || '#FFD440', randomPick(START_REPLIES), false)

      // 返回子 Agent 信息，由 ChatInput 创建新消息并执行
      return JSON.stringify({
        __dispatch: true,
        targetAgentId,
        agentName: agentConfig?.name,
        agentColor: agentConfig?.color,
        leaderContext,
      })
    } catch (err: any) {
      return ` 调度失败: ${err.message}`
    }
  }

  private async detectMultiAgentTask(userMessage: string, signal?: AbortSignal): Promise<{ needCollaboration: boolean; agents: string[] }> {
    const prompt = `分析以下任务是否需要多个 Agent 协作完成。

## 用户问题
${userMessage}

## 可用 Agent
- **file-analyzer**: 文件分析 — 分析文件夹结构、文件类型分布、技术栈推断、项目概览
- **qa**: 测试修复与代码审查 — 自动测试运行、bug 修复、代码审查
- **doc-summarizer**: 文档摘要 — 读取文档内容，总结项目核心信息
- **daily**: 日常事务 — 新闻摘要、日常提醒、文件分类整理
- **form-filler**: 信息采集与文档填写 — 从文档中提取待填项，对话式收集信息并自动填入文档
- **architect**: 系统架构设计 — 生成架构图、模块依赖图、数据流图
- **researcher**: 深度研究 — 多来源调研、竞品分析、结构化报告
- **writer**: 内容生成 — 文章、文案、邮件、社交媒体内容生成
- **archivist**: 文档与演示 — Word/PPT/Excel/PDF/HTML 多格式文档处理
- **browser**: 浏览器控制 — 网页自动化、表单填写、数据抓取

## 判断标准
- 如果任务明确涉及多个方面（如"分析并整理"、"审查代码并总结文档"），则需要多 Agent 协作
- 如果任务主要是单一类型，则不需要

## 输出格式
只回复 JSON，格式如下：
\`\`\`json
{
  "needCollaboration": true/false,
  "agents": ["agent-id-1", "agent-id-2"]
}
\`\`\`

如果不需要协作，agents 数组只包含一个最合适的 Agent id。`

    try {
      const settingsStore = useSettingsStore.getState()
      const userConfig = settingsStore.getAgentModel(this.config.id)
      const provider = userConfig?.provider || this.config.provider
      const model = userConfig?.model || this.config.model || ''
      
      const result = await callLLM({
        provider,
        model,
        messages: [
          { role: 'system', content: '你是任务分析助手，只回复 JSON，不要解释。' },
          { role: 'user', content: prompt },
        ],
        signal,
      })

      // 更精确的 JSON 提取：查找最外层的 {...}
      const jsonMatch = result.match(/\{[\s\S]*?\}(?=\s*$|\s*\n)/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return {
          needCollaboration: parsed.needCollaboration && parsed.agents.length > 1,
          agents: parsed.agents || [],
        }
      }
    } catch {
      // 解析失败，默认单 Agent
    }

    return { needCollaboration: false, agents: [] }
  }

  private async handleMultiAgentCollaboration(
    ctx: { folder: FolderProject; userMessage: string; history?: { role: 'user' | 'agent'; content: string }[] },
    agentIds: string[],
    onToken?: (token: string) => void
  ): Promise<string> {
    const folderInfo = ctx.folder.files
      ? `项目路径: ${ctx.folder.path}, 文件数: ${ctx.folder.fileCount}`
      : `项目路径: ${ctx.folder.path}`

    // ===== Round 1: 任务分解（代码层面生成差异化子任务） =====
    this.pushConv(this.config.name, this.config.color, '🔄 **Round 1**: 正在分解任务...', true)

    // 根据每个 Agent 的专长，直接生成定制化的子任务
    const subTasks = agentIds.map((id, i) => {
      const cfg = agentRegistry.getConfig(id)
      if (!cfg) return { agentId: id, task: ctx.userMessage, priority: i + 1 }

      // 根据 Agent 类型生成差异化任务
      let task = ''
      switch (id) {
        case 'file-analyzer':
          task = `从文件分析专家的角度分析项目：\n1. 分析文件夹结构和目录组织\n2. 统计文件类型分布和技术栈\n3. 识别核心文件和关键目录\n4. 评估项目规模和复杂度\n用户原始需求：${ctx.userMessage}`
          break
        case 'qa':
          task = `从测试修复与代码审查专家的角度分析项目：\n1. 运行自动测试并分析结果\n2. 审查代码质量和架构设计\n3. 检查潜在 bug 和安全漏洞\n4. 提出代码修复和优化建议\n用户原始需求：${ctx.userMessage}`
          break
        case 'doc-summarizer':
          task = `从文档摘要专家的角度分析项目：\n1. 查找并分析项目文档（README、文档文件等）\n2. 总结项目核心功能和目标\n3. 提取关键技术信息\n4. 评估文档完整性\n用户原始需求：${ctx.userMessage}`
          break
        case 'daily':
          task = `从日常事务专家的角度分析项目：\n1. 整理文件分类和归档\n2. 识别需要清理的文件\n3. 提出文件重组建议\n4. 生成日常任务摘要\n用户原始需求：${ctx.userMessage}`
          break
        case 'architect':
          task = `从系统架构设计专家的角度分析项目：\n1. 分析系统架构和模块关系\n2. 识别依赖关系和数据流\n3. 生成架构图和模块依赖图\n4. 评估架构设计质量\n用户原始需求：${ctx.userMessage}`
          break
        case 'researcher':
          task = `从深度研究专家的角度分析项目：\n1. 进行多来源信息调研\n2. 对比分析竞品和方案\n3. 生成结构化研究报告\n4. 提供决策建议\n用户原始需求：${ctx.userMessage}`
          break
        case 'writer':
          task = `从内容生成专家的角度分析项目：\n1. 根据需求生成文章或文案\n2. 调整内容风格和语气\n3. 生成多种版本供选择\n4. 优化内容表达\n用户原始需求：${ctx.userMessage}`
          break
        case 'archivist':
          task = `从文档与演示全能专家的角度分析项目：\n1. 识别需要创建/转换的文档格式\n2. 处理 Word/PPT/Excel/PDF/HTML 文件\n3. 生成文档大纲和模板\n4. 执行格式转换\n用户原始需求：${ctx.userMessage}`
          break
        case 'browser':
          task = `从浏览器控制专家的角度分析项目：\n1. 分析网页操作需求\n2. 规划自动化步骤\n3. 设计数据抓取策略\n4. 生成操作指引\n用户原始需求：${ctx.userMessage}`
          break
        case 'form-filler':
          task = `从信息采集专家的角度分析项目：\n1. 识别项目中的文档和模板文件\n2. 提取文档中需要填写的信息项\n3. 分析信息采集的完整性和规范性\n4. 提出文档填写优化建议\n用户原始需求：${ctx.userMessage}`
          break
        default:
          task = `${cfg.description}\n用户原始需求：${ctx.userMessage}`
      }

      return { agentId: id, task, priority: i + 1 }
    })

    // 推送分解结果
    const decomposeSummary = subTasks.map((st) => {
      const cfg = agentRegistry.getConfig(st.agentId)
      return `- **${cfg?.name || st.agentId}** → ${st.task.split('\n')[0]}`
    }).join('\n')
    this.pushConv(this.config.name, this.config.color, `📋 **任务分解完成**:\n${decomposeSummary}`, true)

    // ===== Round 2: 并行 Agent 分析 =====
    this.pushConv(this.config.name, this.config.color, '⚡ **Round 2**: 各 Agent 并行分析中...', true)

    interface AgentAnalysis {
      agentId: string
      agentName: string
      findings: string
      data: string
      suggestions: string
      rawContent: string
    }

    const analyses = new Map<string, AgentAnalysis>()

    await Promise.allSettled(
      subTasks.map(async (st) => {
        const agent = agentRegistry.get(st.agentId)
        const cfg = agentRegistry.getConfig(st.agentId)
        if (!agent || !cfg) return

        const analyzePrompt = `请对分配给你的子任务进行分析。使用你的专业知识，输出结构化的分析报告。

## 用户原始任务
${ctx.userMessage}

## 分配给你的子任务
${st.task}

## 项目信息
${folderInfo}

## 输出格式
\`\`\`json
{
  "findings": "关键发现（2-5 条，每条一行，Markdown 格式）",
  "data": "支撑数据（如文件数量、技术栈版本等）",
  "suggestions": "建议行动项（1-3 条）"
}
\`\`\`

请基于你的角色和专业知识进行分析。语言: 中文。`

        try {
          this.pushConv(cfg.name, cfg.color, `🔍 开始分析: ${st.task.substring(0, 60)}...`, false)

          const settingsStore = useSettingsStore.getState()
          const userConfig = settingsStore.getAgentModel(st.agentId)
          const provider = userConfig?.provider || cfg.provider
          const model = userConfig?.model || cfg.model || ''

          const result = await callLLM({
            provider,
            model,
            messages: [
              { role: 'system', content: cfg.systemPrompt },
              { role: 'user', content: analyzePrompt },
            ],
            signal: ctx.signal,
          })

          const jsonMatch = result.match(/\{[\s\S]*\}/)
          let parsed: { findings?: any; data?: any; suggestions?: any } = {}
          if (jsonMatch) {
            try {
              parsed = JSON.parse(jsonMatch[0])
            } catch {
              parsed = { findings: result.substring(0, 500), data: '', suggestions: '' }
            }
          } else {
            parsed = { findings: result.substring(0, 500), data: '', suggestions: '' }
          }

          const toString = (v: any): string => {
            if (typeof v === 'string') return v
            if (Array.isArray(v)) return v.join('\n')
            if (v && typeof v === 'object') return JSON.stringify(v)
            return String(v ?? '')
          }

          const analysis: AgentAnalysis = {
            agentId: st.agentId,
            agentName: cfg.name,
            findings: toString(parsed.findings) || '无具体发现',
            data: toString(parsed.data),
            suggestions: toString(parsed.suggestions),
            rawContent: result,
          }

          analyses.set(st.agentId, analysis)

          // 推送分析结果到面板
          const summary = `**发现**: ${analysis.findings.substring(0, 200)}\n${analysis.suggestions ? `**建议**: ${analysis.suggestions.substring(0, 150)}` : ''}`
          this.pushConv(cfg.name, cfg.color, summary, false)

        } catch (err: any) {
          this.pushConv(cfg.name, cfg.color, `⚠️ 分析失败: ${err.message}`, false)
        }
      })
    )

    if (analyses.size === 0) {
      return ' 所有 Agent 分析均失败，请稍后重试。'
    }

    // ===== Round 3: 交叉评审 =====
    this.pushConv(this.config.name, this.config.color, '🔄 **Round 3**: 交叉评审中，各 Agent 互审分析结果...', true)

    const allAnalyses = [...analyses.values()]
    const reviews = new Map<string, string>()

    await Promise.allSettled(
      allAnalyses.map(async (analysis) => {
        const otherAnalyses = allAnalyses.filter((a) => a.agentId !== analysis.agentId)
        if (otherAnalyses.length === 0) return

        const otherSummaries = otherAnalyses.map((a) =>
          `### ${a.agentName} 的分析\n**发现**: ${a.findings.substring(0, 300)}\n**建议**: ${a.suggestions.substring(0, 200)}`
        ).join('\n\n')

        const reviewPrompt = `请审阅其他 Agent 的分析，判断是否有你需要补充或修正的地方。

## 你的分析
**发现**: ${analysis.findings}
**建议**: ${analysis.suggestions}

## 其他 Agent 的分析
${otherSummaries}

## 指令
1. 如果其他 Agent 的发现与你相关但你未覆盖，请补充
2. 如果你发现其他 Agent 的分析有冲突或遗漏，请指出
3. 如果无需补充，只回复"无需补充"
4. 保持简洁，不超过 200 字

直接回复，不要加 JSON 包装。`

        try {
          const agent = agentRegistry.get(analysis.agentId)
          const cfg = agentRegistry.getConfig(analysis.agentId)

          if (agent && cfg) {
            const settingsStore = useSettingsStore.getState()
            const userConfig = settingsStore.getAgentModel(analysis.agentId)
            const provider = userConfig?.provider || cfg.provider
            const model = userConfig?.model || cfg.model || ''

            const review = await callLLM({
              provider,
              model,
              messages: [
                { role: 'system', content: '你是交叉评审助手，审视其他 Agent 的分析并补充你的专业视角。' },
                { role: 'user', content: reviewPrompt },
              ],
              signal: ctx.signal,
            })

            if (review.trim() !== '无需补充') {
              reviews.set(analysis.agentId, review)
              this.pushConv(cfg.name, cfg.color, `💬 补充: ${review.substring(0, 200)}`, false)
            }
          }
        } catch {
          // 评审失败不影响流程
        }
      })
    )

    // ===== Round 4: Leader 综合 =====
    this.pushConv(this.config.name, this.config.color, '🧠 **Round 4**: 综合所有讨论，生成最终执行计划...', true)

    const allFindings = allAnalyses.map((a) =>
      `### ${a.agentName} (${a.agentId})
**发现**: ${a.findings}
**数据**: ${a.data}
**建议**: ${a.suggestions}
${reviews.has(a.agentId) ? `**交叉评审补充**: ${reviews.get(a.agentId)}` : ''}`
    ).join('\n\n')

    const synthesisPrompt = `请综合以下多 Agent 协作讨论的全部分析，生成最终执行计划。

## 用户原始任务
${ctx.userMessage}

## 项目信息
${folderInfo}

## 所有 Agent 分析结果
${allFindings}

## 输出格式
\`\`\`json
{
  "primaryAgentId": "最适合执行最终任务的 Agent ID",
  "synthesis": "综合摘要（Markdown 格式，3-5 句话概括关键发现和建议）",
  "contextForExecution": "传递给执行 Agent 的完整上下文（包含所有关键信息和行动建议）"
}
\`\`\`

规则：
- primaryAgentId 必须从可用 Agent ID 中选择：${agentIds.join(', ')}
- synthesis 简洁有力
- contextForExecution 要包含足够的上下文让执行 Agent 理解全局

只输出 JSON。`

    let primaryAgentId = agentIds[0]
    let leaderContext = ctx.userMessage
    let synthesisText = ''

    try {
      const settingsStore = useSettingsStore.getState()
      const userConfig = settingsStore.getAgentModel(this.config.id)
      const provider = userConfig?.provider || this.config.provider
      const model = userConfig?.model || this.config.model || ''

      const synthesisResult = await callLLM({
        provider,
        model,
        messages: [
          { role: 'system', content: '你是综合合成助手，只输出 JSON。' },
          { role: 'user', content: synthesisPrompt },
        ],
        signal: ctx.signal,
      })

      const jsonMatch = synthesisResult.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        primaryAgentId = parsed.primaryAgentId || agentIds[0]
        leaderContext = typeof parsed.contextForExecution === 'string' ? parsed.contextForExecution : JSON.stringify(parsed.contextForExecution || '')
        synthesisText = typeof parsed.synthesis === 'string' ? parsed.synthesis : Array.isArray(parsed.synthesis) ? parsed.synthesis.join('\n') : ''

        // 推送综合摘要到面板
        if (synthesisText) {
          this.pushConv(this.config.name, this.config.color, `📊 **综合结论**:\n${synthesisText}`, true)
        }
      }
    } catch {
      // 合成失败，使用第一个 Agent，上下文是所有分析的聚合
      leaderContext = `## 多 Agent 协作分析汇总\n\n${allFindings}\n\n## 用户原始问题\n${ctx.userMessage}`
    }

    // 确保 primaryAgentId 在 agentIds 中
    if (!agentIds.includes(primaryAgentId)) {
      primaryAgentId = agentIds[0]
    }

    // 调度主执行 Agent
    const primaryAgent = agentRegistry.get(primaryAgentId)
    const primaryConfig = agentRegistry.getConfig(primaryAgentId)

    if (primaryAgent && primaryConfig) {
      // 将综合结论通过 onToken 流式输出到 Oliver 的消息气泡中
      const replyText = synthesisText
        ? `经过 ${analyses.size} 位 Agent 协作分析，综合结论如下：\n\n${synthesisText}\n\n接下来由 **${primaryConfig.name}** 执行具体任务。`
        : `经过 ${analyses.size} 位 Agent 协作分析，接下来由 **${primaryConfig.name}** 执行具体任务。`

      if (onToken) {
        for (const char of replyText) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 10))
        }
      }

      this.pushConv(this.config.name, this.config.color, `✅ 经过 ${analyses.size} 位 Agent 讨论，由 **${primaryConfig.name}** 执行最终任务。`, true)
      this.pushConv(primaryConfig.name, primaryConfig.color, randomPick(START_REPLIES), false)

      return JSON.stringify({
        __dispatch: true,
        targetAgentId: primaryAgentId,
        agentName: primaryConfig.name,
        agentColor: primaryConfig.color,
        leaderContext,
      })
    }

    return ' 协作调度失败'
  }

  private isTeamIntroduction(userMessage: string): boolean {
    const msg = userMessage.toLowerCase().trim()
    // 排除"介绍自己"、"介绍你"等自我介绍类问题
    const selfIntroPatterns = [/介绍.*自己/, /介绍.*你/, /你是谁/, /你能做什么/, /你能干嘛/]
    if (selfIntroPatterns.some(p => p.test(msg))) return false
    // 必须包含"介绍" + 团队相关词，避免"协作"等宽泛词误匹配
    const hasIntro = msg.includes('介绍') || msg.includes('介绍下') || msg.includes('介绍一下')
    const teamKeywords = ['团队', '你们', '成员', 'agent', '几个人']
    return hasIntro && teamKeywords.some(kw => msg.includes(kw))
  }

  private isSelfIntroduction(userMessage: string): boolean {
    const msg = userMessage.toLowerCase().trim()
    const patterns = [
      /介绍.*自己/,
      /介绍.*你/,
      /你是谁/,
      /你能做什么/,
      /你能干嘛/,
      /你是干什么的/,
      /你的职责/,
      /你是.*角色/,
      /你是.*领导/,
      /oliver.*介绍/,
      /介绍一下.*oliver/,
    ]
    return patterns.some(p => p.test(msg))
  }

  private async answerSelfIntroduction(onToken?: (token: string) => void): Promise<string> {
    const selfIntro = `我是 **Oliver**，团队的智能调度助手，也是整个 Agent 团队的领导者。

## 我的职责
我负责理解你的自然语言需求，自动判断并分配给最合适的 Agent 处理。你不需要知道每个 Agent 的具体分工，只需要用自然语言描述需求，我来安排协作。

## 我的团队（11 位成员）
- **Charlotte** — 文件分析专家，分析文件夹结构、文件类型分布、技术栈推断
- **Amelia** — 文档摘要专家，读取文档内容，总结项目核心信息
- **Ethan** — 信息采集与文档填写专家，对话式文档填写
- **Atlas** — 系统架构设计专家，生成架构图、模块依赖图
- **Audrey** — 深度研究专家，多来源调研、竞品分析
- **Avery** — 测试修复与代码审查专家，自动测试、Bug 修复
- **Aurora** — 日常事务专家，新闻摘要、文件分类
- **Aria** — 内容生成专家，文章、文案、邮件生成
- **Arthur** — 文档与演示全能专家，Word/PPT/Excel/PDF 处理
- **Alice** — 浏览器控制专家，AI 驱动的网页自动化

## 协作场景
- **"分析并整理这个文件夹"** → Charlotte 分析 → Aurora 执行整理
- **"审查代码并总结文档"** → Avery 审查 → Amelia 总结
- **"生成架构图"** → Atlas 生成
- **"深度研究竞品"** → Audrey 调研
- **"生成一份 PPT"** → Arthur 处理

你只需要用自然语言描述需求，我会自动判断并安排协作！`

    if (onToken) {
      for (const char of selfIntro) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 8))
      }
    }

    return selfIntro
  }

  private async isCasualConversation(userMessage: string): Promise<boolean> {
    const msg = userMessage.trim()
    if (!msg) return false

    // 快速路径：明确的问候/闲聊关键词，避免不必要的 LLM 调用
    const quickGreeting = /^(你好|你好啊|您好|您好啊|hi\b|hello\b|hey\b|早上好|上午好|下午好|晚上好|在吗|在不在|嗨|哈喽|早啊|晚安)/i
    const quickCasual = /^(没什么|好吧|算了|没事|谢谢|感谢|哈哈|嘿|嗯|不错|好的$|行$|可以$|就这样|随便|ok$|yes$|no$|nah)/i
    // 寒/关心类：今天怎么样、最近好吗、吃了吗、感觉如何 等
    const quickSmallTalk = /(今天.*怎么样|最近.*怎么样|最近.*好吗|感觉.*怎么样|吃.*了吗|过得.*怎么样|心情.*怎么样|身体.*怎么样|工作.*怎么样|生活.*怎么样)/i
    // 口语化思考/疑惑/困惑/随意表达（无明确任务意图）
    const quickConversational = /^(我想想|让我想想|我想一下|等一下|稍等|什么意思|是什么意思|啥意思|搞不懂|不明白|不知道|为啥|为什么$|真的吗|是吗|这样啊|原来如此|懂了|明白了$|了解了$|知道了$|我想|让我|让我想想再说|先不急|先不|不急|等等|稍等一下|我想想再说)/i
    // 纯标点/极短无意义消息
    const quickNoise = /^[\?\？\!\！\.\。\,\，\~\～\…]+$/i
    // 极短消息（1-3个字符且不含任务关键词）
    const quickTooShort = /^.{1,3}$/i
    if (quickGreeting.test(msg) || quickCasual.test(msg) || quickSmallTalk.test(msg) ||
        quickConversational.test(msg) || quickNoise.test(msg) || quickTooShort.test(msg)) {
      return true
    }

    // 快速路径：明确的任务关键词，直接排除
    const taskKeywords = /填写|分析|审查|总结|整理|记住|回忆|忘了|代码|文档|文件|项目|bug|优化|分类|归档|表单|表格|附件|申报书|帮我|完成|提取|填表|信息采集|待填|填入|技术栈|概览|结构|移动|重组|记忆|统计|忘了|删除|搜索|查找|读取|写入|创建|修改|删除|运行|执行|部署|测试|调试|安装|配置|搭建|搭建|重构|性能|安全|漏洞|架构|设计|实现|开发|编写|生成|导出|导入|转换|对比|合并|拆分|备份|恢复|迁移|升级|降级|监控|日志|报告|评估|建议|方案|计划|进度|状态|问题|解决|修复|改进|增强|扩展|集成|对接|联调|上线|发布|回滚|回退|版本|分支|合并|冲突|依赖|环境|配置|参数|变量|常量|函数|方法|类|接口|模块|组件|页面|路由|状态|数据|接口|API|数据库|缓存|队列|消息|通知|推送|拉取|同步|异步|并发|线程|进程|内存|CPU|磁盘|网络|带宽|延迟|吞吐|QPS|TPS|RT|SLA|SLO|SLI|指标|度量|监控|告警|巡检|压测|基准|性能|安全|漏洞|渗透|扫描|审计|合规|隐私|加密|解密|签名|认证|授权|权限|角色|用户|账户|密码|令牌|证书|密钥|会话|Cookie|Session|Token|OAuth|JWT|SSO|LDAP|SAML|2FA|MFA/i
    if (taskKeywords.test(msg)) return false

    // 用 LLM 判断是否是问候/闲聊/寒暄
    try {
      const settingsStore = useSettingsStore.getState()
      const userConfig = settingsStore.getAgentModel(this.config.id)
      const provider = userConfig?.provider || this.config.provider
      const model = userConfig?.model || this.config.model || ''

      const result = await callLLM({
        provider,
        model,
        messages: [
          { role: 'system' as const, content: `你是一个意图分类器。判断用户消息是否属于以下类别：
- 问候/打招呼（如"你好"、"在吗"、"早上好"）
- 寒暄/闲聊（如"今天怎么样"、"最近好吗"、"吃了吗"）
- 感叹/评价（如"不错"、"哈哈"）
- 无明确任务的随意对话

如果属于以上任何一类，回复 yes。
如果用户提出了具体的工作任务（如分析文件、写代码、填表格、查资料、整理文档等），回复 no。

只回复 yes 或 no，不要解释。` },
          { role: 'user' as const, content: `用户消息：${msg}` },
        ],
      })

      console.log('[Leader] isCasualConversation LLM result for:', msg, '→', result.trim())
      return result.trim().toLowerCase().startsWith('yes')
    } catch {
      console.log('[Leader] isCasualConversation LLM error for:', msg)
      return false
    }
  }

  private isGreeting(userMessage: string): boolean {
    const msg = userMessage.trim().toLowerCase()
    const greetingPatterns = [
      /^你好/, /^你好啊/, /^您好/, /^您好啊/,
      /^hi\b/, /^hello\b/, /^hey\b/,
      /^早上好/, /^上午好/, /^下午好/, /^晚上好/,
      /^在吗/, /^在不在/,
      /^嗨/, /^哈喽/,
    ]
    return greetingPatterns.some(p => p.test(msg))
  }

  private async answerCasual(userMessage: string, onToken?: (token: string) => void): Promise<string> {
    const msg = userMessage.trim()

    // 问候语：Oliver 直接回应，自然地问能帮什么
    if (this.isGreeting(userMessage)) {
      const greetingReplies = [
        '你好！有什么我可以帮你的吗？我可以帮你分析项目、审查代码、总结文档、生成架构图、研究竞品、生成内容，或者填写表单，直接告诉我就行。',
        '你好呀！今天想做什么？分析文件、审查代码、生成架构、深度研究、内容创作、文档处理，我都能安排。',
        '嗨！有什么需要我帮忙的吗？直接说你的需求，我来安排合适的 Agent 处理。',
      ]
      const reply = randomPick(greetingReplies)
      if (onToken) {
        for (const char of reply) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 30))
        }
      }
      return reply
    }

    // 疑惑/困惑类（"什么意思啊"、"搞不懂"、"不明白"）
    const confusionPatterns = /什么意思|是什么意思|啥意思|搞不懂|不明白|不知道|为啥|为什么$/i
    if (confusionPatterns.test(msg)) {
      const confusionReplies = [
        '抱歉让你困惑了！我是 Oliver，团队的调度助手。你可以用自然语言告诉我你想做什么，比如"分析这个项目"、"审查代码"、"生成架构图"、"研究竞品"、"撰写文章"，我会安排合适的 Agent 来处理。',
        '不好意思！简单来说，我可以帮你：分析文件结构、审查代码质量、生成架构图、深度研究、内容创作、文档处理、填写表单。你想做哪个？直接说就行。',
      ]
      const reply = randomPick(confusionReplies)
      if (onToken) {
        for (const char of reply) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 30))
        }
      }
      return reply
    }

    // 思考/犹豫类（"我想想"、"让我想想"、"等一下"）
    const thinkingPatterns = /我想想|让我想想|我想一下|等一下|稍等|先不急|让我想想再说|我想想再说/i
    if (thinkingPatterns.test(msg)) {
      const thinkingReplies = [
        '好的，慢慢想～有需要随时叫我。',
        '没问题，想好了直接告诉我就行。',
        '好的，我随时在这里。',
      ]
      const reply = randomPick(thinkingReplies)
      if (onToken) {
        for (const char of reply) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 30))
        }
      }
      return reply
    }

    // 纯标点/问号类（"？？？"、"！！！"）
    const purePunctuation = /^[\?\？\!\！\.\。\,\，\~\～\…]+$/i
    if (purePunctuation.test(msg)) {
      const punctuationReplies = [
        '怎么了？有什么我可以帮你的吗？',
        '我在呢，有什么需要帮忙的直接说就行。',
        '别急，慢慢说，我听着呢。',
      ]
      const reply = randomPick(punctuationReplies)
      if (onToken) {
        for (const char of reply) {
          onToken(char)
          await new Promise((r) => setTimeout(r, 30))
        }
      }
      return reply
    }

    // 其他闲聊
    const responses = [
      '好的，有需要随时叫我！',
      '没问题，随时待命！',
      '好的，有什么需要分析或整理的随时告诉我。',
      '了解，需要帮助的时候直接说就行。',
      '好的，我随时在这里。',
    ]
    const reply = randomPick(responses)
    if (onToken) {
      for (const char of reply) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 30))
      }
    }
    return reply
  }

  private async answerTeamIntroduction(onToken?: (token: string) => void): Promise<string> {
    const teamIntro = `我们团队有 11 位成员：

## 团队成员

| 名字 | 角色 | 职责 |
|------|------|------|
| **Oliver** | 智能调度助手 | 理解你的需求，自动分配给最合适的 Agent 处理 |
| **Charlotte** | 文件分析专家 | 分析文件夹结构、文件类型分布、技术栈推断 |
| **Amelia** | 文档摘要专家 | 读取文档内容，总结项目核心信息 |
| **Ethan** | 信息采集与文档填写专家 | 对话式文档填写，支持 docx/xlsx |
| **Atlas** | 系统架构设计专家 | 生成架构图、模块依赖图、数据流图 |
| **Audrey** | 深度研究专家 | 多来源调研、竞品分析、结构化报告 |
| **Avery** | 测试修复与代码审查专家 | 自动运行测试、分析失败、代码审查 |
| **Aurora** | 日常事务专家 | 新闻摘要、日常提醒、文件分类整理 |
| **Aria** | 内容生成专家 | 文章、文案、邮件、社交媒体内容生成 |
| **Arthur** | 文档与演示全能专家 | Word/PPT/Excel/PDF/HTML 多格式文档处理 |
| **Alice** | 浏览器控制专家 | AI 驱动的网页自动化与交互 |

## 多 Agent 协作场景

当你提出涉及多个方面的任务时，我会自动协调多个 Agent 一起工作：

- **"分析并整理这个文件夹"** → Charlotte 分析结构 → Aurora 执行整理
- **"审查代码并总结文档"** → Avery 审查代码 → Amelia 总结文档
- **"分析项目并生成架构图"** → Charlotte 分析 → Atlas 生成架构

你只需要用自然语言描述需求，我会自动判断并安排协作！`

    if (onToken) {
      for (const char of teamIntro) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 8))
      }
    }

    return teamIntro
  }

  // ===== 记忆调度（记住 / 回忆 / 遗忘 / 统计）=====
  private detectMemoryIntent(userMessage: string): { type: 'remember' | 'recall' | 'forget' | 'stats' | 'none'; payload: string } {
    const msg = userMessage.trim()

    // 统计
    if (/统计记忆|记忆统计|记忆数量|记忆有多少|记忆概况|记忆列表|看看记忆|展示记忆/i.test(msg)) {
      return { type: 'stats', payload: msg }
    }

    // 遗忘 / 删除记忆
    const forgetMatch = msg.match(/(忘记|遗忘|忘掉|删除记忆|删掉.*记忆|删除.*[记忆|这条])[\s:：]*(.*)/i)
    if (forgetMatch) {
      const payload = (forgetMatch[2] || msg).trim()
      return { type: 'forget', payload }
    }

    // 记住 / 保存
    const rememberMatch = msg.match(/(记住|保存|记下|写入记忆|记住这个|以后记得|别忘了|帮我记住|请记住)[\s:：]*(.*)/i)
    if (rememberMatch) {
      const payload = (rememberMatch[2] || msg).trim()
      return { type: 'remember', payload }
    }

    // 回忆 / 查询记忆（带具体内容关键词）
    const recallMatch = msg.match(/(回忆|记得吗|我记得|之前提过|上次说过|我们之前|查一下记忆|搜索记忆|找回记忆)[\s:：]*(.*)/i)
    if (recallMatch) {
      const payload = (recallMatch[2] || msg).trim()
      return { type: 'recall', payload }
    }

    return { type: 'none', payload: '' }
  }

  private async handleMemoryCommand(
    args: { memoryIntents: { type: 'remember' | 'recall' | 'forget' | 'stats'; payload: string }; folderPath: string; userMessage: string; signal?: AbortSignal; history?: { role: 'user' | 'agent'; content: string }[] },
    onToken?: (token: string) => void
  ): Promise<string> {
    if (!this.memoryStore) {
      const msg = '🛑 记忆服务尚未初始化，请稍后再试。'
      return this.streamReply(msg, onToken)
    }

    const { type, payload } = args.memoryIntents
    const projectPath = args.folderPath || undefined

    if (type === 'remember') {
      const contentToRemember = payload || args.userMessage.replace(/(记住|保存|记下|写入记忆|记住这个|以后记得|别忘了|帮我记住|请记住)[\s:：]+/i, '').trim()
      if (!contentToRemember) {
        const msg = '好的，你想记住什么内容？直接告诉我要保存的信息即可。'
        return this.streamReply(msg, onToken)
      }
      const entry = this.memoryStore.upsert({
        key: `mem:${projectPath || 'global'}:${contentToRemember.slice(0, 40)}`,
        category: projectPath ? 'project-context' : 'user-preference',
        content: contentToRemember,
        tags: [],
        projectPath,
      })
      this.pushConv(this.config.name, this.config.color, `🧠 已记住：${contentToRemember.slice(0, 60)}`, true)
      const msg = `✅ 已帮你记住：\n> ${contentToRemember}\n\n（记忆 ID: \`${entry.id}\`，需要遗忘时可告诉我）`
      return this.streamReply(msg, onToken)
    }

    if (type === 'recall') {
      const queryText = payload || args.userMessage.replace(/(回忆|记得吗|我记得|之前提过|上次说过|我们之前|查一下记忆|搜索记忆|找回记忆)[\s:：]+/i, '').trim()
      const memories = this.memoryStore.query({ text: queryText || undefined, projectPath, limit: 8 })
      if (memories.length === 0) {
        const msg = queryText ? `🔍 记忆中暂时没有与"${queryText}"相关的内容。你可以先告诉我需要长期记住的信息。` : '🔍 当前记忆中暂无记录。你可以告诉我一些需要长期记住的信息。'
        return this.streamReply(msg, onToken)
      }
      this.pushConv(this.config.name, this.config.color, `📚 回忆起 ${memories.length} 条相关记忆`, true)
      const list = memories.map((m, i) => `**${i + 1}.** [${m.category}] ${m.content}\n`).join('')
      const msg = `📚 我回忆起以下内容：\n${list}`
      return this.streamReply(msg, onToken)
    }

    if (type === 'forget') {
      const target = payload.replace(/(忘记|遗忘|忘掉|删除记忆|这条)/i, '').trim()
      if (!target) {
        const msg = '告诉我你想删除哪条记忆，例如"忘记关于数据库的那条"。'
        return this.streamReply(msg, onToken)
      }
      const candidates = this.memoryStore.query({ text: target, projectPath, limit: 20 })
      let deleted = 0
      for (const c of candidates) {
        if (this.memoryStore.delete(c.id)) deleted++
      }
      const msg = deleted > 0
        ? `🗑 已删除 ${deleted} 条与"${target}"相关的记忆。`
        : `🔍 没有找到与"${target}"相关的记忆，无法删除。`
      if (deleted > 0) this.pushConv(this.config.name, this.config.color, `🗑 已遗忘 ${deleted} 条记忆`, true)
      return this.streamReply(msg, onToken)
    }

    // stats
    const stats = this.memoryStore.getStats()
    const byCategory = Object.entries(stats.byCategory).map(([k, v]) => `- ${k}: ${v} 条`).join('\n')
    const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString('zh-CN') : '无')
    const msg = `📊 **记忆统计**\n\n- 总条数：**${stats.total}**\n- 按分类：\n${byCategory || '（无）'}\n- 最早记录：${fmt(stats.oldestEntry)}\n- 最新记录：${fmt(stats.newestEntry)}`
    this.pushConv(this.config.name, this.config.color, '📊 已为你生成记忆统计', true)
    return this.streamReply(msg, onToken)
  }

  private async streamReply(text: string, onToken?: (token: string) => void): Promise<string> {
    if (onToken) {
      for (const char of text) {
        onToken(char)
        await new Promise((r) => setTimeout(r, 10))
      }
    }
    return text
  }

  private keywordRoute(userMessage: string): string | null {
    const msg = userMessage.toLowerCase().trim()
    
    // form-filler 关键词（优先级最高）
    const formFillerKeywords = ['填写', '填表', '完成附件', '完成文档', '完成表格', '帮我完成', '帮我填', '填一下', '把这个填了', '附件一', '附件1']
    if (formFillerKeywords.some(kw => msg.includes(kw))) {
      return 'form-filler'
    }
    
    // file-analyzer 关键词
    const analyzerKeywords = ['分析', '概览', '结构', '技术栈', '文件类型', '项目情况', '看看这个项目']
    if (analyzerKeywords.some(kw => msg.includes(kw))) {
      return 'file-analyzer'
    }
    
    // qa 关键词
    const qaKeywords = ['审查', '代码质量', 'bug', '漏洞', '改进', '优化', '测试', '修复']
    if (qaKeywords.some(kw => msg.includes(kw))) {
      return 'qa'
    }
    
    // doc-summarizer 关键词
    const summarizerKeywords = ['总结', '摘要', 'readme', '项目介绍', '功能', '读取文档']
    if (summarizerKeywords.some(kw => msg.includes(kw))) {
      return 'doc-summarizer'
    }
    
    // daily 关键词
    const dailyKeywords = ['整理', '分类', '重组', '归档', '移动文件', '文件操作', '新闻', '提醒']
    if (dailyKeywords.some(kw => msg.includes(kw))) {
      return 'daily'
    }
    
    // architect 关键词
    const architectKeywords = ['架构', '设计', '系统设计', '模块', '依赖', '数据流', 'mermaid']
    if (architectKeywords.some(kw => msg.includes(kw))) {
      return 'architect'
    }
    
    // researcher 关键词
    const researcherKeywords = ['研究', '调研', '分析竞品', '对比', '搜索', '查找']
    if (researcherKeywords.some(kw => msg.includes(kw))) {
      return 'researcher'
    }
    
    // writer 关键词
    const writerKeywords = ['文章', '文案', '邮件', '写作', '生成内容', '社交媒体', '演讲稿']
    if (writerKeywords.some(kw => msg.includes(kw))) {
      return 'writer'
    }
    
    // archivist 关键词
    const archivistKeywords = ['文档', 'word', 'ppt', 'excel', 'pdf', '演示', '报告']
    if (archivistKeywords.some(kw => msg.includes(kw))) {
      return 'archivist'
    }
    
    // browser 关键词
    const browserKeywords = ['网页', '浏览器', '自动化', '网页操作', '抓取', '爬取']
    if (browserKeywords.some(kw => msg.includes(kw))) {
      return 'browser'
    }
    
    return null
  }

  private detectContinuousConversation(userMessage: string, history?: { role: 'user' | 'agent'; content: string }[]): string | null {
    if (!history || history.length === 0) return null

    const msg = userMessage.toLowerCase().trim()
    
    // 确认词列表
    const confirmWords = ['同意', '确认', '执行', '好的', '可以', '没问题', 'ok', 'yes', 'do it', 'go ahead', '开始', '就这样']
    const isConfirm = confirmWords.some(w => msg.includes(w))
    
    // 追问词列表
    const followUpWords = ['为什么', '怎么', '如何', '能', '是否', '吗', '?', '？']
    const isFollowUp = followUpWords.some(w => msg.includes(w))

    if (!isConfirm && !isFollowUp) return null

    // 查找最近 5 条 agent 消息，看是否有计划
    const recentAgentMsgs = [...history].reverse().filter(m => m.role === 'agent').slice(0, 5)
    
    for (const agentMsg of recentAgentMsgs) {
      const content = agentMsg.content.toLowerCase()
      
      // 根据内容判断是哪个 Agent
      if (content.includes('代码') || content.includes('bug') || content.includes('测试') || content.includes('审查')) {
        return 'qa' // Avery 的代码审查/测试
      }
      if (content.includes('文件类型') || content.includes('技术栈') || content.includes('项目概览') || content.includes('目录')) {
        return 'file-analyzer' // Charlotte 的分析
      }
      if (content.includes('文档') || content.includes('readme') || content.includes('功能') || content.includes('摘要')) {
        return 'doc-summarizer' // Amelia 的摘要
      }
      if (content.includes('架构') || content.includes('模块') || content.includes('依赖') || content.includes('mermaid')) {
        return 'architect' // Atlas 的架构
      }
      if (content.includes('研究') || content.includes('调研') || content.includes('竞品')) {
        return 'researcher' // Audrey 的研究
      }
      if (content.includes('整理') || content.includes('分类') || content.includes('归档')) {
        return 'daily' // Aurora 的整理
      }
      if (content.includes('文档') || content.includes('word') || content.includes('ppt') || content.includes('excel')) {
        return 'archivist' // Arthur 的文档
      }
    }

    return null
  }
}
