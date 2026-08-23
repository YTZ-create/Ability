# 能力扩展方案

> 基于 Brutalist AI Agent 桌面应用的扩展规划  
> 设计原则：不改变整体功能逻辑和 Brutalist 设计风格

---

## 一、项目现状分析

### 1.1 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Neutralino.js（轻量原生桌面框架，支持 Win/Mac/Linux） |
| 前端 | React 19 + TypeScript 5.4 |
| 构建 | Vite 5 + TailwindCSS 3 |
| 状态管理 | Zustand（6 个 Store） |
| 图标 | Lucide React |
| 测试 | Vitest（7 个测试文件，34 个用例） |

### 1.2 核心架构模式

| 模式 | 说明 |
|---|---|
| **BaseAgent** | `src/renderer/agents/base.ts` — 统一 LLM 调用、温度、最大 token |
| **PlatformAPI** | 接口 + 适配器（neutralino / electron），解耦底层 |
| **Agent 手交（Handoff）** | Agent 回复末尾输出 `handoff` 标记，路由到其他 Agent |
| **AgentTeam 编排** | `agentTeam.ts` — 调度、并发、报告合并 |
| **记忆系统** | `MemoryStore` — 500 条上限，去抖写入，多维度查询 |
| **多模型路由** | `toolHub.ts` — deepseek/qwen/doubao/gpt 四模型 |

### 1.3 现有 Agent 团队（7 人）

| 角色 | 名字 | 文件 | 功能 |
|---|---|---|---|
| 团队领导 | Oliver | `agents/leader.ts` | 理解需求→分配任务→合并报告（3 次调度） |
| 文件分析 | Charlotte | `agents/fileAnalyzer.ts` | 文件夹结构、技术栈推断 |
| 代码审查 | William | `agents/codeReviewer.ts` | 审查代码质量、发现问题和改进建议 |
| 文档摘要 | Amelia | `agents/docSummarizer.ts` | 项目文档总结 |
| 文件整理 | James | `agents/fileOrganizer.ts` | 根据建议重新分类与整理文件 |
| 信息采集 | Ethan | `agents/formFiller.ts` | 对话式文档填写，支持 docx/xlsx，含书签/窗体/COM/XML 多引擎 |
| 记忆管理 | Sophie | `agents/memoryAgent.ts` | 跨会话记忆：记住/回忆/遗忘/统计 |

> **记忆功能说明**：Sophie Agent 和 `MemoryStore`（`src/renderer/memory/`）均已保留，记忆面板组件正常可用。所有 Agent 通过 Oliver 统一调度记忆读写。

### 1.4 扩展后完整 Agent 团队（11 人）

| # | 名字 | ID | 能力域 | 说明 |
|---|---|---|---|---|
| 1 | **Oliver** | `leader` | 团队领导 | 理解需求→分配任务→合并报告（已有） |
| 2 | **Charlotte** | `file-analyzer` | 文件分析 | 文件夹结构、技术栈推断（已有） |
| 3 | **Amelia** | `doc-summarizer` | 文档摘要 | 项目文档总结（PDF 能力将由 pdf-inspector 增强） |
| 4 | **Ethan** | `form-filler` | 信息采集 | 对话式文档填写，多引擎（已有） |
| 5 | **Atlas** | `architect` | 架构设计 | 用 mermaid 生成架构图、模块依赖图；集成 diagram-design Skill 生成编辑级 HTML/SVG 图表 |
| 6 | **Audrey** | `researcher` | 深度研究 | 多来源调研、竞品分析、结构化报告 |
| 7 | **Avery** | `qa` | 测试修复 + 代码审查 | 自动运行测试、分析失败用例并修复；集成 open-code-review CLI 实现行级精度的 AI 代码审查（接替 William 代码审查能力） |
| 8 | **Aurora** | `daily` | 日常事务 | 新闻摘要、日常提醒、文件操作（接替 James 文件整理能力） |
| 9 | **Aria** | `writer` | 内容生成 | 文章/文案/邮件/社交媒体内容生成 |
| 10 | **Arthur** | `archivist` | 文档与演示 | Word/PPT/Excel/PDF/HTML 报告，多格式文档全能 |
| 11 | **Alice** | `browser` | 浏览器控制 | AI 驱动的网页自动化与交互 |

> **记忆系统**：`MemoryStore`（`src/renderer/memory/`）作为基础设施保留，所有 Agent 通过 Oliver 统一调度记忆读写，不再需要独立记忆 Agent。

### 1.5 diagram-design Skill 集成可行性评估

**项目信息**：[cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)（MIT 协议，v2.4）

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ 可行 | MIT 协议，可自由集成 |
| **技术协议** | ✅ 可行 | 纯 HTML + SVG + CSS 输出，无后端依赖，Neutralino JS 环境直接运行 |
| **输出格式** | ✅ 可行 | 27 种视觉类型，输出 standalone HTML（无需构建步骤、无 JS、无外部图片依赖） |
| **品牌适配** | ✅ 可行 | 内置 style-guide 可自定义 token，支持从项目 Brutalist 设计系统提取 `paper=#FFFAEF`、`ink=#1A1A1A`、`accent=#FFC857` |
| **与现有 Mermaid 关系** | ✅ 互补非替代 | Atlas 当前已用 Mermaid 输出语法，集成后升级为编辑级 standalone HTML；Mermaid 仍可作为输入源（`/import-mermaid`） |
| **Skill 加载方式** | ✅ 可行 | 纯 Markdown 指令 + 参考文件，无需 CLI 插件系统，直接嵌入项目 |
| **体积** | ⚠️ 需注意 | Skill 目录约 37KB（SKILL.md + references/），可接受 |

**集成路径**：

```
src/renderer/
├── skills/
│   └── diagram-design/                 # 嵌入 diagram-design Skill 完整目录
│       ├── SKILL.md                    # 主指令（Atlas 运行时读取）
│       └── references/                 # 27 种类型参考文件
│           ├── style-guide.md          # 品牌 token（已改为 Brutalist 配色）
│           ├── type-architecture.md    # 架构类型
│           ├── type-flowchart.md       # 流程图
│           ├── type-sequence.md        # 时序图
│           ├── type-state.md           # 状态机
│           ├── type-er.md              # ER 图
│           └── ...                     # 其他 21 种类型
└── components/
    └── diagram/
        └── DiagramDesigner.tsx         # 嵌入/渲染 diagram-design HTML 输出
```

**Atlas Agent 升级方案**：

| 阶段 | 输入 | 处理 | 输出 |
|---|---|---|---|
| **Phase 1（当前）** | 自然语言 | LLM 生成 Mermaid 语法 | Mermaid markdown，由 ChatView 渲染 |
| **Phase 2（集成后）** | 自然语言 | LLM 读取 SKILL.md → 选择视觉类型 → 加载 `references/type-*.md` → 生成 standalone HTML | standalone HTML，由 `DiagramDesigner.tsx` 内嵌渲染 |

**Phase 2 执行流程**：
1. 用户请求图表 → Oliver 路由到 Atlas
2. Atlas `execute()` 读取 `skills/diagram-design/SKILL.md` 和对应 `references/type-*.md`
3. LLM 按 style-guide 和 type 规范生成 standalone HTML
4. 输出写入 `PlatformAPI.fs.writeFile()` 保存为 `.html` 文件
5. ChatView 中内嵌 `<iframe>` 或 `DiagramDesigner` 组件渲染

### 1.6 Prime Agent 可行性评估

**项目信息**：[PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent)（MIT 协议，v0.7.4）

**核心定位**：Prime Agent 是基于 **RLM（Recursive Language Model）** 编程模型的 CLI 编码/研究 Agent，运行在持久 IPython 内核上，支持原生子 Agent（`rlm(...)`）、Continual Harness（可迭代改进的持久状态）、守护进程后台运行、Agent 间直接通信。

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ MIT 协议 | 可自由使用 |
| **技术栈兼容性** | ❌ **不兼容** | Prime Agent 是 Python + TypeScript 混合体，核心执行依赖 IPython 内核（`ipykernel`），而本项目为纯 JS/TS（Neutralino + React），**无法直接共享执行环境** |
| **架构兼容性** | ❌ **不兼容** | Prime Agent 是 CLI 工具（`prime-agent` 命令行启动），通过守护进程（`prime-agent daemon`）管理后台 session；本项目是 Neutralino 桌面 GUI 应用，架构完全不同 |
| **运行模型冲突** | ❌ **不兼容** | Prime Agent 的 RLM 模型要求 LLM 输出 Python 代码在 IPython 中执行；本项目 Agent 直接调用 `PlatformAPI`（JS 层），二者执行模型冲突 |
| **直接嵌入可行性** | ❌ **不可行** | 嵌入整个 Prime Agent 需引入 IPython kernel（~200MB+）、Python 运行时、守护进程管理，完全违背 Neutralino 轻量设计原则（~10MB） |

**结论：不建议直接集成 Prime Agent 整体框架，但可借鉴以下架构思想**：

| Prime Agent 概念 | 借鉴方向 | 对应本项目的 Agent/模块 | 借鉴方式 |
|---|---|---|---|
| **RLM 子 Agent 调用**（`rlm(...)` 原生 spawn 子 Agent） | 强化 Oliver 的 Agent 编排能力 | Oliver（`leader.ts`） | 在 Oliver 的 `execute()` 中增加"动态 spawn 子 Agent"机制，类似 `rlm()` 语义，支持并行/串行委派、结果汇总 |
| **Continual Harness**（可迭代改进的持久状态） | 增强 MemoryStore 的语义 | `memory/memoryStore.ts` | 在 MemoryStore 基础上增加"经验沉淀"能力：Agent 执行完成后自动将关键判断写入 `memoryStore` 作为下次执行的 context |
| **Agent 间直接通信**（`agent_message.send`） | 实现 Agent 间消息通道 | Oliver + 所有 Agent | 在 `agentTeam.ts` 中增加消息队列机制，Agent 完成/失败时主动通知关联 Agent |
| **守护进程后台运行**（`prime-agent daemon`） | 支持长时间任务 | Aurora（日常事务） | 利用 Neutralino `shellExec` 启动后台 Worker（Node.js 子进程），处理耗时任务后回传结果 |
| **Python-backed Skills**（可执行 Python 包的 Skill 系统） | 扩展 Skill 加载机制 | `skills/` 目录 | 在 `diagram-design` Skill 基础上，增加 Skill 注册机制：每个 Skill 可声明 `exec.js` 作为可执行入口，Agent 运行时动态 `require()` |
| **持久目标**（`/goal` 跨轮次追踪） | 长期任务追踪 | Aurora + MemoryStore | 在 MemoryStore 中增加 `goal` category，Agent 每次执行后自动更新进度 |

### 1.7 Macro（macro-inc/macro）可行性评估

