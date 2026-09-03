# Univer 移植方案

> 目标：把 [dream-num/univer](https://github.com/dream-num/univer)（开源办公套件 SDK）集成进当前项目 `ai-agent-app`，使其能与现有的多 Agent 系统联动——Agent 生成、预览、审批、导出电子表格 / 文档 / 演示。
>
> 编制依据：本方案严格基于两点——① Univer 官方仓库与文档的**实际读取结论**；② 对现有项目 `package.json`、`vite.config`、`neutralino.config.json`、`App.tsx`、`CapabilitiesHub`、`PluginPanel`、`pluginStore`、Agent 基类、`documentProduction` 等的**逐文件梳理**。
>
> 关键定性：**Univer 是大型办公套件 monorepo，正确做法是「作为 npm 依赖集成」，而不是「拷贝其源码进项目」**。方案中的"移植"均指这一含义。

---

## 0. 前置事实与可行性结论

### 0.1 Univer 官方文档读取到的关键约束

| 项目 | 结论 |
|---|---|
| 集成方式 | 官方提供 **Preset 模式**（开箱即用，20 行起）与 **Plugin 模式**（精细控制、插件级懒加载）两种 |
| 依赖版本 | **必须所有 `@univerjs/*` 包版本号一致**；preset 已包含的插件不得重复 import（会冲突） |
| 包管理器 | 需要 npm@7+（本项目 Node/npm 需确认），Vite 对 ESM `exports` 支持良好 |
| peer 依赖 | react / react-dom / **rxjs**（本项目有 react 18.2，**缺 rxjs，需新增**） |
| 样式 | preset 内含 `.css`；文档明确「先 import `@univerjs/design` 和 `@univerjs/ui` 的 css，再 import 其他插件 css」 |
| 渲染 | 基于 Canvas；依赖 ResizeObserver / WebWorker 等 Web API |
| 懒加载 | preset 仅支持 preset 级懒加载；插件级懒加载需 plugin 模式 |
| Facade API | preset 返回 `{ univer, univerAPI }`，是 Agent 操控的核心入口 |
| Headless | 官方定位「Headless for AI」——浏览器 + Node 都可用 |

### 0.2 现有项目梳理到的关键事实

| 项目 | 现状 |
|---|---|
| 技术栈 | Vite 5 + React 18.2 + TS 5 + Tailwind 3.4 + Zustand，打包到 `resources/` 由 Neutralino 6.8 加载（WebView2 内核） |
| Agent 机制 | **无标准函数调用层**。11 个 Agent 走 `callLLM`，产出为 Markdown 文本，唯一结构化通道是 `\`\`\`handoff` **魔改 Markdown 块**（`base.ts` / `arthur.ts` 解析） |
| 办公能力现状 | 命令式生成：`documentProduction`（docx/pptxgenjs/xlsx）+ `xlsxHandler` 填表；**无可视化编辑、无即时预览、无审批** |
| 能力聚合入口 | `CapabilitiesHub`：9 项能力（code-editor/diff/slides/report/…）通过 `RENDERER` 映射 React 组件，由 `App.tsx` 右侧面板渲染 |
| 插件入口 | `PluginPanel` + `pluginStore`：**目前只是静态 toggle 列表**（启用/停用开关），无真实加载逻辑 |
| 与 WebView 相关 | `neutralino.config.json`：`enableNativeAPI: true`，nativeAllowList 含 `filesystem.*`、`storage.*`；窗口 mode、宽 1400 |

### 0.2b 编译地基约束（关键，必须在样版前确认）

`vite.config.ts` 存在一条**硬约束**，直接决定 Phase 3 的懒加载 / 拆包能否实现：

- 构建为 `format: 'iife'` + `inlineDynamicImports: true` + `target: 'es2015'`
- `neutralinoAdapter` 插件注释明确：**「构建后将 ESM 转为 IIFE + defer（WebView2 不支持 ESM）」**

影响：
1. **`React.lazy` / 动态 `import()` 懒加载对 Univer 不生效** —— `inlineDynamicImports: true` 强制将所有动态 import 内联进单一 bundle，Univer 会被**全量打进主包**，有体积优化但非彻底懒加载。
2. **`manualChunks` 拆 vendor chunk 与 `inlineDynamicImports: true` 冲突** —— 二者同时配置会有问题。

> 因此方案的**真正地基风险不是 Tailwind 冲突，而是这条编译约束**。Phase 3 必须在此之前先做一次「是否调整 vite 构建」的评估（见 Phase 3 前置步骤）。

### 0.3 可行性结论

- **可行**，且与项目生态（React + Vite + ESM）兼容性很好。
- **三个主要风险点**（方案第三章展开）：
  1. **包体积大** → 劳动量评估：因 0.2b 的 `inlineDynamicImports`，懒加载可能失效，需先决定「接受全量打包」还是「调整 vite 构建」（Phase 3 前置步骤）。
  2. **Tailwind 3.4 与 Univer 自带 CSS / 主题冲突** → 需要样式隔离策略。
  3. **Agent 没有函数调用层** → 需沿用 `handoff` 块模式扩展 `\`\`\`office` 协议，而不是强行引入框架。

---

## 1. 所有移植方案（择优）

按「侵入度从低到高」给出三条可行路线 + 一条否决路线。

### 方案 A（推荐）：Univer 作为依赖集成 + `office` 块协议（与 handoff 同构）

**思路**：不引入任何新的函数调用框架。把 Univer 包成项目内的 `OfficeService` 单例，Agent 通过 `\`\`\`office {…}` 结构化块驱动它，UI 通过新增能力页提供可视化编辑。完全沿项目现有模式。

**依赖**：
```bash
npm install rxjs
npm install @univerjs/presets @univerjs/preset-sheets-core @univerjs/preset-docs-core @univerjs/preset-slides @univerjs/preset-base
```
（版本必须一致；若需 UI 预设再补 @univerjs/preset-sheets-ui / preset-docs-ui / preset-slides-ui）

**新增/改动文件清单**：
```
src/renderer/utils/officeParser.ts        # 新增：解析 ```office 块
src/renderer/services/officeService.ts    # 新增：Univer 单例 + Facade API 封装（唯一隔离层）
src/renderer/components/office/OfficePanel.tsx   # 新增：Univer 容器（挂载+编辑）
src/renderer/components/chat/OfficeCard.tsx      # 新增：对话里的审查/审批卡片
src/renderer/stores/officeStore.ts       # 新增：workbook 列表 / draft,ready 状态
src/renderer/agents/arthur.ts             # 改：systemPrompt 增加 office 指令说明
src/renderer/components/capabilities/CapabilitiesHub.tsx  # 改：新增「办公文档」能力项 + RENDERER 映射
src/renderer/components/plugins/pluginStore.ts            # 改：新增 univer 插件开关项
src/renderer/App.tsx                     # 改：路由/面板按需加载 OfficePanel
vite.config.ts                           # 改（可选）：手动 chunk 拆分 @univerjs
```
**与 Agent 联动方式**：Arthur（文档/演示专家）在回答中输出 office 块；前端解析后交给 `officeService` 执行，并把结果以 OfficeCard 呈现；视觉编辑、审批、导出在 OfficePanel 完成。

**优点**：改动局部、贴合现有代码风格、不依赖新架构、可逐步交付。**缺点**：office 块协议是伪函数调用，指令集需自行定义；复杂长链任务不如真函数调用灵活。

---

### 方案 B：改造为真「函数调用」层，再挂 Univer 工具

**思路**：给你的 Agent 引入标准 function-calling（`callLLM` 支持可选的 `tools` 参数，收到 `toolCall` 后执行 `OfficeService` 并对结果二次聚合）。然后 `office_create_sheet` / `office_write_cells` / `office_export` 注册为正式工具。

**优点**：更通用、模型会按 schema 自组织多步调用，适合复杂文档任务。**缺点**：需要动 `base.ts` / `llm.ts` 的调用循环，所有 Agent 的提示都受影响，回归风险大——**且这是独立于 Univer 的大改动**。

> 建议：**不在本次一并做**。先走方案 A 把 Univer 立起来，将来若要函数调用层，再把 office 指令升级成正式 tool 即可，`OfficeService` 保持不变。

---

### 方案 C：最小视觉验证（PoC / 试运行）

**思路**：只装 Sheet preset + 一个 `OfficePanel` + `create_sheet`/`write_cells` 两条指令，跑通「创建 → 写入 → 导出 .xlsx」，用来在动手大改前验证三件关键事：**WebView2 Canvas 渲染是否正常、打包体积/首载是否可接受、Tailwind/CSS 是否冲突**。若 PoC 不通过，则退回现有方案，不投入后续工作。

**优点**：成本最低，最安全。**建议作为第一步执行**，通过后再扩展方案 A 的其余部分。

---

### 方案 D（否决）：把 Univer monorepo 源码直接拷进项目

**原因**：Univer 是 pnpm workspace 的大型 monorepo、按功能拆分成几十个 `@univerjs/*` 包，直接拷贝既无法脱离其构建体系单独工作，也会和当前 npm + Vite 架构冲突；且失去「跟上游版本走」的便利。**不可取。**

---

### 编制结论

> **路线 = 先「方案 C」验证，通过后按「方案 A」落地；未来有复杂文档需求时再评估「方案 B」。** 方案 D 明确否决。

---

### 设计原则（贯穿全程）

**本原则分两部分：约束项与自由项。**

#### 约束项（唯一硬性约束）—— UI 与交互

> **UI / 交互方面的设计改动，必须遵循现有的设计风格和设计逻辑。**

- 新页面、卡片、按钮沿用现有 `brutal` 设计风格（`border-2 border-brutal-black`、`shadow-brutal`、`bg-brutal-*` 色板等），不引入另一套视觉语言。
- `OfficePanel`、`OfficeCard` 的布局与现有 `CapabilitiesHub` / 聊天卡片保持一致。
- 交互逻辑（折叠 / 选中高亮 / hover 浮起 / active 按下）与现有组件节奏统一。
- 任何 UI 取舍与现有风格冲突时，以项目现状为准。

#### 自由项（以方便、高效、功能最大化优先）—— 不强制贴合现有

以下三点不受"贴合现有"约束，**以如何方便、如何高效、如何让功能实现最大化来设计**，可在必要时偏离或重构现有做法。**但自由不等于随意**，每项都带一条"风险红线"作为底线：

1. **代码组织**
   - 不强制对齐现有 `utils/` / `services/` / `stores/` 目录约定；可引入新目录结构、聚合一文件、改命名风格，使代码更内聚、更易维护、更少文件。
   - 目标：模块边界清晰、职责单一、后续扩展成本最低。
   - **风险红线（防结构漂移）**：一旦偏离，必须把新结构、命名习惯先在此文档 / 对应模块 README 中记录；office 相关文件要自成**封闭区块**，与主结构边界清晰，避免同项目两套风格并存。

2. **状态管理**
   - 不强制使用现有 Zustand 模式；可引入更能承载 office 复杂状态（工作簿、草稿/审批、编辑器实例）的机制。目标是状态读写高效、少重复、编辑器与业务状态解耦，而非"和现有一致"。
   - **风险红线（防两套心智 + 硬引入）**：
     - **优先复用** Zustand——只有能**证明**现有模式确实承载不了 office 状态时，才引入新状态库/新模式；
     - **编辑器实例（Univer 的 `univerAPI`）是非响应式外部可变对象，天然应放在 store 之外（模块级单例）**，不应硬塞进 reactive store——这是正确设计，不算"偏离 Zustand"；
     - 新机制必须能明确量化"收益更大"，禁止为引入而引入。

3. **Agent 交互**
   - 不强制沿用既有 `handoff` 块范式；可另起设计更适合 Univer 的结构化指令机制，目标是让 Agent "生成 → 编辑 → 审批 → 导出"链路最顺、最可靠、最易扩展。
   - **风险红线（防静默失败）**：无论新旧机制，都必须具备：
     - ① 明确的解析**成功/失败信号**；
     - ② 失败时对用户的**可见提示**（不允许静默无响应）；
     - ③ 先以**最小可用的 Parser** 跑通链路，再谈机制优化。

#### 优先级

当约束项与自由项发生冲突时：**UI/交互严格照现有风格；代码组织、状态管理、Agent 交互优先便捷、高效、功能最大化——且在不触发上述风险红线的前提下。**

---

## 2. 推荐实施方案（方案 C → A）详细步骤

### Phase 0：前置检查（不改代码）
- [ ] 确认 `node -v` / `npm -v`（需 npm@7+）
- [ ] 备份当前可运行版本：`git tag univer-baseline` 或提交一个基线 commit
- [ ] 记录当前 `npm run neu:build` 的成功与否，作为自检基线

### Phase 1：最小验证（方案 C）
1. 安装依赖：`npm i rxjs @univerjs/presets @univerjs/preset-sheets-core`
   - 注意：`@univerjs/presets` 默认带 Sheets；保证三者版本一致
2. 新增 `components/office/OfficePanel.tsx`：import `createUniver` from `@univerjs/presets`，`import '@univerjs/preset-sheets-core/lib/index.css'`，`useEffect` 里 `createUniver({ locale, locales, presets: [UniverSheetsCorePreset({ container: 'office-app' })] })`，再 `univerAPI.createWorkbook({})`
3. 放一个临时按钮触发 `univerAPI.getActiveWorkbook()` 写入测试数据
4. 在 `CapabilitiesHub` 临时加 `office` 能力项指向该面板
5. `npm run neu:dev`，人工验证渲染 + 导出
6. **记录关键指标**（进入自检清单章节）：首屏耗时、打包体积、是否有 Canvas/Worker 报错

### Phase 2：Service 隔离层 + office 协议（方案 A 主体）
1. 新增 `services/officeService.ts`：封装 `createUniver`、`univerAPI`，对外暴露稳定方法（`createWorkbook / writeRange / setStyle / importFile / exportFile`），把业务代码与 Univer 内部 API 隔离
2. 新增 `utils/officeParser.ts`：解析 `\`\`\`office {json}` 块（参照既有 handoff 解析）
3. 改造 `arthur.ts`：systemPrompt 声明可用 office 指令；输出块由 `officeParser` 捕获执行
4. 新增 `stores/officeStore.ts`：`workbooks: { id, name, state: 'draft'|'ready', cells... }`，实现草稿隔离 + 审批
5. 新增 `components/chat/OfficeCard.tsx`：在对话流里展示「草稿 / 批准 / 丢弃」卡片

### Phase 3：样式隔离与优化

> **前置步骤（必须先做）—— 编译地基评估**：当前 `vite.config.ts` 为 `iife + inlineDynamicImports`（见 0.2b），会让「懒加载 + 手动 chunk」失效。本阶段开始前先决策：
> - 方案 X（保守）：**接受 Univer 全量打进主包**，仅做样式隔离；跳过懒加载/拆包，代价是包体积增大。
> - 方案 Y（激进）：**调整 vite 构建以支持 code-splitting**（移除 `inlineDynamicImports`、改用多 entry 或做 Neutralino 的 ESM 适配），再配合懒加载与手动 chunk。此改动的风险最低也应先行验证 WebView2 是否正常加载拆分产物。
> - 决策依据：先 `npm run build` 实测 Univer 全量体积，若可接受选 X，不可接受再进 Y。
>
> 1. Tailwind 冲突处理：将 Univer 容器包进一个**独立作用域**（如给 OfficePanel 外包一层加类名的 wrapper，仅在其内复用 Univer CSS；或按官方用 `@univerjs/design` + `@univerjs/ui` 显式引样式）
> 2. 懒加载（仅在选方案 Y 时生效）：`OfficePanel` 用 `React.lazy(() => import('./office/OfficePanel'))` + Suspense，进应用不预载；若保持方案 X，则缺少此项、依赖上述体积评估兜底
> 3. 体积控制：仅方案 Y 时可用 `build.rollupOptions.output.manualChunks` 把 `@univerjs/*` 拆成独立 vendor chunk，且需先确保与 `inlineDynamicImports` 解除冲突
> 4. 中文 locale：按各 preset 包的 **zh-CN locale 实际导出路径**引入（如 `@univerjs/presets` 及各 `preset-*` 包各自提供 locale），实测确认后再写入，不要在未验证前写死假设路径

### Phase 4：接入现有办公能力（复用而非推翻）
- 导入：用现有 `xlsxHandler` 解析 `.xlsx` → 写入 Univer
- 导出：Univer export → 走现有 `documentProduction` 或 Univer 自带导出，生成可下载文件
- 文档/演示：按需补 `preset-docs-core` / `preset-slides` 设 Set

### Phase 5：与插件系统对接
- `pluginStore` 新增 `{ id: 'univer-office', name: '办公文档', enabled: false }`，在 `PluginPanel` 显示开关；开关联动 OfficePanel 的懒加载（未启用则不挂载）

---

## 3. 一旦出现问题如何回撤

> 原则：**每一阶段结束时都可独立回退，不产生不可逆破坏。**

### 3.1 细粒度回退（靠 git）
- **git 是主回撤手段**：每阶段开始前 `git stash` 或提交基线；失败则 `git checkout -- <改动的文件>` 或 `git reset --hard <baseline-tag>`。
- 基线 tag：`univer-baseline`（Phase 0）、`univer-phase1`、`univer-phase2` … 每阶段完成后打一个。

### 3.2 分阶段回退动作表

| 出现的问题 | 回退动作 | 影响范围 |
|---|---|---|
| Univer 页面白屏 / Canvas 未渲染 | 删除 `OfficePanel` 与 `CapabilitiesHub` 里对应能力项，回到原有能力列表 | 仅 UI |
| 首启变慢（懒加载失效） | 检查 OfficePanel 是否被 **React.lazy** 包裹；未包则补上；仍慢则移除 office 入口 | 仅加载时序 |
| Tailwind 样式被 Univer 污染 | 用 CSS 作用域隔离或移出 Univer 引入的全局 css import | 仅样式 |
| Agent 输出 office 块没被解析（静默） | 移除 `arthur.ts` systemPrompt 中 office 说明，`officeParser` 遇未知块**直接忽略并提示用户**（不回退其他逻辑） | 仅解析 |
| 打包体积/内存超限不可接受 | 卸载 preset：`npm rm @univerjs/* rxjs`；删除 office 相关 store/组件；恢复 baseline | 依赖 + 代码 |
| WebView2 出现 WebWorker / 线程报错（Neutralino 同源受限） | 停止使用需要 Worker 的特性，退回首域线程可承载的编辑能力；或调 `neutralino.config.json` 相关参数验证 | 仅运行时 |

### 3.3 强制回退（整仓库回滚）
- **最后手段**：`git reset --hard <baseline-commit>` + `npm install`（因 package.json 已回滚）重新装回原依赖。
- 由于 OfficeService 是**纯新增 + 局部改动**（新增 store/component/service，arthur/pluginStore/CapabilitiesHub 仅增量添加），理论上整仓库回滚不影响已有 Agent 与办公生成能力。

> 设计核心：**新增文件与存量代码解耦**。`officeService` 不在现有 `documentProduction` 内部改，而是新模块，这样一旦出问题，存量功能完全不受牵连。

---

## 4. 一些自检的措施

### 4.1 构建与启动自检
- [ ] `npm run build` 无 TS/打包错误；`npm run neu:build` 成功，`resources/` 产物正常
- [ ] 应用启动后，**不完全启用 Univer 时**（未打开 OfficePanel / 未开启插件开关）首屏行为与改造前一致
- [ ] 打开 OfficePanel，控制台无 `<PROXY>` / Univer 崩溃报错；Canvas 正常画出网格

### 4.2 功能自检
- [ ] `create_sheet`：创建后 UI 出现新工作表
- [ ] `write_cells`：指定区域写入后，界面单元格可见且可再编辑（验证「交互式编辑」链路）
- [ ] 导出：生成 `.xlsx` 可被 Excel / 现有 `xlsxHandler` 打开
- [ ] 审批流：draft 状态下用户可看到、可丢弃；批准后才进入正式版可导出
- [ ] office 块功过兼容：非法/未知 office 块被优雅忽略，不打断对话

### 4.3 回归自检（关键：不影响现有 Agent 生态）
- [ ] 逐个 Agent 对话正常返回（尤其 Leader / Atlas / Aurora / Avery 等不涉及 office 的）
- [ ] 现有 `documentProduction`（docx/pptx/xlsx 生成）仍可用
- [ ] `handoff` 块链路不受 `officeParser` 新增影响
- [ ] 切换 API Key 后 Agent 模型自动跟随（上一版本修复的功能）依旧生效

### 4.4 性能自检
- [ ] 首屏 DOMContentLoaded 时间与改造前对比：未被启用时（未打开 OfficePanel / 插件未启用）应接近持平
- [ ] 若已调整 vite 构建以支持 code-splitting（Phase 3 方案 Y）：`resources/assets/` 中 `@univerjs` chunk 独立、仅在需要时加载；若保持方案 X（全量打包），确认 `npm run build` 实测体积在可接受范围内
- [ ] 大工作簿（如 500×500 单元格写入）滚动/编辑无卡顿

### 4.5 兼容性自检（Neutralino / WebView2）
- [ ] 确认 WebView2 支持 Canvas、ResizeObserver、WebWorker（Neutralino 6.8 默认 Chromium 内核一般支持，需实测）
- [ ] `npm run neu:dev`（桌面壳）与 `npm run dev`（浏览器）行为一致；如有差异，以桌面壳为准

---

## 5. 验收清单（DoD）

- [ ] Univer 作为依赖集成，版本一致，`package.json` 可复现安装
- [ ] 新增 `officeService` 唯一隔离层，业务代码不直接依赖 Univer 内部 API
- [ ] Agent 可通过 office 块创建/编辑/导出电子表格，界面可视化编辑 + 审批流可用
- [ ] 懒加载 + 手动 chunk 生效，不影响应用首启
- [ ] Tailwind / Univer 样式不互相污染
- [ ] 存量 Agent、`handoff`、`documentProduction`、多模型切换全部回归通过
- [ ] 每阶段打 tag，回退路径清晰（见第三章）

---

*本方案由对 Univer 官方文档与现有项目代码的逐文件核查得出。建议先执行 Phase 1（方案 C）最小验证，通过后再推进。*