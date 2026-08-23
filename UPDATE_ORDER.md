# 更新顺序与步骤（与实际项目对齐版）

> 原则：**UI 优先、只增不改减**；严格对照 `CAPABILITY_EXPANSION_PLAN.md`，逻辑以该文档为准。
> 本文件已将原计划中的路径/文件映射到**实际代码库**（原计划中的 `agentTeam.ts` / `promptBuilder.ts` / `agentOrchestrationStore.ts` / `toolHub.ts` 在现有项目中**不存在**，实际使用 `registry.ts` + Zustand store）。
> 图例：✅ 已实现/已就绪　·　🔜 待接入（需要联调/安装第三方依赖）

---

## 一、Agent 团队扩展（Phase A）— 核心

> 依据：CAPABILITY_EXPANSION_PLAN.md 1.4 / 1.3、五、2.3、2.4

| 步骤 | 实际文件 | 操作 | 状态 |
|---|---|---|---|
| A1 | `src/renderer/agents/base.ts` | `AgentConfig` 定义已含 id/name/icon/color/provider/model/systemPrompt | ✅ |
| A2 | `src/renderer/agents/registry.ts` | 注册 11 位 Agent（leader + 10 子 Agent），`createAgentRegistry(platform, memoryStore?)` | ✅ |
| A3 | `src/renderer/agents/{atlas,audrey,avery,aurora,aria,arthur,alice}.ts` | 7 个新 Agent 文件 | ✅ |
| A4 | `src/renderer/components/layout/Sidebar.tsx` | 由 `sidebarStore.agents` 动态渲染 11 位 Agent（leader 置顶 + "推荐"角标） | ✅ |
| A5 | `src/renderer/main.tsx` | 初始化平台 → `createAgentRegistry` → `setAgents` | ✅ 本次已接入记忆 |
| A6 | 删除 William/James/Sophie 文件 | 删除 `codeReviewer.ts`、`fileOrganizer.ts`、`memoryAgent.ts` | ✅ 本次已删除 |
| A7 | `src/renderer/components/settings/SettingsPanel.tsx` | 基于 `agentRegistry.getAll()` 遍历，10 个子 Agent 均有 provider/model 绑定 | ✅ |
| A8 | `src/renderer/agents/leader.ts` | 11 位团队介绍、路由规则、协作逻辑、多 Agent Round1-4 | ✅ |

## 二、记忆系统（Phase B）— 核心，本次重点

> 依据：CAPABILITY_EXPANSION_PLAN.md 2.4 记忆调度、1.3、3.5 记忆面板增强
> 风险 #2：删除 Sophie 与 Oliver 记忆调度必须同批次 → 本次已同批完成。

| 步骤 | 实际文件 | 映射/操作 | 状态 |
|---|---|---|---|
| B1 | `src/renderer/memory/memoryStore.ts` | `MemoryStore`（query/upsert/delete/getStats/500 上限/去抖） | ✅（既有） |
| B2 | `src/renderer/memory/index.ts` | 单例 `initMemoryStore/getMemoryStore` | ✅ |
| B3 | `src/renderer/main.tsx` | `initMemoryStore(platform)` 并把实例传给 `createAgentRegistry` | ✅ 本次接通 |
| B4 | `src/renderer/agents/registry.ts` | `createAgentRegistry(platform, memoryStore)` → 注入 `LeaderAgent(platform, memoryStore)` | ✅ 本次接通 |
| B5 | `src/renderer/agents/leader.ts` | systemPrompt 新增「记忆调度」章节（记住/回忆/遗忘/统计） | ✅ 本次 |
| B6 | `src/renderer/agents/leader.ts` | `detectMemoryIntent()` + `handleMemoryCommand()` + `streamReply()`；移除被废弃的 `memory` 路由 id | ✅ 本次 |
| B7 | 新增 `src/renderer/components/memory/MemoryViewer.tsx` | Brutalist 记忆面板：统计卡 + 按分类过滤 + 添加记忆 + 列表删除 | ✅ 本次 |
| B8 | `src/renderer/App.tsx` | 右侧面板头部新增「Agent 对话 | 记忆」标签切换 | ✅ 本次 |

## 三、新增能力 UI 组件（Phase C）— 已落地

> 依据：CAPABILITY_EXPANSION_PLAN.md 3.1~3.6、UPDATE 原阶段一。均为**新增**组件，经 `App.tsx` 右侧面板「能力」标签统一接入，不改减现有 UI。配套 `taskStore` / `pluginStore` 采用 Zustand 落地。