**项目信息**：[macro-inc/macro](https://github.com/macro-inc/macro)（**AGPL-3.0** 协议，v1.x，5,013 commits）

**核心定位**：Macro 是一个**创业公司操作系统（Operating System for Startups）**，用 SolidJS + Rust 构建，将 **Email + 消息 + 文档 + 任务 + Canvas + CRM + Agent + 通话 + 文件存储 + PR** 统一在同一个双向图（bidirectional graph）中。产品已投入实际使用约 2 年，有 iOS App，~15 人团队 dogfood。

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ⚠️ **高风险** | AGPL-3.0，**任何分发或网络服务使用均要求开源自己的修改**，与本项目闭源商业产品方向冲突 |
| **产品定位冲突** | ❌ **不兼容** | Macro 本身就是完整的"操作系统"（替代 Slack + Linear + Notion + HubSpot + Superhuman），不是库或组件，而是**直接竞争产品** |
| **技术栈冲突** | ❌ **不兼容** | Macro 使用 **Rust 后端（crates/）+ SolidJS 前端 + Bun + Tauri 桌面**，本项目为 **JS/TS + React + Neutralino**，二者技术栈完全不同 |
| **后端架构冲突** | ❌ **不兼容** | Macro 依赖 Rust 后端（Kafka 消息队列、Postgres + SQLx、Durable Objects CRDT 协作、Docker 编排），本项目纯前端（Neutralino 单进程） |
| **代码量** | ❌ **不可行** | 5,013 commits、多 crates、多 services、完整 CI/CD，不可能嵌入 |
| **直接嵌入可行性** | ❌ **完全不可行** | Macro 是独立产品，需要部署完整 Rust 后端 + 数据库 + Kafka，与 Neutralino 轻量架构彻底冲突 |

**结论：Macro 不可集成，但以下设计理念和组件层面实现模式值得借鉴**：

| Macro 设计/特性 | 借鉴方向 | 对应本项目的 Agent/模块 | 具体借鉴方式 |
|---|---|---|---|
| **双向图存储**（bidirectional graph） | 跨对象关联引用系统 | MemoryStore + MemoryViewer | 在 `MemoryStore.upsert()` 中增加 `backlinks` 字段：每条记忆记录引用了哪些对象（邮件/任务/文档），查询时可反向追溯"提到这个联系人的所有记录" |
| **@link 全局引用** | Agent 间上下文传递 | Oliver 编排系统 | 在 Oliver 的 handoff 消息中引入 `@link` 语义：`@email:re-contract.eml` 或 `@task:fix-login`，被调度的 Agent 可自动加载关联上下文 |
| **统一搜索工具** | 跨数据源搜索 | Arthur（文档与演示） | Arthur 新增 `unifiedSearch()` 方法，同时搜索邮件附件 PDF、聊天记录、文档内容，统一输出结果 |
| **Agent 原生编辑 CRDT 文档**（Wolf's Agents Attack The Document） | 多 Agent 协作编辑 | Athena（深度研究） | Athena 执行研究时可"写入文档"，实现 Agent ↔ 文档 ↔ Agent 的闭环（类似 Macro 的 agent-native editing） |
| **轻量任务系统**（与聊天深度绑定） | 任务面板升级 | Aurora + Aurora 任务面板 | 任务创建时可 `@link` 到关联消息/邮件/Agent，形成"为什么做"→ 任务 → Agent → PR 的审计链 |
| **邮件多账户统一管理** | 邮件 Agent 基础 | （新增或 Arthur 扩展） | 若后续增加邮件能力，参考 Macro 的多账户统一收件箱设计：`unifiedInbox` + `tagging` + `sharing` 三层模型 |
| **块（Blocks）架构**（模块化、可组合） | 项目架构设计哲学 | 全部模块 | 所有 Agent/服务/组件设计遵循"乐高"原则：每个模块独立可用，可跨模块 `@link` 引用，避免紧耦合 |
| **CRM 对象模型**（Company + Contact + Email 聚合） | 联系人/客户数据模型 | Aurora（日常事务） | 若后续扩展 CRM 能力，参考 Macro 的对象模型：`Company`（邮箱域名聚合）、`Contact`（多邮箱+消息历史）、`Deal`（CRM 记录） |

### 1.8 pdf-inspector（firecrawl/pdf-inspector）集成可行性评估

**项目信息**：[firecrawl/pdf-inspector](https://github.com/firecrawl/pdf-inspector)（**MIT** 协议，v1.15.0，481 commits）

**核心定位**：基于 Rust 的 PDF 分类与文本提取引擎，提供 **Node.js NAPI 绑定**（`@firecrawl/pdf-inspector`）、Python 绑定和浏览器 WASM 绑定。支持智能 PDF 类型检测（TextBased/Scanned/ImageBased/Mixed）、位置感知文本提取、Markdown 转换（含标题/列表/表格/代码块自动识别）、选择性 OCR 路由。

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ **完全可行** | MIT 协议，无任何限制 |
| **技术栈兼容性** | ✅ **完美兼容** | Rust 核心 + NAPI Node.js 绑定，通过 `npm install @firecrawl/pdf-inspector` 直接安装，TS/JS 原生调用 |
| **输出格式** | ✅ **完美兼容** | 输出 Markdown（含表格/标题/列表结构），可直接接入 Amelia/Arthur 的 LLM 处理流程 |
| **性能** | ✅ **显著提升** | 200 页 PDF 中位数 470ms 处理完毕，同类对比中综合评分 0.875 最高（liteparse 0.873 / pymupdf4llm 0.735） |
| **中性环境支持** | ✅ **可行** | NAPI 绑定在 Windows/Mac/Linux 均有预编译包，Neutralino 进程可直接调用 |
| **体积** | ✅ **可接受** | npm 包约 5-10MB（含原生 Rust 二进制），在 Neutralino 可接受范围内 |

**结论：强烈推荐集成，可直接替换当前 PDF 处理能力**：

**当前 PDF 处理现状**（需替换）：

| 位置 | 当前方法 | 问题 |
|---|---|---|
| Amelia（`docSummarizer.ts`）| `readPDFText()` 函数 | 方法基础，无结构化解析，无表格/列表识别 |
| Arthur（规划中） | 未实现 PDF 处理 | 需从头构建 |
| 项目依赖 | `@anthropic-ai/vertex-sdk` | 无 PDF 专用库 |

**集成方案**：

| 步骤 | 操作 | 结果 |
|---|---|---|
| 1 | `npm install @firecrawl/pdf-inspector` | 项目新增依赖 |
| 2 | `src/renderer/services/pdf.ts` | 封装 pdf-inspector API，暴露 `classifyPdf()` / `extractPdfMarkdown()` / `extractPdfWithOcr()` |
| 3 | 修改 `src/renderer/agents/docSummarizer.ts` | `readPDFText()` 替换为调用 `pdf-service`，获得结构化 Markdown |
| 4 | 修改 `src/renderer/agents/arthur.ts`（规划中） | Arthur 直接调用 `pdf-service` 作为 PDF 处理引擎 |
| 5 | MemoryStore 支持 | 提取的 Markdown 附带元数据（`pdfType` / `pagesRoutedToOcr` / `confidence`），存入 MemoryStore |

**架构代码示例**：

```
src/renderer/
├── services/
│   └── pdf.ts               # pdf-inspector 封装层
│       ├── classifyPdf(buffer)        → { pdfType, confidence, pagesNeedingOcr }
│       ├── extractPdfMarkdown(buffer) → { markdown, pdfType, confidence }
│       └── extractPdfWithOcr(buffer)  → { markdown, pagesRoutedToOcr, warnings }
├── agents/
│   ├── docSummarizer.ts      # Amelia 使用 pdf-service.extractPdfMarkdown()
│   └── arthur.ts             # Arthur 使用 pdf-service（含 OCR 路由）
```

**能力提升对比**：

| 能力 | 当前（Amelia） | 集成 pdf-inspector 后 |
|---|---|---|
| PDF 类型分类 | ❌ 无 | ✅ TextBased/Scanned/ImageBased/Mixed + 置信度 |
| 文本提取 | ⚠️ 基础 `readPDFText()` | ✅ 位置感知 + 多列检测 + 阅读顺序 + RTL 支持 |
| 表格解析 | ❌ 无 | ✅ 矩形检测 + 启发式检测 + Markdown 表格输出 |
| 标题/列表识别 | ❌ 无 | ✅ H1-H4 字体大小识别 + bullet/numbered/letter 列表 |
| 代码块识别 | ❌ 无 | ✅ 等宽字体检测 + 关键字检测 |
| OCR 路由 | ❌ 无 | ✅ 按需 OCR（仅对无文本页），节省 90%+ 时间 |
| 表格/法律/财务 PDF | ⚠️ 输出乱序 | ✅ 0.814 表格 TEDS 评分（同类最高） |

### 1.9 reverse-skill（zhaoxuya520/reverse-skill）架构借鉴评估

**项目信息**：[zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill)（**MIT** 协议，v1.0.1，108 commits，2 个 PR 合并）

**核心定位**：逆向工程技能路由包——AI Agent 遇到 APK/二进制/JS/CTF/渗透测试目标时，通过 `routing.json`（41 条规则 R0–R40）路由到正确的技能模块，检查本机工具链，执行可重复的工作流。包含 **42 个子技能模块**（APK 逆向 / IDA Pro / Frida / radare2 / JS 逆向 / CTF / 固件渗透 / 攻击链 / 渗透工具等），支持 163 条回归测试用例，Windows + Ubuntu 双平台 CI。

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ **可借鉴** | 主包 MIT 协议；CTF-Sandbox-Orchestrator 为 GPLv3（不采用）；Pentest Swarm 为 AGPL-3.0（仅 CLI 调用，不嵌入源码） |
| **内容相关性** | ❌ **不可用** | 全部内容围绕**逆向工程 + 渗透测试 + CTF 竞赛**，与本项目（通用 AI 助手）目标不符 |
| **架构相关性** | ✅ **高度可借鉴** | 路由框架（`routing.json` + `MASTER-ROUTING.md`）+ 技能模块结构（SKILL.md + references + scripts）+ 工具索引（tool-index）+ 自举机制（bootstrap）+ 经验回写（field-journal） |
| **技术栈兼容性** | ⚠️ **需改写** | 脚本为 PowerShell（`master-route.ps1` / `case-init.ps1` / `bootstrap-reverse.ps1`），本项目为 JS/TS，需将 PowerShell 逻辑改写为 JS |
| **子技能复用** | ❌ **不可复用** | 所有子技能（`apk-reverse/`、`ida-reverse/`、`pentest-tools/` 等）均为安全领域，与本项目无关 |

**结论：整体内容不可用，但 5 个架构组件可提取并融入到本项目**：

| reverse-skill 架构组件 | 借鉴方向 | 对应本项目的模块 | 具体借鉴方式 |
|---|---|---|---|
| **routing.json 结构化路由**（41 条规则 R0–R40，按目标类型+用户意图+工具链三轴匹配） | Agent 路由决策引擎 | Oliver（`leader.ts`） | 将 Oliver 当前的"直觉式 handoff"改为 `routing.json` 结构化路由：`[{trigger:"code", priority:1, target:"atlas", preconditions:[...]}]`，决策可审查、可测试、可回归 |
| **MASTER-ROUTING 快速阶梯**（先匹配已知模式，未命中再深度分析） | 路由性能优化 | Oliver + `codeRouter.ts` | 将当前的 `findCodeFiles()` / `routeToBestAgent()` 重构为快速阶梯：1) 精确匹配 → 2) 模糊匹配 → 3) LLM 兜底 |
| **tool-index 自动工具发现**（`refresh-tool-index.ps1` 扫描本机工具） | 插件/工具自动发现 | `toolHub.ts` + `PluginPanel.tsx` | 每次启动自动扫描本地安装的 CLI 工具（`npm list -g` / `where.exe` / `which`），动态生成工具索引，Agent 可据此判断工具可用性 |
| **bootstrap 自举机制**（`bootstrap-reverse.ps1` 自动安装缺失工具） | 插件按需安装 | `PluginPanel.tsx` + `services/pluginRegistry.ts` | 当 Agent 检测到缺失工具时，自动触发 `npm install` / `winget install` 安装，然后刷新 tool-index |
| **field-journal 经验回写**（完成任务后将经验写入 `field-journal/` 目录） | 经验沉淀 | MemoryStore + Oliver | 每次 Oliver 成功调度后，自动将"问题类型 → 最佳 Agent"的映射写入 MemoryStore，下次同类问题直接命中，减少 LLM 推理成本 |

**集成方案**：

| 步骤 | 操作 | 对应本项目的文件 |
|---|---|---|
| 1 | `skills/config/routing.json` — 结构化路由规则 | 新增，Oliver 使用 |
| 2 | `src/renderer/services/toolRegistry.ts` — 工具索引（JS 版 tool-index） | 新增，替代 `refresh-tool-index.ps1` |
| 3 | 修改 `src/renderer/agents/codeRouter.ts` — 加入快速阶梯路由 | 改写 |
| 4 | `PluginPanel.tsx` — 加入工具自动发现和一键安装 | 扩展 |
| 5 | `memory/memoryStore.ts` — 增加 `routing_precedent` category | 扩展 |

### 1.10 TencentDB Agent Memory（TencentCloud/TencentDB-Agent-Memory）架构借鉴评估

**项目信息**：[TencentCloud/TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)（**MIT** 协议，v2.0.1-beta.2，17 commits 主分支，463 PRs）

**核心定位**：AI Agent 团队的**记忆基础设施平台**，由腾讯开源。核心理念：Agent 团队的"经验资产"（记忆/技能/知识图谱）应沉淀、流转、跨 Agent 继承，而非每次重新学习。包含 4 大记忆资产类型：Chat Memory（L0→L1→L2→L3 记忆蒸馏）、Skill Library（可复用的技能包）、Wiki（文档→结构化页面+链接图）、CodeGraph（代码符号+调用关系+影响分析），支持多 Agent 框架（Claude Code / Codex / CodeBuddy / WorkBuddy / Hermes / OpenClaw / DeepSeek Harness）通过统一 Proxy 接入。

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ **完全可行** | MIT 协议，无任何限制 |
| **业务相关性** | ✅ **高度相关** | 专门解决"多 Agent 团队记忆管理"问题，与本项目的 Agent 编排架构高度契合 |
| **技术栈兼容性** | ⚠️ **需重构** | 后端为 **Go**（`memory-core`），前端为 **React**（`MemoryPanel`），部署依赖 Docker + PostgreSQL + Redis + Milvus 向量数据库；本项目为 Neutralino + Zustand + 本地 JSON 存储，架构完全不同 |
| **可直接嵌入** | ❌ **不可行** | 需要部署 Go 后端 + 向量数据库 + Redis，与本项目的轻量桌面端定位冲突 |
| **概念可借鉴度** | ✅ **极高** | 记忆资产模型（4 类）、L0-L3 蒸馏层级、Skill 版本管理、Wiki 链接图、CodeGraph 影响分析、ACL 权限体系、多 Agent 共享记忆——全部可借鉴 |

**结论：整体平台不可嵌入，但 8 个核心概念可深度融入到本项目**：

| TencentDB 概念 | 借鉴方向 | 对应本项目的模块 | 具体借鉴方式 |
|---|---|---|---|
| **L0→L1→L2→L3 记忆蒸馏**（会话→原子→场景→人设） | MemoryStore 升级 | `memory/memoryStore.ts` | 当前 MemoryStore 为扁平结构（每条记忆平铺）；改为 4 层蒸馏：L0（原始对话）→ L1（原子事实/决策/偏好）→ L2（场景级经验/工作流）→ L3（人设级模式/Agent 行为偏好），Oliver 调度时按层级检索 |
| **Wiki 文档链接图**（文档→结构化页面+双向链接） | 文档知识图谱 | Aurora（文档与演示） | 文档处理时自动提取页面间的 `[[双向链接]]`，生成文档关系图；用户可视觉浏览"哪些文档互相引用" |
| **CodeGraph 代码影响分析**（符号→调用关系→影响范围） | 代码理解增强 | Atlas（写代码/改代码） | 代码分析时自动生成调用图：修改函数 X → 哪些函数受影响 → 哪些测试需要更新；输出为 Mermaid graph |
| **Skill 版本管理**（版本+资源文件+触发边界+执行步骤+验证规则） | Skill 系统升级 | `skills/` 目录 | 当前 `skills/diagram-design` 为无版本 Markdown；升级为结构化 Skill：`skill.json` 包含 `version` / `trigger` / `steps` / `validation` / `dependencies`，支持多版本并存和回滚 |
| **ACL 权限模型**（private / team / restricted） | 记忆权限控制 | MemoryStore + `MemoryViewer` | 记忆新增 `visibility` 字段：`private`（仅创建者）/ `shared`（团队可见）/ `restricted`（指定 Agent 可访问）；不同 Agent 可见不同记忆范围 |
| **多 Agent 共享记忆 Proxy**（统一协议、零代码接入） | Agent 记忆共享 | `agentTeam.ts` + MemoryStore | 所有 Agent 通过统一的 MemoryStore 读写记忆，而非各自维护；新增"记忆绑定"机制：指定 Agent 可访问的记忆范围，类似"装备"（loadout） |
| **记忆面板 = 控制台**（创建团队/Agent、资产管理、Agent 装备、访问控制） | MemoryViewer 扩展 | `components/memory/MemoryViewer.tsx` | 从当前"查看+搜索"面板升级为"控制台"：增加 Agent 装备配置（哪些记忆给哪个 Agent）、Skill 库浏览、Wiki 图谱浏览、权限管理四个新 Tab |
| **冷启动 = 加载存档**（导入已有文档/代码/会话→自动提取记忆） | 项目导入 | `folderStore.ts` + Aurora | 扫描新加入文件夹时，自动触发记忆初始化：文档→Wiki、代码→CodeGraph、历史会话→Chat Memory 蒸馏，无需用户手动配置 |

**架构图对比**：

```
TencentDB Agent Memory（服务器部署）           本项目（Neutralino 桌面端）
                                              
┌─────────────────────────────┐              ┌─────────────────────────────┐
│  MemoryPanel (React UI)     │              │  MemoryViewer (扩展控制台)   │
├─────────────────────────────┤              ├─────────────────────────────┤
│  MemoryProxy (Go 服务)      │              │  MemoryStore (系统级基础设施)│
├─────────────────────────────┤              ├─────────────────────────────┤
│  MemoryCore (Go 核心)       │              │  无 Go 后端（本地 JSON 存储）│
│  ├─ Chat Memory (L0-L3)    │  ──借鉴──→   │  ├─ Chat Memory (L0-L3)     │
│  ├─ Skill Library          │              │  ├─ Skill Registry (结构化) │
│  ├─ Wiki (文档链接图)       │              │  ├─ Wiki (文档链接图)        │
│  ├─ CodeGraph (调用关系)   │              │  ├─ CodeGraph (调用关系)     │
├─────────────────────────────┤              ├─────────────────────────────┤
│  Postgres + Redis + Milvus  │              │  本地文件存储（无需数据库）   │
└─────────────────────────────┘              └─────────────────────────────┘
```

**集成方案（分阶段）**：

| 阶段 | 操作 | 对应本项目的文件 | 难度 |
|---|---|---|---|
| Phase 1 | MemoryStore 升级为 L0-L3 层级结构 | `memory/types.ts` + `memory/memoryStore.ts` | 中 |
| Phase 2 | Skill 系统升级为结构化版本管理 | `skills/` 目录 + 新增 `skill.json` schema | 中 |
| Phase 3 | MemoryViewer 扩展为控制台（4 个新 Tab） | `components/memory/MemoryViewer.tsx` | 高 |
| Phase 4 | CodeGraph 代码影响分析 | Atlas Agent + 新增 `services/codeGraph.ts` | 高 |
| Phase 5 | ACL 权限模型 | MemoryStore + MemoryViewer | 中 |

### 1.11 Open Code Review（alibaba/open-code-review）集成评估