| 步骤 | 实际文件 | 说明 | 状态 |
|---|---|---|---|
| C0 | `src/renderer/stores/taskStore.ts` | 定时任务 CRUD + 触发 | ✅ |
| C0b | `src/renderer/stores/pluginStore.ts` | 插件列表 + 启用/停用 | ✅ |
| C1 | `components/editor/CodeEditor.tsx` | 轻量代码编辑器（行号 + 保存/复制），Monaco 留待后续 | ✅ |
| C2 | `components/diff/DiffViewer.tsx` | Diff 预览 + 行级审查意见；`parseDiff` 解析 + 示例数据 | ✅ |
| C3 | `components/diagram/DiagramDesigner.tsx` | standalone HTML 图表 iframe 渲染 + 导出 | ✅ |
| C4 | `components/research/EvaluationMemo.tsx` | 评估备忘录加权评分/对比表 | ✅ |
| C5 | `components/files/FileManager.tsx` | 分类 / 重命名 / 复制 / 删除 / 刷新示例 | ✅ |
| C6 | `components/slides/SlideDeck.tsx` | HTML 幻灯片播放 / 全屏 | ✅ |
| C7 | `components/report/HtmlReportExport.tsx` | Markdown→HTML 渲染 + 导出 | ✅ |
| C8 | `components/tasks/TaskPanel.tsx` | 任务增删 + 暂停 + 立即执行（接 taskStore） | ✅ |
| C9 | `components/plugins/PluginPanel.tsx` | 插件过滤 + 启用/停用（接 pluginStore） | ✅ |
| C10 | `components/capabilities/CapabilitiesHub.tsx` | 能力工具箱：9 项能力入口 + 单项展开；`App.tsx` 增加「能力」标签 | ✅ |

## 四、服务层与 Skill 集成（Phase D）

> 依据：CAPABILITY_EXPANSION_PLAN.md 1.5~1.14。多数需要 `npm install` 或原生/CLI 依赖，按项目可落地性排序。

| 步骤 | 实际/计划文件 | 说明 | 状态 |
|---|---|---|---|
| D1 | `services/pdf.ts` + `docSummarizer.ts` | pdf-inspector（`@firecrawl/pdf-inspector`）封装 PDF 分类/提取 | 🔜 需 npm |
| D2 | `services/ocr.ts` + `avery.ts` | open-code-review 行级代码审查桥接 | 🔜 需 npm |
| D3 | `skills/diagram-design/`（SKILL.md + references/type-*.md） | diagram-design Skill 嵌入，供 Atlas 生成编辑级 HTML | 🔜 待嵌入 |
| D4 | `services/toolRegistry.ts` + `codeRouter.ts` | reverse-skill 快速阶梯路由结构借鉴（仅 JSON/测试模式） | 🔜 |
| D5 | `memory/types.ts` + `services/codeGraph.ts` | TencentDB 概念 L0-L3 蒸馏 + 代码调用关系 | 🔜 |
| D6 | `services/scheduler.ts` + `stores/taskStore.ts` + `store/notificationStore.ts` | 定时任务与通知 | 🔜 |
| D7 | `services/larkConnector.ts` / `seedream.ts` / `seedance.ts` + `stores/pluginStore.ts` | 插件服务 | 🔜 |
| D8 | `services/agentReach.ts` / `services/codebaseMemory.ts` | Agent Reach（需 pip）、codebase-memory-mcp（需原生二进制） | 🔜 依赖用户环境 |
| D9 | `api/platformAPI.ts` | 新增 `diff()` / `fileWatch()` 方法签名（neutralino/electron 实现） | 🔜 |

## 五、最终接线与验证（Phase E）

| 步骤 | 说明 | 状态 |
|---|---|---|
| E1 | CodeEditor/DiffViewer/FileManager 接 `fs` / `diff()` API | 🔜 依赖 D 阶段 |
| E2 | EvaluationMemo→Audrey、SlideDeck→Arthur、TaskPanel→taskStore、PluginPanel→pluginStore、DiagramDesigner→Atlas | 🔜 依赖 D 阶段 |
| E3 | 全量 Vitest 编译验证 | ✅ 现改 `npm run build` 通过 |

---

## 本次已落地改动清单

1. **记忆系统接通**：`main.tsx` 初始化 `MemoryStore` 并注入 `registry.ts` → `LeaderAgent`。此前 Oliver 的 `memoryStore` 为空，记忆能力未真正生效。
2. **Oliver 记忆调度**：`leader.ts` 增加记住/回忆/遗忘/统计四个命令分支（`detectMemoryIntent`/`handleMemoryCommand`），并同步更新 systemPrompt，删掉废弃的 `memory` 路由 id。
3. **删除孤儿旧 Agent**：`codeReviewer.ts`（William）、`fileOrganizer.ts`（James）、`memoryAgent.ts`（Sophie）已删除（无任何引入，安全）。
4. **新增记忆面板**：`components/memory/MemoryViewer.tsx`，`App.tsx` 右侧面板头部新增「Agent 对话 | 记忆」标签切换。纯增量，不删减现有 UI。
5. **构建验证**：`npm run build` 通过（exit 0）。

## 第二轮落地改动清单（Phase C 能力面板）

6. **新增 2 个 Zustand 状态**：`stores/taskStore.ts`（定时任务）、`stores/pluginStore.ts`（插件）。
7. **新增 9 个能力组件**：CodeEditor / DiffViewer / EvaluationMemo / FileManager / SlideDeck / HtmlReportExport / DiagramDesigner / TaskPanel / PluginPanel（均按计划 3.x 路径，用完 Brutalist 既有 Tailwind 类）。
8. **新增 CapabilitiesHub 枢纽**：以「能力工具箱」列出 9 项能力并逐项展开；`App.tsx` 右侧面板新增第三个「能力」标签，纯增量接入。
9. **构建验证**：`npm run build` 通过（exit 0）。