**项目信息**：[alibaba/open-code-review](https://github.com/alibaba/open-code-review)（**Apache-2.0** 协议，486 commits，116 tags，OpenSSF Gold 认证）

**核心定位**：阿里巴巴开源的 AI 驱动代码审查 CLI 工具，源自阿里集团内部 AI 代码审查助手，过去两年服务数万开发者、识别数百万代码缺陷。读取 Git diff → 通过带工具调用能力的 Agent 将变更文件送至 LLM → 生成行级精度的结构化审查意见。核心理念：「**确定性工程 × Agent 混合驱动**」——对"不能出错"的环节由工程逻辑保证（精准文件筛选、智能文件打包、精细化规则匹配），动态决策由 Agent 负责（场景化提示词、场景化工具集）。

**基准数据**：相比通用 Agent（Claude Code），同模型下 F1 更高、Precision 更高、仅消耗 **~1/9 的 token**、审查更快。基于 50 个开源仓库 × 200 个真实 PR × 10 种语言的 AACR-Bench 验证（1,505 个标注缺陷，80+ 资深工程师交叉标注）。

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ **完全可行** | Apache-2.0，可商用，无 copyleft 限制 |
| **业务相关性** | ✅ **直接相关** | 核心功能（AI 代码审查）正是 Avery Agent 的主要职责；可直接增强 Avery 的代码审查能力 |
| **技术栈兼容性** | ⚠️ **需桥接** | OCR 为 **Go 后端** CLI（`ocr` 命令），通过 npm 包 `@alibaba-group/open-code-review` 安装；本项目为 TS + Neutralino，但可通过 `child_process.execFile` 调用 OCR CLI，架构天然兼容 |
| **可直接集成** | ✅ **可行** | `npm install @alibaba-group/open-code-review` 安装后，Avery 调用 `ocr review` / `ocr scan` 即可获得行级代码审查；同时支持 Delegate 模式（OCR 负责文件选择+规则解析，我们的 LLM 执行审查） |
| **概念可借鉴度** | ✅ **极高** | 确定性工程 × Agent 混合驱动架构、精准文件筛选、智能文件打包（分治策略）、精细化规则匹配、外挂定位与反思模块、场景化提示词调优——全部可借鉴 |

**结论：✅ 强烈推荐直接集成到 Avery Agent，P0 优先级**

**与 Avery 的集成方式对比**：

| 集成方式 | 方式 | 优点 | 缺点 | 推荐场景 |
|---|---|---|---|---|
| **方式 A：CLI 桥接** | `execFile('ocr', ['review', ...])` 调用 OCR CLI | 最小改动量（仅需配置 `ocr` + 传参），获得行级精度的审查结果 | 需本机安装 OCR（npm global install），每次审查启动一个新进程 | 快速验证 / MVP 阶段 |
| **方式 B：Delegate 模式** | OCR 负责文件筛选+规则解析，输出审查模板，Avery 的 LLM 按模板执行审查 | 利用 OCR 的确定性工程优势，同时使用我们已有的 LLM 通道和 Prompt 体系 | 需解析 OCR 的中间输出格式，集成复杂度中等 | 平衡方案，推荐生产环境使用 |
| **方式 C：概念移植** | 将 OCR 的 6 大核心能力（文件筛选/打包/规则匹配/定位/反思/提示词）移植为本项目 TypeScript 代码 | 完全自有实现，零外部依赖 | 实现工作量大，失去 OCR 持续演进的红利 | 长期维护 / 高度定制需求 |

**6 大核心能力借鉴矩阵**：

| OCR 核心能力 | 实现机制 | 对 Avery 的增强点 | 借鉴方式 |
|---|---|---|---|
| **精准文件筛选** | 基于 git diff + 文件类型 + 变更量自动筛选需审查的文件，过滤无关文件 | 当前 Avery 审查时可能"偷懒"漏审文件；引入文件筛选后保证每个真正重要的改动都被覆盖 | CLI 桥接（方式 A）即可获得 |
| **智能文件打包（分治）** | 将关联文件归并为同一审查单元（如 `message_en.properties` + `message_zh.properties`），每个包作为独立 sub-agent，上下文隔离，天然支持并发 | 大变更场景下提高审查稳定性；支持并行审查多个文件包，减少单次 LLM 上下文压力 | 方式 B（Delegate）或概念移植（方式 C） |
| **精细化规则匹配** | 基于文件特征（语言/路径/变更类型）匹配对应的审查规则，减少信息噪声 | Avery 的代码审查 prompt 可引入规则模板引擎，提升审查一致性和可预期性 | 概念移植：在 `agents/codeReviewer.ts` 中实现规则匹配逻辑 |
| **外挂定位模块** | 独立的行号定位组件，确保审查意见指向正确的代码位置 | 解决当前可能出现的"位置漂移"问题——审查意见的行号与实际代码位置不匹配 | CLI 桥接即可获得 |
| **外挂反思模块** | 独立的审查质量反思组件，系统性地提升反馈的准确性和有用性 | 审查完成后自动进行"自反思"：是否有误报、是否遗漏、建议是否合理 | CLI 桥接即可获得 |
| **场景化提示词调优** | 针对代码审查场景深度优化的 prompt 模板，效果优于通用 prompt | Avery 的 systemPrompt 可参考 OCR 的审查 prompt 结构进行优化 | 概念移植：对比 OCR prompt 后优化 Avery systemPrompt |

**集成架构（方式 B：Delegate 模式推荐）**：

```
用户发起代码审查
        │
        ▼
┌─────────────────────┐
│   Avery Agent       │
│  (BaseAgent)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐      ┌─────────────────────┐
│  OCR CLI 桥接层     │      │  OCR 规则引擎       │
│  services/ocr.ts    │      │  review-rules.yaml  │
├─────────────────────┤      ├─────────────────────┤
│  1. execFile('ocr',  │      │  1. 精准文件筛选    │
│     ['delegate',      │───→ │  2. 智能文件打包    │
│      'rule', ...])    │      │  3. 精细化规则匹配  │
│  2. 解析输出         │      │  4. 行号定位        │
│  3. 构建审查任务包   │      │  5. 审查模板        │
└──────────┬──────────┘      └─────────────────────┘
           │
           ▼
┌─────────────────────┐
│  Avery LLM 审查      │
│  (按 OCR 模板执行)   │
├─────────────────────┤
│  1. 读取文件内容     │
│  2. 按规则审查       │
│  3. 生成行级意见     │
│  4. 反思模块自检     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  审查结果（结构化）   │
│  severity / line /   │
│  file / message /    │
│  suggestion          │
└─────────────────────┘
```

**集成方案（3 步）**：

| 步骤 | 操作 | 对应本项目的文件 | 工作量 |
|---|---|---|---|
| Step 1 | npm 安装 `@alibaba-group/open-code-review`（全局或项目本地） | `package.json` 新增 devDependency | 5 分钟 |
| Step 2 | 新增 OCR CLI 桥接服务，封装 `ocr review` / `ocr scan` / `ocr delegate` | `services/ocr.ts`（新增） | 中 |
| Step 3 | Avery Agent 的代码审查方法改为调用 OCR 桥接层（Delegate 模式） | `agents/codeReviewer.ts` 扩展 | 中 |

### 1.12 Agent Reach（Panniantong/Agent-Reach）集成评估

**项目信息**：[Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)（**MIT** 协议，372 commits，Python 实现，持续活跃开发）

**核心定位**：AI Agent 的「**互联网能力层**」——为 Agent 一键装上网页阅读、社交媒体搜索、视频字幕提取、全网语义搜索等能力。核心理念：「**能力层（capability layer）**」，负责选型、安装、体检、路由，不负责底层读取本身；每个平台采用「首选 + 备选」的有序后端路由，某条路失效自动切换到备选，用户无感。

**支持平台矩阵（15+ 平台）**：

| 平台类别 | 支持平台 | 零配置可用 | 需配置 |
|---|---|---|---|
| **网页** | Jina Reader | ✅ 无需配置 | — |
| **视频** | YouTube（字幕）、B站（搜索+详情） | ✅ 无需配置 | 字幕需 OpenCLI |
| **社交媒体** | Twitter/X、Reddit、Facebook、Instagram、小红书 | ❌ 需配置 | OpenCLI（桌面）/ Cookie |
| **搜索** | 全网语义搜索（Exa） | ✅ MCP 免 Key | — |
| **代码** | GitHub（公共+私有） | ✅ 公共仓库 | `gh` CLI 登录后完整能力 |
| **RSS** | 任意 RSS/Atom 源 | ✅ 无需配置 | — |
| **国内社交** | 小红书、雪球、V2EX、小宇宙播客 | 部分零配置 | Cookie-Editor 导出 |
| **职业社交** | LinkedIn | Jina Reader 读公开页 | MCP Server 浏览器自动化 |

**核心架构（多后端路由）**：

```
每个平台 = 首选 → 备选1 → 备选2（有序列表，真实探测）
                │
                ▼
    agent-reach doctor  → 检测每条候选后端可用性
                │
                ▼
    Agent 直接调用上游工具（无包装层）
```

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ **完全可行** | MIT 协议，无任何限制 |
| **业务相关性** | ✅ **高度相关** | 本项目的 Agent 团队（尤其 Audrey 深度研究 / Aurora 日常事务）需要互联网数据接入能力；当前仅有 WebSearch + WebFetch，覆盖范围有限 |
| **技术栈兼容性** | ⚠️ **需桥接** | Agent Reach 为 **Python CLI**（`agent-reach` 命令），本项目为 TS + Neutralino；可通过 `child_process.execFile` 调用其 CLI，架构天然兼容 |
| **可直接集成** | ✅ **可行** | `pip install agent-reach` 安装后，通过 CLI 桥接即可使用；其核心能力（Jina Reader 网页阅读 / Exa 搜索 / yt-dlp 字幕 / gh GitHub）可直接提升现有 Agent 能力 |
| **概念可借鉴度** | ✅ **极高** | 「首选+备选」多后端路由、`doctor` 诊断命令、Agent Skills 注册机制、平台能力即插即用——全部可借鉴 |

**结论：✅ 推荐直接集成，P1 优先级**

**对现有 Agent 的增强点**：

| 现有 Agent | 当前限制 | Agent Reach 增强后 | 具体接入方式 |
|---|---|---|---|
| **Audrey**（深度研究） | 仅 WebSearch + WebFetch，无法访问社交媒体/视频/Reddit | 可扩展至 Twitter / Reddit / YouTube 字幕 / 全网语义搜索（Exa），研究数据源从 2 个扩展到 15+ 个 | `execFile('agent-reach', ['twitter', ...])` 等 |
| **Aurora**（日常事务） | 新闻摘要仅依赖 WebSearch | 增加 RSS 订阅（`feedparser`）、雪球金融数据、小宇宙播客转录 | `execFile('agent-reach', ['rss', ...])` |
| **Amelia**（文档摘要） | — | 可选：B站视频数据获取（`bili-cli`，通过 `exec` CLI 桥接） | CLI 桥接 |

**集成方案（3 步）**：

| 步骤 | 操作 | 对应文件 | 工作量 |
|---|---|---|---|
| Step 1 | 安装 `agent-reach`（Python pip install，全局） | `package.json` 无改动，用户需手动安装 Python + pip | 5 分钟 |
| Step 2 | 新增 Agent Reach CLI 桥接服务 | `services/agentReach.ts`（新增） | 中 |
| Step 3 | Audrey 深度研究扩展数据源，Aurora 增加 RSS/雪球能力 | `agents/audrey.ts` + `agents/aurora.ts` | 中 |

### 1.13 codebase-memory-mcp（DeusData/codebase-memory-mcp）集成评估

**项目信息**：[DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)（**MIT** 协议，2,461 commits，C++ 核心 + Rust，原生二进制分发，macOS/Linux/Windows 全平台）

**核心定位**：AI 编码 Agent 的「**代码知识图谱引擎**」，通过 tree-sitter AST 分析对代码库建立持久化知识图谱。Linux 内核（2800 万行代码 / 75K 文件）3 分钟完成索引，结构化查询在 **1ms 内** 返回结果，消耗 token 数减少 **120 倍**（5 次结构化查询：~3,400 tokens vs ~412,000 tokens）。覆盖 **158 种语言**，内置 Hybrid LSP 语义类型解析（Python/TS/JS/PHP/C#/Go/C/C++/Java/Kotlin/Rust/Perl 等 13 种主流语言）。

**15 个 MCP 工具能力**：search（符号搜索）、trace（调用追踪）、architecture（架构分析）、impact analysis（影响分析）、Cypher queries（图查询）、dead code detection（死代码检测）、cross-service HTTP linking（跨服务 HTTP 链路追踪）、ADR management（架构决策记录）、index coverage checks（索引覆盖率检查）等。

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ **完全可行** | MIT 协议，无任何限制 |
| **业务相关性** | ✅ **直接相关** | 本项目的 Atlas Agent（架构设计）+ Avery Agent（代码审查）均需要深度的代码库理解能力；codebase-memory-mcp 直接解决"大项目代码理解"痛点 |
| **技术栈兼容性** | ⚠️ **需桥接** | codebase-memory-mcp 为 **C++ 原生二进制 + MCP 协议**，本项目为 TS + Neutralino；可通过 MCP 客户端协议或 CLI 桥接调用，架构兼容 |
| **可直接集成** | ✅ **可行** | 下载原生二进制 → `install` → 配置 MCP server → 重启 Agent；或通过 CLI 模式直接调用（无需 MCP 协议） |
| **概念可借鉴度** | ✅ **极高** | 代码知识图谱构建、Hybrid LSP 语义解析、图数据库查询、影响分析、死代码检测——全部可借鉴 |

**结论：✅ 强烈推荐集成到 Atlas + Avery + Amelia，P1 优先级**

**15 MCP 工具与本项目 Agent 的映射**：

| codebase-memory-mcp 工具 | 对应本项目的 Agent | 增强点 |
|---|---|---|
| `search`（符号搜索） | Atlas / Avery | 精确查找函数/类/变量定义，替代当前模糊的文件搜索 |
| `trace`（调用追踪） | Avery（代码审查） | 审查某函数时自动追踪调用链，识别所有调用者 |
| `architecture`（架构分析） | Atlas（架构设计） | 分析模块依赖关系，辅助生成架构图 |
| `impact analysis`（影响分析） | Avery / Atlas | 修改某文件后，精确识别受影响文件和测试用例 |
| `Cypher queries`（图查询） | Atlas | 自定义代码图谱查询（如"所有导出函数"、"跨文件调用的私有方法"） |
| `dead code detection`（死代码检测） | Avery（代码审查） | 审查时自动发现未使用的函数/变量/导入 |
| `cross-service HTTP linking` | Atlas | 追踪跨服务的 HTTP 调用链路（前后端/微服务间） |
| `ADR management` | Atlas | 管理架构决策记录，辅助重构决策 |
| `index coverage checks` | — | 检查哪些文件尚未被索引，辅助增量索引 |

**集成方案（3 步）**：

| 步骤 | 操作 | 对应文件 | 工作量 |
|---|---|---|---|
| Step 1 | 安装 codebase-memory-mcp 原生二进制（`install.sh` / `install.ps1`） | 用户本地安装，无需项目代码改动 | 5 分钟 |
| Step 2 | 新增 codebase-memory-mcp CLI/MCP 桥接服务 | `services/codebaseMemory.ts`（新增） | 中 |
| Step 3 | Atlas 架构分析 + Avery 代码审查接入代码图谱查询 | `agents/atlas.ts` + `agents/avery.ts` | 高 |

### 1.14 SenseNova-Skills（OpenSenseNova/SenseNova-Skills）集成评估

**项目信息**：[OpenSenseNova/SenseNova-Skills](https://github.com/OpenSenseNova/SenseNova-Skills)（**MIT** 协议，100 commits，遵循 [Agent Skills](https://agentskills.io/) 约定）

**核心定位**：基于商汤 SenseNova 大模型家族的 **办公自动化 Skill 集合**，覆盖 4 大类能力：图像生成与可视化（Infographic / 图片模仿 / 简历生成）、PPT 演示文稿生成（创意模式 / 标准模式 / 快速模式）、Excel 数据分析（多表读取 / 大文件处理 / 图片 OCR 解析）、深度研究（多源调研 + 引用管理 + 报告生成）。所有 Skill 遵循 `SKILL.md` 结构化定义（含 triggers/capabilities/execution flow），可独立使用或组合为端到端工作流。

**Skill 清单（15 个）**：

| 类别 | Skill 名称 | 能力 |
|---|---|---|
| **图像生成** | `sn-image-base` | 文生图 / 图片识别 / 文本优化（底层能力层） |
| | `sn-infographic` | 信息图生成（87 种布局 / 66 种风格，VLM 质量审查） |
| | `sn-image-imitate` | 风格模仿生成 |
| | `sn-image-resume` | 简历图片生成 |
| **PPT 生成** | `sn-ppt-entry` | PPT 统一入口（快/标准/创意三种模式） |
| | `sn-ppt-creative` | 创意模式（每页 16:9 PNG） |
| | `sn-ppt-standard` | 标准模式（HTML 渲染 → VLM QC → PPTX 导出） |
| **数据分析** | `sn-da-excel-workflow` | Excel 端到端分析（多表 / 大文件 / 跨表聚合） |
| | `sn-da-image-caption` | 图片理解与数据提取（表格 OCR / 图表解析） |
| | `sn-da-large-file-analysis` | 大文件高性能分析（Parquet 转换 / 流式读取） |
| **深度研究** | `sn-deep-research` | 深度研究编排（DAG 依赖 / 证据复用） |
| | `sn-research-report` | 终稿报告撰写与编辑 |
| **搜索** | `sn-search-academic` | 学术搜索（ArXiv / Semantic Scholar / PubMed / Wikipedia） |
| | `sn-search-code` | 开发者搜索（GitHub / Stack Overflow / Hacker News / HuggingFace） |
| | `sn-search-social-cn` | 中文社交搜索（B站 / 知乎 / 抖音） |
| | `sn-search-social-en` | 英文社交搜索（Reddit / Twitter / YouTube） |

| 评估维度 | 结果 | 说明 |
|---|---|---|
| **许可协议** | ✅ **完全可行** | MIT 协议，无任何限制 |
| **业务相关性** | ✅ **高度相关** | SenseNova-Skills 的 4 大类能力（图像/PPT/数据分析/深度研究）与本项目规划的 Aria（内容生成）+ Arthur（文档与演示）+ Audrey（深度研究+数据分析）+ Amelia（文档摘要）高度重叠，可直接增强 |
| **技术栈兼容性** | ⚠️ **需桥接** | SenseNova-Skills 基于 Python + SenseNova API（`sn_agent_runner.py`），本项目为 TS + Neutralino；Skill 定义（`SKILL.md`）可直接嵌入 `skills/` 目录，但执行需通过 Python 子进程调用 |
| **可直接集成** | ⚠️ **部分可行** | Skill 定义（`SKILL.md`）可完全嵌入本项目 `skills/` 目录；执行时需配置 SenseNova API Key，且依赖 Python 运行时和商汤模型 API 可用性 |
| **概念可借鉴度** | ✅ **极高** | Skill 分层架构（Tier 0 基础层 / Tier 1 应用层）、DAG 依赖管理、证据复用、VLM 质量审查、HTML→PPTX 渲染流水线——全部可借鉴 |

**结论：⚠️ 部分集成，P2 优先级（Skill 定义可嵌入，执行依赖商汤 API）**

**与本项目 Agent 的能力对比与增强**：

| 本项目 Agent | 当前能力 | SenseNova-Skills 可增强 | 增强方式 |
|---|---|---|---|
| **Aria**（内容生成） | 文章/文案/邮件生成 | 信息图生成（`sn-infographic`）+ 简历生成（`sn-image-resume`） | 嵌入 Skill 定义 + Python 子进程调用 |
| **Arthur**（文档与演示） | Word/PDF/Excel/PPT 读取与生成 | PPT 生成（`sn-ppt-standard`）：HTML 渲染 → VLM QC → PPTX 导出，质量远超低级 pptxgenjs | 嵌入 Skill 定义，替换当前 PPT 生成逻辑 |
| **Audrey**（深度研究） | WebSearch + WebFetch + 报告生成 | 深度研究编排（`sn-deep-research`）：DAG 依赖 + 证据复用 + 引用管理 | 借鉴 DAG 架构，Prompt 优化 |
| **Amelia**（文档摘要） | xlsx 读取/写入 | Excel 大文件分析（`sn-da-large-file-analysis`）+ 图片 OCR 数据提取（`sn-da-image-caption`） | 嵌入 Skill 定义 + Python 子进程 |
| **Atlas**（架构设计） | Mermaid 图 + diagram-design | 搜索增强（`sn-search-code`：GitHub/StackOverflow/HuggingFace） | 嵌入 Skill 定义 + CLI 桥接 |

**集成方案（2 步）**：

| 步骤 | 操作 | 对应文件 | 工作量 |
|---|---|---|---|
| Step 1 | 嵌入 SenseNova-Skills 的 `SKILL.md` 定义到 `skills/` 目录（按类别分组） | `skills/sensenova/`（新增） | 低（直接复制 Skill 定义） |
| Step 2 | 可选：通过 Python 子进程调用 Skill 执行逻辑（需配置 SenseNova API Key + Python 运行时） | `services/sensenova.ts`（可选新增） | 高（需维护 Python 依赖 + API 可用性） |

### 1.15 设计系统（Brutalist）

| 组件类 | 用途 |
|---|---|
| `.btn-brutal` / `.btn-brutal-destructive` | 按钮（2px 黑色边框 + 硬阴影 + 悬停上浮） |
| `.card-brutal` | 卡片 |
| `.input-brutal` / `.select-brutal` | 输入框/下拉框 |
| `.msg-agent` / `.msg-user` / `.msg-system` | 聊天消息 |
| `.tab-brutal` | 标签切换 |
| `.file-card` | 文件卡片 |
| `.prose` | Markdown 渲染（含表格样式） |
| `.shadow-brutal-sm` / `.shadow-brutal` | 阴影工具类 |

---

## 二、删除 William、James 与 Sophie 方案

### 2.1 删除概述

| 删除 Agent | ID | 文件 | 角色 | 接替者/处理方式 |
|---|---|---|---|---|
| William | `code-reviewer` | `agents/codeReviewer.ts` | 代码审查 | **Avery**（测试修复 Agent） |
| James | `file-organizer` | `agents/fileOrganizer.ts` | 文件整理 | **Aurora**（日常事务 Agent） |
| Sophie | `memory` | `agents/memoryAgent.ts` | 记忆管理 | **MemoryStore 下沉为系统级功能**，由 Oliver 统一调度 |

### 2.2 需删除/清理的文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| **删除** | `src/renderer/agents/codeReviewer.ts` | William Agent 定义与实现 |
| **删除** | `src/renderer/agents/fileOrganizer.ts` | James Agent 定义与实现 |
| **删除** | `src/renderer/agents/memoryAgent.ts` | Sophie Agent 定义与实现（MemoryStore 不删除） |
| **删除** | `src/renderer/components/fileOrganizer/`（如存在） | James 的组件文件 |
| **保留** | `src/renderer/memory/` | MemoryStore + 类型定义 + 单例，作为基础设施保留 |
| **保留** | `src/renderer/components/memory/`（如存在） | MemoryViewer 记忆面板组件保留 |
| **删除** | `__tests__/` 中相关测试文件（如存在） | William/James/Sophie 的单元测试 |

### 2.3 需修改的文件

| 操作 | 文件路径 | 修改内容 |
|---|---|---|
| **修改** | `src/renderer/stores/agentOrchestrationStore.ts` | `createAgentInstances` 中移除三个 Agent 注册 |
| **修改** | `src/renderer/agents/agentTeam.ts` | `agentTeam` 数组移除三个 Agent 引用 |
| **修改** | `src/renderer/agents/promptBuilder.ts` | 若含 William/James/Sophie 的表单定义则移除 |
| **修改** | `src/renderer/agents/leader.ts` | Oliver systemPrompt 中添加记忆调度指令，移除 Sophie 团队成员介绍 |
| **修改** | `src/renderer/agents/registry.ts` | `agentRegistry` 移除 MemoryAgent 注册 |
| **修改** | `src/renderer/App.tsx` 或 `Sidebar.tsx` | UI 中 Agent 列表移除三个条目 |
| **修改** | `src/renderer/stores/settingsStore.ts` | 若存 William/James/Sophie 的默认模型配置则移除 |
| **修改** | `src/renderer/components/chat/ChatInput.tsx` | 自动记忆逻辑改为直接调用 `getMemoryStore().upsert()`（已如此，无需变更） |

### 2.4 能力回收与承接方案

**William → Avery（代码审查能力回收）**：

| 原 William 能力 | Avery 承接方式 |
|---|---|
| 代码质量审查（findings） | Avery 执行测试前进行静态分析，在 test report 中附带 lint 结果 |
| 安全审查 | Avery systemPrompt 加入安全检查清单，输出安全告警 |
| 性能审查 | Avery systemPrompt 加入性能热点检测，输出优化建议 |
| 递归搜索 11 种代码扩展名 | 复用 `findCodeFiles()` 逻辑移植到 `agents/avery.ts` |

**James → Aurora（文件整理能力回收）**：

| 原 James 能力 | Aurora 承接方式 |
|---|---|
| 文件分类 | Aurora 新增 `classifyFiles()` 方法，按扩展名/时间/大小自动归类 |
| 重命名建议 | Aurora 新增 `renameSuggestions()` 方法，基于文件内容/时间/约定规则 |
| 目录清理 | Aurora 新增 `cleanupSuggestions()` 方法，识别孤立/重复/过期文件 |

**Sophie → MemoryStore（记忆功能下沉为系统级基础设施）**：

Sophie 的删除策略与 William/James 不同 — 不保留 Agent 外壳，但完整保留底层记忆能力。

| 原 Sophie 能力 | 承接方式 | 实现要点 |
|---|---|---|
| **记住**（upsert 写入记忆） | **ChatInput.tsx 自动记忆** 已直接调用 `getMemoryStore().upsert()`（见代码第 635-650 行），无需 Sophie 介入 | 保持现有逻辑，新增的 Agent 输出摘要时自动触发 |
| **回忆**（按关键词/项目路径搜索） | **Oliver 调度** — 用户查询记忆时，Oliver 在 systemPrompt 中增加记忆调度规则，直接调用 `memoryStore.query()` | Oliver 新增记忆路由分支 |
| **遗忘**（删除记忆） | **Oliver 调度** — 用户说"忘了 XX"时，Oliver 调用 `memoryStore.delete()` | Oliver 新增遗忘分支 |
| **统计**（展示记忆概况） | **Oliver 调度** — 用户问"记忆概况"时，Oliver 调用 `memoryStore.getStats()` | Oliver 新增统计分支 |
| **MemoryViewer 面板** | **保留原组件** — 用户可直接在 UI 中查看/搜索/删除记忆，无需 Agent 中转 | 无需修改 |
| **LLM 记忆提取** | **移除** — Sophie 用 LLM 提取结构化记忆的复杂度对基础设施不必要，直接按规则写入即可 | `memoryAgent.ts` 中的 `handleRemember` 逻辑废弃 |

**Oliver systemPrompt 新增记忆调度指令**：
```
## 记忆调度（原 Sophie 功能）

当用户意图涉及记忆时，直接调用 MemoryStore：
- 用户说"记住XX" → 调用 memoryStore.upsert({ category, key, content, tags, projectPath })
- 用户说"回忆XX"/"之前说过XX" → 调用 memoryStore.query({ text, projectPath, limit: 10 })
- 用户说"忘了XX"/"删除关于XX" → 调用 memoryStore.delete(keyOrId)
- 用户问"记忆概况"/"我有多少记忆" → 调用 memoryStore.getStats()

记忆写入规则（所有 Agent 统一）：
- 用户明确说"记住"时写入 category=general
- Agent 执行完成后由 ChatInput 自动摘要写入 category=analysis-result（7 天 TTL）
- 用户偏好写入 category=user-preference
- 项目信息写入 category=project-context
```

### 2.5 影响分析

| 维度 | 影响 | 缓解措施 |
|---|---|---|
| Oliver 调度链 | Oliver 的 agentTeam 数组减少 3 人，但需新增记忆调度逻辑 | 更新 `agentTeam.ts` 中 handoff 目标列表 + systemPrompt |
| 并发能力 | 并发上限从 7→4 | 对日常使用无感知，4 个 Agent 已覆盖核心场景 |
| UI 列表 | Sidebar Agent 列表减少 3 行 | 无额外改动，列表数据源同步即可 |
| 用户习惯 | 若用户已有 William/James/Sophie 对话历史 | 历史保留，不影响已生成的消息记录 |
| 记忆系统数据 | 用户已存储的记忆数据（MemoryStore）**完全保留**，不受影响 | 数据持久化在 PlatformStorage，`STORAGE_KEY='agent_memory'`，Agent 删除不影响存储层 |
| MemoryViewer 面板 | **不受影响** — 用户仍可直接查看/搜索/删除记忆 | 无需修改 |
| 自动记忆 | **不受影响** — ChatInput.tsx 已直接调用 `getMemoryStore().upsert()` | 无需修改 |
| 用户"记住/回忆"命令 | 原先路由到 Sophie Agent，现改为 Oliver 直接调度 MemoryStore | Oliver systemPrompt 新增记忆调度分支 |
| LLM 调用量 | **降低** — Sophie 每次"记住"都调用 LLM 提取结构化信息，删除后直接写入，节省 token | 正效应 |
| Agent 总人数 | 现有 4 人 → 扩展后 11 人（含删除前 William/James/Sophie 为 7 人→11 人） | 团队更精简，新增 Agent 更有存在感 |

---

## 三、能力扩展方案

### 3.1 写代码 / 改代码

**对应 Agent**：Atlas（架构设计）、Avery（测试修复 + 代码审查）、Amelia（代码文档摘要）

**现有基础**：
- Neutralino API 提供 `fs.readFile` / `fs.writeFile` / `shellExec`
- 项目文件列表由 folderStore 管理
- Avery 接替 William 后新增代码审查能力

**新增项**：

| 能力 | 负责 Agent | 方案 | 新增文件 |
|---|---|---|---|
| 代码编辑器 | — | 集成 Monaco Editor，点击文件即打开/保存 | `components/editor/CodeEditor.tsx` |
| 代码审查 + 调试 | **Avery** | 调用 `services/ocr.ts` 桥接 open-code-review CLI，获取行级精度 AI 代码审查（精准文件筛选 / 智能打包 / 精细化规则 / 外挂定位与反思），结果流式写入 ChatView | 新增 `services/ocr.ts` + 扩展 `agents/avery.ts` |
| 代码 diff 预览 | **Avery** | 新增 DiffViewer 组件，展示修改前后对比，支持行级审查意见叠加显示 | `components/diff/DiffViewer.tsx` |
| 架构设计 | **Atlas** | 用 mermaid 生成系统架构图、模块依赖图 | `agents/atlas.ts` |
| 编辑级图表 | **Atlas** | 集成 diagram-design Skill，27 种视觉类型（架构图/流程图/时序图/ER 图等），输出 standalone HTML | `skills/diagram-design/` + `components/diagram/DiagramDesigner.tsx` |
| draw.io 转换 | **Atlas** | 从 `.drawio`/`.drawio.svg` 导入并重新渲染为编辑级 HTML | 嵌入 diagram-design 的 import 能力 |
| 图表品牌定制 | **Atlas** | style-guide 提取 Brutalist 配色（paper=#FFFAEF, ink=#1A1A1A, accent=#FFC857） | `skills/diagram-design/references/style-guide.md`（本地定制版） |
| 测试修复 | **Avery** | 自动运行 `npm test` 并修复报错 | `agents/avery.ts` |

**PlatformAPI 扩展**：
```typescript
diff: (old: string, new: string) => string
fileWatch: (path: string, callback: (evt: 'changed' | 'created' | 'deleted') => void) => () => void
```

---

### 3.2 深度研究

**对应 Agent**：Audrey（深度研究）

**现有基础**：
- `WebSearch` / `WebFetch` 工具可用
- Amelia 已支持多来源文档摘要

**新增项**：

| 能力 | 方案 | 新增文件 |
|---|---|---|
| 多来源调研 | **Audrey** 自动规划搜索→抓取→综合→引用 | `agents/audrey.ts` |
| 竞品分析 | 扩展 Audrey 系统 prompt，新增模板 | `agents/prompts/competitive.md` |
| 结构化报告 | 复用 Amelia 的 Markdown 输出 + `.prose` 样式 | 无需新文件 |
| 评估备忘录 | 新增 `EvaluationMemo` 组件，Brutalist 卡片风格展示评分/对比 | `components/research/EvaluationMemo.tsx` |
| 跨领域综合 | Audrey 内建"去重→交叉验证→矛盾标注"流程 | 扩展 Audrey systemPrompt |

---

### 3.3 日常事务

**对应 Agent**：Aurora（日常事务 + 文件整理）、Aria（内容生成）

**现有基础**：
- Neutralino `browser` 可发起 HTTP 请求
- `fs` 支持文件读写、移动、复制、删除
- `dialog.openFile` 支持文件选择
- Aurora 接替 James 后新增文件整理能力

**新增项**：

| 能力 | 负责 Agent | 方案 | 新增文件 |
|---|---|---|---|
| 网页搜索 | — | 复用 `WebSearch` 工具 | 已存在 |
| 新闻摘要 | **Aurora** | 定时拉取 RSS/网页→摘要 | `agents/aurora.ts` |
| 文件整理 | **Aurora** | 文件分类/重命名/清理建议（接替 James 能力） | `agents/aurora.ts`（内部分法） |
| 内容生成 | **Aria** | 多模型模板，支持文章/文案/邮件/社交媒体 | `agents/aria.ts` |
| AI 图片生成 | — | 封装 Seedream 文生图 API | `services/seedream.ts` |
| AI 视频生成 | — | 封装 Seedance 视频生成 API | `services/seedance.ts` |
| 文件操作面板 | **Aurora** | 新增 `FileManager` 组件，支持上传/下载/移动/复制/重命名/批量操作 | `components/files/FileManager.tsx` |

---

### 3.4 文档与演示

**对应 Agent**：Arthur（文档与演示全能 Agent）

> 将 Word 文档、PPT 演示、Excel 表格、PDF、HTML 报告五项能力合并为 **Arthur** 一个 Agent。Arthur 根据用户请求自动判断输出格式，通过子模块分别调用对应的 npm 包实现。

**新增项**：

| 能力 | 方案 | 新增文件 |
|---|---|---|
| Word 文档（创建/编辑/批注） | **Arthur** 内嵌 `docx` 子模块 | `agents/arthur.ts`（内部分发） |
| PPT 演示（.pptx 或 HTML 动画） | **Arthur** 内嵌 `pptxgenjs` 子模块，同时支持生成 HTML 幻灯片 | `agents/arthur.ts` + `components/slides/SlideDeck.tsx` |
| Excel 表格（数据处理/公式/图表） | **Arthur** 内嵌 `xlsx` 子模块 | `agents/arthur.ts`（内部分发） |
| PDF（读取/分类/提取/创建/合并/拆分/表单填写） | **Arthur** 内嵌 `pdf-lib`（创建/编辑）+ `pdf-inspector`（读取/分类/提取，来自 firecrawl/pdf-inspector） | `agents/arthur.ts`（内部分发）+ `services/pdf.ts` |
| HTML 报告（可视化网页） | 复用 Markdown → HTML 渲染，新增"导出 HTML"按钮 | `components/report/HtmlReportExport.tsx` |

**Arthur 内部模块分发逻辑**：
```
用户请求 → Arthur 识别文档类型关键词
  ├─ "Word"/"docx"/"文档"  → 调用 docx 子模块
  ├─ "PPT"/"pptx"/"演示"/"幻灯片"  → 调用 pptxgenjs 子模块
  ├─ "Excel"/"xlsx"/"表格"/"公式"  → 调用 xlsx 子模块
  ├─ "PDF"/"pdf"/"合并"/"拆分"  → 调用 pdf-lib 子模块
  └─ "HTML"/"网页"/"报告"  → 输出 HTML 文件
```

---

### 3.5 助理事务

**现有基础**：
- **记忆系统已完整实现** — `MemoryStore` 支持 upsert/query/delete/stats
- `MemoryViewer` 组件已存在
- Neutralino `timer` API 可设定时器
- Aurora 负责日常提醒与定时任务

**新增项**：

| 能力 | 方案 | 新增文件 |
|---|---|---|
| 定时任务 | 新增 `scheduler.ts`，cron 表达式驱动，Aurora 调用 | `services/scheduler.ts` |
| 桌面通知 | 利用 Neutralino `notify.send()`，Aurora 触发 | 复用 PlatformAPI |
| 任务管理面板 | 新增 `TaskPanel` 组件，Brutalist 风格 | `components/tasks/TaskPanel.tsx` |
| 记忆面板增强 | 扩展 `MemoryViewer`，增加"添加记忆"输入框、按 category 过滤 | 扩展现有组件 |

**Store 新增**：
- `stores/taskStore.ts` — 定时任务 CRUD + 触发
- `stores/notificationStore.ts` — 通知队列

---

### 3.6 插件能力

**对应 Agent**：Alice（浏览器控制）

| 能力 | 负责 Agent | 方案 | 新增文件 |
|---|---|---|---|
| 飞书（Lark）全流程 | — | 封装飞书开放平台 API（消息/日历/任务/文档/电子表格/会议纪要） | `services/larkConnector.ts` |
| 浏览器控制 | **Alice** | 利用 `browser_waiting_for_user_interaction` + Neutralino browser 模块 | `agents/alice.ts` |
| Seedream 图片生成 | — | AI 图片生成服务封装 | `services/seedream.ts` |
| Seedance 视频生成 | — | AI 视频生成服务封装 | `services/seedance.ts` |
| 插件管理面板 | — | 新增 `PluginPanel` 组件，管理已接入插件 | `components/plugins/PluginPanel.tsx` |

---

## 四、新增文件结构

```
src/renderer/
├── agents/
│   ├── atlas.ts                # Atlas — 架构设计 Agent
│   ├── audrey.ts               # Audrey — 深度研究 Agent
│   ├── avery.ts                # Avery — 测试修复 Agent
│   ├── aurora.ts               # Aurora — 日常事务 Agent
│   ├── aria.ts                 # Aria — 内容生成 Agent
│   ├── arthur.ts               # Arthur — 文档与演示全能 Agent（合并 Word/PPT/Excel/PDF）
│   ├── alice.ts                # Alice — 浏览器控制 Agent
│   └── prompts/
│       └── competitive.md      # 竞品分析模板（Audrey 使用）
├── components/
│   ├── editor/
│   │   └── CodeEditor.tsx      # Monaco 代码编辑器
│   ├── diff/
│   │   └── DiffViewer.tsx      # 代码 diff 预览
│   ├── research/
│   │   └── EvaluationMemo.tsx  # 评估备忘录（Audrey 输出）
│   ├── files/
│   │   └── FileManager.tsx     # 文件管理面板（Aurora 使用）
│   ├── slides/
│   │   └── SlideDeck.tsx       # 幻灯片播放器（Arthur 输出）
│   ├── report/
│   │   └── HtmlReportExport.tsx # HTML 报告导出
│   ├── diagram/
│   │   └── DiagramDesigner.tsx   # diagram-design HTML 图表渲染器（Atlas 集成）
│   ├── tasks/
│   │   └── TaskPanel.tsx       # 定时任务面板（Aurora 使用）
│   └── plugins/
│       └── PluginPanel.tsx     # 插件管理面板
├── skills/
│   ├── config/
│   │   └── routing.json          # Agent 路由规则（借鉴 reverse-skill 架构，41 条规则格式）
│   ├── diagram-design/           # 嵌入 cathrynlavery/diagram-design Skill
│   │   ├── SKILL.md
│   │   ├── skill.json            # 结构化 Skill 元数据（version/trigger/steps/validation，借鉴 TencentDB）
│   │   ├── references/
│   │   │   ├── style-guide.md    # Brutalist 品牌定制版
│   │   │   └── type-*.md         # 27 种视觉类型参考
│   │   └── prompts/
│   └── code-review/              # 代码审查规则配置（借鉴 OCR 精细化规则匹配）
│       └── review-rules.yaml     # 审查规则模板（按语言/路径/变更类型匹配）
├── services/
│   ├── scheduler.ts              # 定时任务引擎（Aurora 调用）
│   ├── larkConnector.ts          # 飞书 API 封装
│   ├── seedream.ts               # AI 图片生成
│   ├── seedance.ts               # AI 视频生成
│   ├── pdf.ts                    # pdf-inspector 封装层（@firecrawl/pdf-inspector）
│   ├── toolRegistry.ts           # 工具索引（借鉴 reverse-skill tool-index，自动扫描本机工具）
│   ├── codeGraph.ts              # 代码调用关系分析（借鉴 TencentDB CodeGraph）
│   └── ocr.ts                    # Open Code Review CLI 桥接（@alibaba-group/open-code-review，Avery 代码审查）
├── memory/
│   ├── types.ts                  # 记忆类型定义（含 L0-L3 层级字段，借鉴 TencentDB）
│   └── memoryStore.ts            # 记忆存储（L0-L3 蒸馏 + ACL 权限）
├── stores/
│   ├── taskStore.ts            # 定时任务状态
│   └── pluginStore.ts          # 插件状态
└── api/
    └── (扩展 PlatformAPI 接口 + neutralino/electron 适配器)
```

---

## 五、新增 Agent 角色设定

### Atlas（架构设计）

| 字段 | 值 |
|---|---|
| ID | `architect` |
| 图标 | `GitBranch` |
| 颜色 | `#A78BFA`（紫色，技术/结构感） |
| 核心能力 | 系统架构图、模块依赖图、数据流图、27 种编辑级图表（diagram-design Skill 集成） |
| 输出格式 | mermaid 语法 + 文字说明 + diagram-design standalone HTML |

### Audrey（深度研究）

| 字段 | 值 |
|---|---|
| ID | `researcher` |
| 图标 | `Search` |
| 颜色 | `#27CCF3`（蓝色，研究/探索感） |
| 核心能力 | 多来源调研、竞品分析、结构化报告、跨领域综合 |
| 输出格式 | Markdown 报告 + 评估表格 + 引用列表 |

### Avery（测试修复）

| 字段 | 值 |
|---|---|
| ID | `qa` |
| 图标 | `Bug` |
| 颜色 | `#4ADE80`（绿色，通过/成功感） |
| 核心能力 | 自动运行测试、分析失败、定位 Bug、提交修复、代码审查（接替 William）+ 集成 open-code-review CLI 实现行级精度的 AI 代码审查（精准文件筛选 / 智能文件打包 / 精细化规则匹配 / 外挂定位与反思模块） |
| 输出格式 | 测试报告 + 修复 diff + 回归建议 + 结构化审查报告（severity / line / file / message / suggestion） |

### Aurora（日常事务）

| 字段 | 值 |
|---|---|
| ID | `daily` |
| 图标 | `Sun` |
| 颜色 | `#F59E0B`（橙黄色，日常/温暖感） |
| 核心能力 | 新闻摘要、定时提醒、桌面通知、文件操作、文件分类整理（接替 James） |
| 输出格式 | 摘要卡片 + 通知事件 + 整理建议 |

### Aria（内容生成）

| 字段 | 值 |
|---|---|
| ID | `writer` |
| 图标 | `PenTool` |
| 颜色 | `#EC4899`（粉色，创意/写作感） |
| 核心能力 | 文章、文案、邮件、社交媒体内容生成 |
| 输出格式 | 纯文本/Markdown 内容 |

### Arthur（文档与演示）

| 字段 | 值 |
|---|---|
| ID | `archivist` |
| 图标 | `FileText` |
| 颜色 | `#8B5CF6`（深紫色，档案/文档感） |
| 核心能力 | Word 创建编辑、PPT 生成、Excel 数据处理、PDF 操作、HTML 报告 |
| 输出格式 | .docx / .pptx / .xlsx / .pdf / .html |
| 内部模块 | `docx` / `pptxgenjs` / `xlsx` / `pdf-lib` 四子模块按关键词分发 |

### Alice（浏览器控制）

| 字段 | 值 |
|---|---|
| ID | `browser` |
| 图标 | `Globe` |
| 颜色 | `#06B6D4`（青色，网络/互联网感） |
| 核心能力 | AI 驱动网页自动化、表单填写、数据抓取 |
| 输出格式 | 操作日志 + 抓取结果 |

---

## 六、实现要点

### 6.1 保持 Brutalist 设计一致

所有新增组件必须使用现有 Tailwind 类：

```typescript
// 按钮
className="btn-brutal"
// 卡片
className="card-brutal"
// 输入
className="input-brutal"
// 下拉
className="select-brutal"
// 消息
className="msg-agent"
// 标签
className="tab-brutal active"
// Markdown 内容
className="prose"
// 阴影
className="shadow-brutal-sm"
```

### 6.2 Agent 注册流程

在 `agentOrchestrationStore.ts` 的 `createAgentInstances` 中追加新 Agent：

```typescript
const agents = createAgentInstances({
  toolHub,
  memoryStore,
  folderStore,
  api,
})
```

每个新 Agent 继承 `BaseAgent`，定义 `config`（含 systemPrompt / icon / color / provider），如需注入额外上下文（如文件片段），重写 `execute` 方法。

### 6.3 PlatformAPI 扩展原则

1. 先在 `platformAPI.ts` 接口中定义新方法签名
2. 在 `neutralino.ts` 中实现真实逻辑
3. 在 `electron.ts` 中提供 fallback（返回空值或 throw）

### 6.4 记忆系统集成（系统级，非 Agent）

`MemoryStore` 已支持 `upsert` / `query` / `delete` / `getStats`，作为系统级基础设施对所有 Agent 开放。计划删除 Sophie Agent 后，记忆能力不再需要独立 Agent 中转。

- Oliver 直接调用 `memoryStore.query()` / `upsert()` / `delete()` / `getStats()` 处理用户记忆指令
- ChatInput.tsx 在 Agent 执行完成后自动摘要写入 `category=analysis-result`（7 天 TTL）
- 用户偏好写入 `category=user-preference`，项目信息写入 `category=project-context`
- `MemoryViewer` 面板保留，用户可直接在 UI 中查看/搜索/删除记忆

### 6.5 多模型路由

所有 Agent 的 `config.provider` 字段控制使用哪个模型，用户可在 SettingsPanel 中为每个 Agent 绑定模型，新 Agent 继承此机制，无需改动。

### 6.6 Arthur 多格式分发策略

Arthur 通过关键词识别用户需求类型，内部路由到对应子模块：

```
关键词匹配优先级：docx > pptx > xlsx > pdf > html
同时命中多关键词时，优先执行最先匹配的格式
```

---

## 七、实施优先级建议

| 优先级 | 能力 | 负责 Agent | 理由 |
|---|---|---|---|
| P0 | 深度研究 | Audrey | 高价值，复用现有 WebSearch + WebFetch |
| P0 | 代码编辑器 + diff 预览 | — | 开发者核心体验，直接提升生产力 |
| P0 | 删除 William + James + Sophie | — | 精简团队，为新增 Agent 腾出容量 |
| P0 | 记忆功能下沉至系统级 | — | Sophie 删除后必须同步完成，否则用户"记住/回忆"命令失效 |
| P0 | pdf-inspector 集成 | Amelia + Arthur | 替换当前 `readPDFText()`，大幅提升 PDF 处理能力，`npm install @firecrawl/pdf-inspector` |
| P0 | open-code-review 集成 | Avery | 行级精度 AI 代码审查，CLI 桥接即可，`npm install @alibaba-group/open-code-review`，显著提升代码审查质量（精准文件筛选 / 智能打包 / 精细化规则 / 外挂定位与反思） |
| P1 | 代码审查迁移至 Avery | Avery | 承接 William 能力，systemPrompt 扩展即可 |
| P1 | 文件整理迁移至 Aurora | Aurora | 承接 James 能力，新增 classify/rename/cleanup 方法 |
| P1 | Oliver 记忆调度 logic 开发 | Oliver | 新增记忆路由分支（记住/回忆/遗忘/统计），systemPrompt + 代码改动 |
| P1 | MemoryStore 升级 L0-L3 蒸馏 | — | 借鉴 TencentDB 记忆层级，将扁平结构升级为 4 层蒸馏（原始→原子→场景→人设），提升 Oliver 调度精度 |
| P1 | 定时任务 + 通知 | Aurora | 利用已有 MemoryStore + Neutralino notify |
| P1 | 内容生成 | Aria | 直接调用多模型能力，实现成本最低 |
| P1 | 飞书连接器 | — | 团队协作高频场景 |
| P1 | diagram-design Skill 集成到 Atlas | Atlas | 嵌入 Skill 目录 + 定制 Brutalist style-guide + 新增 `DiagramDesigner.tsx` |
| P1 | Agent Reach 集成 | Audrey + Aurora | 安装 `agent-reach`（Python CLI），新增 `services/agentReach.ts` 桥接；数据源从 2 个扩展到 15+（Twitter / Reddit / YouTube 字幕 / Exa 搜索 / RSS 订阅 / 雪球 / 小宇宙播客），`pip install agent-reach` |
| P1 | codebase-memory-mcp 集成 | Atlas + Avery + Amelia | 安装原生二进制 + 15 MCP 工具桥接（代码知识图谱 / 调用追踪 / 死代码检测 / 影响分析），Linux 内核 3 分钟索引，token 消耗减少 120 倍；`curl install.sh` 或 `install.ps1` |
| P2 | SenseNova-Skills 集成 | Aria + Arthur + Audrey + Amelia | 嵌入 `skills/sensenova/` 目录（Skill 定义），可选 Python 子进程桥接执行；覆盖信息图 / PPT / Excel 分析 / 深度研究四大能力域，需配置 SenseNova API Key |
| P2 | 文档与演示（合并） | Arthur | 一个 Agent 覆盖五格式，但需引入多个 npm 包 |
| P2 | AI 图片/视频生成 | — | 依赖第三方 API 可用性 |
| P3 | 浏览器控制 | Alice | 需要浏览器自动化协议支持 |
| P3 | 测试修复 | Avery | 需要深度代码分析能力，风险较高 |

---

## 八、风险与注意事项

1. **删除 Agent 兼容性**：若用户历史对话中包含 William/James/Sophie 的消息，消息记录保留但 Agent 列表不再展示；如需重建历史可恢复 `codeReviewer.ts` / `fileOrganizer.ts` / `memoryAgent.ts`
2. **Sophie 删除与记忆功能衔接**：Oliver 记忆调度 logic 必须与 Sophie 删除**同批次部署**，否则用户"记住/回忆/遗忘"命令将无响应的 0 时刻；建议先完成 Oliver logic 再删除 Sophie
3. **MemoryStore 直接暴露给 Oliver 的复杂度**：Oliver 需直接调用 `memoryStore.query()` / `upsert()` / `delete()` / `getStats()`，需确保 Oliver 的 execute 方法中能访问 memoryStore（当前 `leader.ts` 已有 `memoryStore` 参数）
4. **MemoryStore 数据一致性**：删除 Sophie 后，`STORAGE_KEY='agent_memory'` 下的持久化数据完全保留，无需迁移或清理；`initMemoryStore()` 在应用启动时自动加载
5. **Avery 承接 William 复杂度**：代码审查 + 测试修复能力叠加，systemPrompt 需精心设计避免指令冲突；建议分阶段实施，先做审查再做修复
6. **Aurora 承接 James 复杂度**：文件整理需调用大量 fs API，注意批量操作的性能（单线程处理）和错误恢复
7. **npm 包体积**：`docx` / `pptxgenjs` / `xlsx` / `pdf-lib` 体积较大，Arthur 合并后需评估总打包体积对 Neutralino 的影响
8. **Electron fallback**：新增 PlatformAPI 方法需同步在 `electron.ts` 中实现，否则 Electron 环境下不可用
9. **Agent 团队人数上限**：删除后当前 11 人规模在合理范围内，新增需评估用户体验
10. **测试覆盖**：每个新增 Agent 应有对应的 Vitest 单元测试，覆盖 execute 方法的边界情况
11. **Arthur 格式冲突**：当用户需求同时涉及多种文档格式时，需在 systemPrompt 中明确"优先完成主任务，其余作为后续步骤"的策略
12. **diagram-design Skill 引用更新策略**：Skill 来自外部 GitHub 仓库（cathrynlavery/diagram-design），嵌入后成为项目静态资源；若原仓库更新，需手动同步，建议在 `package.json` 中添加 `postinstall` 脚本拉取最新 Skill 或设置 `package.json` 中 `diagramDesignVersion` 字段追踪
13. **图表 CSS 与 Brutalist 冲突**：diagram-design 默认 style-guide 使用 editorial 配色（`#f5f5f5` 底色 + `#2d3142` 墨色），需**预先定制为 Brutalist 配色**（`paper=#FFFAEF`、`ink=#1A1A1A`、`accent=#FFC857`），并在 style-guide.md 中移除 `border-radius`、添加 `border: 2px solid` 和 `box-shadow: 4px 4px 0px #1A1A1A` 以匹配整体风格
14. **pdf-inspector NAPI 平台兼容**：`@firecrawl/pdf-inspector` 通过 NAPI 绑定 Rust 核心，需在发布前验证 Windows/macOS/Linux 三个平台的预编译二进制是否均可正常加载；若缺失某平台包，需回退到 `pdf-lib` 或文档化手动构建步骤
15. **pdf-inspector OCR 外部依赖**：OCR 功能需额外安装 PDFium + ONNX Runtime + PP-OCRv6 模型文件（总计约 500MB+），仅在有扫描件需求时按需启用；纯文本 PDF 不需要 OCR，体积仍维持在 5-10MB 范围
16. **pdf-inspector 与 pdf-lib 职责边界**：pdf-inspector 负责"读"（分类+提取+Markdown），pdf-lib 负责"写"（创建/编辑/合并/拆分），两者不重叠；集成时需在 `services/pdf.ts` 中清晰暴露两套 API，避免混淆
17. **routing.json 规则漂移**：借鉴 reverse-skill 的 `routing.json` 结构化路由后，规则文件需保持与 Agent 注册表同步更新；每次新增/删除 Agent 时必须同步修改 `routing.json`，否则 Oliver 会路由到不存在的 Agent
18. **toolRegistry 扫描耗时**：`toolRegistry.ts` 自动扫描本机工具（`npm list -g` / `where.exe` / `which`）可能耗时 2-5 秒；应在应用启动时异步执行，不影响 UI 渲染，同时提供"重新扫描"手动触发入口
19. **reverse-skill 安全领域内容污染风险**：借鉴 routing.json 架构时，**仅复制 JSON 结构和测试模式**，绝不复制任何逆向/渗透相关的路由规则内容；建议在 `routing.json` 顶部标注明确的范围声明，防止内容混入
20. **L0-L3 蒸馏质量依赖 LLM 调用**：MemoryStore 升级为 4 层蒸馏后，L1/L2/L3 的生成依赖于 LLM（提取原子事实/总结场景经验/归纳人设模式），会产生大量额外 API 调用；建议设置"蒸馏延迟"：新记忆先在 L0 暂存，等待 30 分钟无新对话后自动触发蒸馏，避免高频触发
21. **Wiki 链接图存储膨胀**：文档处理时自动提取 `[[双向链接]]` 构建链接图，当项目包含大量文档（如 1000+ 文件）时，关系图节点/边数量可能指数增长；建议限制链接提取范围（仅提取相邻目录文档间的链接），并提供"图谱剪枝"功能
22. **CodeGraph 代码扫描性能**：`services/codeGraph.ts` 构建代码调用关系图时需要解析整个项目源码；对大项目（10万+ 行代码）首次扫描可能耗时 5-30 秒；建议增量扫描（仅解析变更文件）+ Web Worker 后台执行 + 提供扫描进度 UI
23. **Skill 版本管理迁移成本**：现有 `skills/diagram-design` 为无版本 Markdown 格式；升级为结构化 `skill.json` 需一次性迁移；建议在 `skill.json` 中保留 `legacy_markdown_path` 字段指向原 `SKILL.md`，实现渐进式迁移
24. **open-code-review CLI 平台依赖**：`@alibaba-group/open-code-review` 为 Go 编译的二进制 CLI，需验证 Windows/macOS/Linux 三个平台的二进制可用性；安装时通过 npm postinstall 下载对应平台二进制，网络受限环境下可能失败，建议在 `services/ocr.ts` 中增加二进制缺失检测 + 友好的错误提示
25. **open-code-review LLM 配置耦合**：OCR CLI 需要独立的 LLM provider 配置（API Key / endpoint / model）；本项目已有 AIProvider 体系（OpenAI/Anthropic/DeepSeek/硅基流动），二者配置可能冲突；建议 OCR 复用本项目的 LLM 通道，通过环境变量或配置文件传递，而非要求用户重复配置
26. **OCR Delegate 模式输出格式稳定性**：Delegate 模式输出为 JSON 格式（包含文件选择结果 + 规则匹配 + 审查模板），需解析并转换为 Avery 可处理的中间格式；OCR CLI 版本升级可能导致输出格式变化，建议在 `services/ocr.ts` 中增加 schema 校验 + 格式变更时降级为 CLI 桥接模式（方式 A）
27. **代码审查规则维护成本**：`skills/code-review/review-rules.yaml` 审查规则模板需随项目技术栈变化同步更新（如新增 Go/Rust 支持时）；建议在规则文件中增加版本号字段，并在 `services/ocr.ts` 中增加"规则最后更新时间"检查，超过 90 天未更新时提醒用户
28. **Agent Reach Python 运行时依赖**：Agent Reach 为 Python CLI，需用户本地安装 Python 3.x + pip；建议在 `services/agentReach.ts` 中增加 Python 版本检测 + 缺失安装引导（指向安装文档链接），避免用户面对纯错误提示束手无策
29. **Agent Reach 多后端路由稳定性**：Agent Reach 内部采用「首选+备选」后端路由（如 Twitter: twitter-cli ▸ OpenCLI ▸ bird），任一后端失效可能影响该渠道可用性；虽然 `agent-reach doctor` 能检测状态，但本项目需在 `services/agentReach.ts` 中透传检测结果，并在 UI 层展示渠道健康状态
30. **Agent Reach Cookie 安全与合规**：小红书 / Twitter / LinkedIn 等渠道依赖用户 Cookie，存储在本机 `~/.agent-reach/config.yaml`（权限 600）；本项目桥接时不应触碰 Cookie 文件，仅调用 CLI 命令读取结果，避免敏感数据暴露
31. **Agent Reach 封号风险**：通过脚本/API 调用 Twitter / 小红书等平台存在被平台检测封号风险；建议在集成文档中明确标注，并推荐用户使用专用小号
32. **codebase-memory-mcp 原生二进制体积与分发**：C++ 编译的原生二进制体积较大（含 158 种语言 tree-sitter 语法），需验证 Windows/macOS/Linux 三个平台的预编译二进制可用性；建议在 `services/codebaseMemory.ts` 中增加二进制缺失检测 + 自动下载安装逻辑
33. **codebase-memory-mcp 首次索引耗时**：虽已优化到 Linux 内核 3 分钟，但普通项目首次索引仍需数十秒到数分钟；建议在 `services/codebaseMemory.ts` 中实现异步索引 + 进度回调 + 索引完成后通知 Agent 的策略，避免用户等待
34. **codebase-memory-mcp 与 Neutralino 安全沙箱冲突**：原生二进制需在本机文件系统读写（索引 / 缓存），可能与 Neutralino 的进程沙箱策略冲突；建议在应用启动时自动创建 `~/.codebase-memory-mcp/cache` 目录并配置权限
35. **codebase-memory-mcp 杀毒软件误报**：C++ 原生二进制可能触发 Windows Defender 等杀毒软件误报；建议在集成文档中注明已知误报并附带添加白名单的步骤
36. **SenseNova-Skills 商汤 API 可用性依赖**：Skill 执行层（`sn_agent_runner.py`）依赖商汤 SenseNova API，若 API 下线/限流/涨价，执行路径将完全失效；建议仅采用 Skill 定义嵌入路径（`SKILL.md` → LLM prompt），将 API 调用作为可选增强，而非核心依赖
37. **SenseNova-Skills 用户数据外传**：Skill 执行时将用户数据（Excel 内容、研究主题）发送至商汤云端 API，可能违反企业数据合规要求；建议在集成文档中明确标注，并提供"纯本地执行模式"（仅嵌入 Skill 定义，不发起外部 API 调用）
38. **SenseNova-Skills Python 子进程冷启动开销**：每次 Skill 执行需启动 Python 子进程（冷启动约 0.5-2s），不适合高频调用场景；建议仅在用户明确要求生成 PPT/信息图时触发，日常分析仍走 TS 原生路径
39. **SenseNova-Skills LLM 模型偏好差异**：Skill Prompt 设计针对 SenseNova 模型优化，若本项目使用 DeepSeek/豆包等其他模型，Skill 执行效果可能有差异；建议嵌入后对关键 Skill 进行 Prompt 适配测试
40. **三个外部项目版本漂移**：Agent Reach（372 commits / 活跃开发）、codebase-memory-mcp（2,461 commits / 高活跃）、SenseNova-Skills（100 commits / 中等活跃）均持续更新；建议在 `package.json` 中增加 `externalIntegrations` 字段追踪集成版本，定期同步更新
