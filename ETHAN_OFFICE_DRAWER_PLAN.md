# Ethan × 办公抽屉联动 —— 功能新增策划书

> 版本：v1.0（2026-08-30）
> 状态：待评审（未开始实施）
> 前置版本：v3.0.3（Univer 办公抽屉 + Ethan 表单填写）

---

## 0. 需求理解（我理解的逻辑过程）

你希望把 Ethan（表单填写 agent）和"办公抽屉"（Univer 编辑器）合并成一条新链路：

1. **拉取文件**：Ethan 依旧从本地选一个表格或问卷形式的文档（xlsx/docx 等），提取出待填问题列表 —— 这一步能力不变。
2. **自动导入办公抽屉**：文件拉取后，不再只是"后台解析"，而是把文件内容**自动导入到办公抽屉**——表格类进"工作表页"，文档类进"文档页"——用户能直接在抽屉里看到这份文件。
3. **边问边写**：Ethan 以对话形式逐题提问，用户每回答一题，答案**实时自动写入办公抽屉里对应的空位**，用户全程可视化地看到文档被一点点填满。
4. **收尾产出**：全部填完后，从办公抽屉直接导出成品文件（docx/xlsx），替代（或降级备选）原有的 Word COM / XML 引擎填写路线。

一句话：**把办公抽屉从"独立预览编辑器"升级为"Ethan 填写过程的实时可视化工作台"，同时用 Univer 导出替代脆弱的原地改写引擎。**

---

## 1. 现状调研结论（策划依据）

### 1.1 Ethan 现有链路

| 环节 | 现状 | 关键代码 |
|---|---|---|
| 注册/路由 | id=`form-filler`，Oliver 关键词路由 + 会话锁 | `agents/formFiller.ts:63-68`、`agents/leader.ts:1075-1082`、`components/chat/ChatInput.tsx:174-508` |
| 文件选择 | FileSelector 卡片， Neutralino 读本地文件 | `components/chat/FileSelector.tsx`、`api/neutralino.ts` |
| 问题提取 | 文本提取（docParser）→ 结构分析（docx/xlsxAnalyzer）→ LLM 提取 → 交叉验证，产出 `FormField[]` | `agents/formFiller.ts:92-488` |
| 数据结构 | `FormDocument { filePath, fields: FormField[], currentFieldIndex, status }`；`FormField` 含 `location.type/cellRef/paragraphIndex`、`anchorText`、`constraints` | `agents/formFiller.ts:15-58` |
| 对话式问答 | 纯前端推进：`ChatInput.handleSend` 拦截输入 → `formFillStore.updateField()` → `setCurrentFieldIndex()`，**不调 LLM** | `ChatInput.tsx:191-235`、`stores/formFillStore.ts` |
| 三阶段状态机 | `formFillPhase: 'file-select' → 'select' → 'fill'`，三张卡片（FileSelector/FieldSelector/FormFillView）插在消息列表末尾 | `stores/formFillStore.ts`、`components/chat/ChatView.tsx:18-38` |
| 最终产出 | **原地改写引擎**：书签→窗体控件→Word COM→DOMParser→智能引擎多级降级，校验后另存 `*_filled.docx` 到原目录 | `formFiller.ts:528-889`、`utils/docxHandler.ts`（2057 行）、`FormFillView.tsx:229-433` |

### 1.2 办公抽屉现有架构

| 环节 | 现状 | 关键代码 |
|---|---|---|
| 挂载方式 | App 主 flex 行内**常驻停靠抽屉**（非浮层），`display:none` 保活防白屏，宽度 400–1200 可拖拽 | `components/office/OfficeDrawer.tsx:65-72`、`App.tsx:82` |
| 双实例 | Sheets（`UniverSheetsCorePreset`）与 Docs（`UniverDocsCorePreset`）是**两个独立 Univer 实例**（UI 插件冲突不能共存），Docs 懒初始化 | `services/officeService.ts:50-99`、`OfficePanel.tsx:146-195` |
| 表格写入 | `writeRange()` 只写**活动 sheet**（忽略 sheetName 参数）；`setStyle()`；`createWorkbook()` | `officeService.ts:148-208` |
| 文档写入 | **没有增量 API**——唯一可行路径是 `importDocumentParagraphs → prepareDocsImport（dispose + bumpDocsVersion）→ 容器 remount → flushPendingDocsImport（createUniverDoc 整体重建）`，两阶段异步 | `officeService.ts:254-404`、`OfficePanel.tsx:200-214` |
| 导入入口 | 仅 OfficePanel 工具栏"导入"按钮；表格用 SheetJS 读二维数组逐 sheet `writeRange`（多 sheet 挤进一个活动 sheet，有损）；docx 用 `parseDocxParagraphs`（在 OfficePanel 内部，未抽成公共工具） | `OfficePanel.tsx:276-334` |
| 导出 | `univerAPI.exportFile()` → Blob（sheets→xlsx、docs→docx），前端 `<a download>` 下载，**未打通 Neutralino 落盘** | `officeService.ts:571-592`、`OfficePanel.tsx:240-274` |
| ⚠️ 历史断点 | v3.0.2 曾实现 ```office 指令块 → MessageBubble 执行 → OfficeCard 审批卡；**v3.0.3 整体删除**。现在 `officeParser.ts`/`OfficeCard.tsx` 是死代码，agent 输出的 office 块会原样显示在气泡里 | `utils/officeParser.ts`、`components/chat/OfficeCard.tsx`、git e2af1ae |
| UI 风格 | Neo-Brutalism：2px 黑边框、4px 硬阴影（无模糊）、无圆角、`btn-brutal/card-brutal/tab-brutal`、brutal-yellow/pink/lime/cream 调色板、Space Grotesk 字体、**无暗色模式** | `tailwind.config.js`、`styles/globals.css` |

### 1.3 对本次设计最关键的三条结论

1. **文档页写入 = 整体重建**。每答一题就 dispose + 重建一次 Univer Docs 实例是当前唯一可行路径（officeService.ts:311-322 长注释记录了全部失败尝试），但它是用户-paced 的（一题一写），成本可接受；需要反馈提示掩盖闪烁。
2. **表格写入需要一个"定位"增强**。`writeRange` 忽略 sheetName、只能写活动 sheet；而 `FormField.location.cellRef` 已经携带了目标单元格坐标——正好可以打通"答案 → 指定 sheet 指定单元格"。
3. **office 指令块的基础设施（parser/清洗/卡片）是现成的死代码**，本方案部分复用其模式（结构化块协议 + OfficeCard 展示），但主链路走**程序化服务调用**（formFillStore 直接调 officeService），不依赖 LLM 输出指令块——因为答案收集本来就是纯前端推进的，不需要再绕道 LLM。

---

## 2. 整体方案设计

### 2.1 架构图

```
                         ┌──────────────────────────────────────────────┐
                         │              Ethan 填写会话（现有）             │
 用户选文件 ──► FileSelector ──► extractFieldsFromDoc ──► FieldSelector ──► FormFillView
                     │                    │                  │                │
                     │                    │                  │                │ updateField(答案)
                     │                    ▼                  │                ▼
                     │         ┌────────────────────────┐    │    ┌───────────────────────┐
                     │         │ formFillStore（扩展）    │    │    │  formDrawerSyncService │ ★新增
                     │         │ + drawerSyncMode        │    │    │  (同步桥接层，唯一入口)  │
                     │         │ + drawerSyncEnabled     │    │    └───────────┬───────────┘
                     │         └────────────────────────┘    │                │
                     ▼                                       ▼                ▼
        ┌───────────────────────────────────────────────────────────────────────────┐
        │                        officeService（增强，不破坏现有 API）                  │
        │  importWorkbookSheets()  writeCell(sheet, cell)  activateSheet()           │
        │  importDocumentParagraphs()（现有重建流程）  buildQADocModel()              │
        │  exportWorkbookToBlob()  exportDocumentToBlob()                            │
        └───────────────────────────────────┬───────────────────────────────────────┘
                                            ▼
        ┌───────────────────────────────────────────────────────────────────────────┐
        │   OfficeDrawer（UI 不变，仅加"同步中"徽标） → Univer Sheets / Docs 实例        │
        └───────────────────────────────────┬───────────────────────────────────────┘
                                            ▼ 导出 Blob
        ┌───────────────────────────────────────────────────────────────────────────┐
        │   Neutralino writeBinaryFile → 原目录另存 *_filled.docx / *_filled.xlsx      │
        │   （目标名冲突时自动加时间戳，绝不覆盖原文件/已有成品）                          │
        └───────────────────────────────────────────────────────────────────────────┘
```

核心原则：**新增一个桥接层 `formDrawerSyncService`，作为 formFillStore 与 officeService 之间唯一的同步通道**。Ethan 主流程（提取、问答推进、会话锁）完全不动逻辑，只在三个点位插入钩子调用；所有钩子都受功能开关保护、失败静默降级。

### 2.2 新增/修改文件清单

| 类型 | 文件 | 内容 |
|---|---|---|
| ★ 新增 | `services/formDrawerSyncService.ts` | 同步桥接层：自动导入、答案写入路由（表格/文档两种策略）、导出落盘、异常降级 |
| ★ 新增 | `utils/docxParagraphs.ts` | 从 OfficePanel 抽出的 `parseDocxParagraphs`（原位置改为 re-export，行为不变） |
| 修改 | `services/officeService.ts` | 增强 API（见 3.2），全部为**新增方法**，不改既有方法签名 |
| 修改 | `stores/formFillStore.ts` | 新增 state：`drawerSyncEnabled / drawerSyncMode / drawerSyncError`；`updateField` 尾部加同步钩子 |
| 修改 | `components/chat/FieldSelector.tsx` | 卡片尾部加"同步模式"说明条 + 开始填写逻辑透传开关 |
| 修改 | `components/chat/FormFillView.tsx` | 头部加同步状态徽标；`handleFillComplete` 走新导出分支（开关保护） |
| 修改 | `components/office/OfficeDrawer.tsx` | 标题栏加"Ethan 同步中"徽标（黄底 brutal Badge，复用现有 feedback 条位） |
| 修改 | `stores/pluginStore.ts` 或 `settingsStore.ts` | 新增能力开关 `ethan-drawer-sync` |
| 复用 | `utils/officeParser.ts`、`components/chat/OfficeCard.tsx` | 死代码复活：完成卡片复用 OfficeCard 样式逻辑（见 3.4），指令块 parser 暂不启用 |
| 复用 | `agents/formFiller.ts` | **零修改**（提取逻辑原样复用）；仅 `FileSelector` 成功回调处加一行钩子 |

## 3. 详细技术设计

### 3.1 阶段一：自动导入（选完文件 → 抽屉自动打开并载入内容）

**触发点**：`FileSelector` 确认文件 → `extractFieldsFromDoc` 成功 → 现有代码 `setFormFillPhase('select')` 之前，插入：

```ts
// FileSelector.tsx（伪代码，开关保护）
if (usePluginStore.getState().isPluginEnabled('ethan-drawer-sync')) {
  const mode = await formDrawerSyncService.autoImport(document)  // 'sheets' | 'docs' | 'none'
  formFillStore.setDrawerSyncMode(mode)
}
```

**`autoImport(document: FormDocument)` 的路由策略**：

| 文件类型 | 导入方式 | 抽屉目标 |
|---|---|---|
| `.xlsx/.xls/.csv` | SheetJS `XLSX.read` → 每个 sheet 取二维数组 → `officeService.importWorkbookSheets([{ name, data }])`（新 API，见 3.2） | `officeDrawerStore.open()` + `setActiveKind('sheets')` |
| `.docx` | `parseDocxParagraphs()`（抽公共后的版本）→ `officeService.importDocumentParagraphs(paragraphs, fileName)` | `open()` + `setActiveKind('docs')`；Docs 未初始化时先触发一次初始化流程 |
| `.txt/.md/.html` | `TextDecoder` 拆行 → 同 docx 路径 | 同上 |
| `.pdf` 及其他 | **不支持抽屉导入**，`drawerSyncMode='none'`，走原有纯对话+COM 引擎路线，UI 提示"该格式暂不支持抽屉同步" | 不开抽屉 |

**时序注意**：
- `importDocumentParagraphs` 是两阶段异步（dispose → bumpDocsVersion → 等容器 remount → flush）。`autoImport` 调用后**不等待** remount，只把 pending 数据交出去即可——OfficePanel 现有 useEffect 会自动完成挂载。但抽屉必须**先 open 再导入**（容器在 `display:none` 下初始化会白屏，这是 officeService 已知约束），所以顺序固定为：`open() → setActiveKind() → 导入`。
- 表格导入放弃现有"多 sheet 挤进活动 sheet"的有损做法，改用新 API 重建真实多 sheet 工作簿（原导入按钮行为不变，两条路径并存）。

### 3.2 阶段二：officeService 增强（全部新增方法，不动旧的）

```ts
// —— 表格 ——
importWorkbookSheets(sheets: { name: string; data: (string|number|boolean|null)[][] }[]): OfficeCommandResult
  // 清空当前工作簿 → 按 sheets 逐个建真实命名 sheet → 写入数据
  // 实现：univerAPI.getActiveWorkbook() + workbook.getSheets()/insertSheet() facade

activateSheet(sheetName: string): OfficeCommandResult      // setActive + 视图聚焦
writeCell(sheetName: string, row: number, col: number, value: string|number): OfficeCommandResult
  // 先 activateSheet，再 range.setValue —— 修正 writeRange 忽略 sheetName 的局限，但不改 writeRange 本身

// —— 文档（复用现有重建机制，新增"问答稿模型"）——
buildQADocModel(paragraphs: string[], fields: FormField[]): string[]
  // 生成抽屉文档的文本模型（见 3.3 文档策略）
updateQADocAnswer(fieldIndex: number, answer: string): OfficeCommandResult
  // 在模型中替换该题的答案行 → 走现有 importDocumentParagraphs 重建流程
getDocumentModel(): string[] | null                        // 读当前文档文本模型（内存态）
```

> 依赖修正项：`@univerjs/preset-docs-core` 目前是传递依赖但被直接 import，需显式写入 package.json（顺手修，不属于本功能逻辑）。

### 3.3 阶段三：答案实时同步（核心交互）

**触发点**：`formFillStore.updateField()` 尾部加钩子（所有调用方——ChatInput 通道、FormFillView 通道——都经过这里，一处钩子全覆盖）：

```ts
// formFillStore.updateField 内部，set 完成后：
if (get().drawerSyncEnabled && get().drawerSyncMode !== 'none') {
  formDrawerSyncService.syncAnswer(field, index, value)  // 内部 try/catch，失败只记 drawerSyncError
}
```

**表格同步策略（xlsx）——精准写格**：
1. 从 `FormField.location.cellRef`（如 `C5`）解析行列号；
2. `officeService.writeCell(field.location.sheetName ?? 活动sheet, row, col, value)`；
3. 无 cellRef 的字段（LLM 提取失败/纯文本类）：降级在活动 sheet 末尾追加"问答稿"两列（问题 | 答案），保证答案不丢。
4. 写入后在抽屉 feedback 条显示 `✓ 已写入 C5：张三`（复用现有 `setSheetsFeedback`）。

**文档同步策略（docx）——问答稿模型 + 整体重建**：

由于 Univer Docs 无增量写入 API，采用**内存文本模型 + 每答一题重建一次**：

- 导入时同步生成 QA 模型：对问卷类文档（问题多、占位符少）用**问答稿版式**：

  ```
  【问卷名称】满意度调查表
  
  1. 您的姓名：张三          ← 答一题重建一次，此行实时更新
  2. 所属部门：＿＿＿＿       ← 待填时保留占位下划线
  3. 入职日期：（待填）
  ```

- 对"原文即答案载体"的文档（如合同空位），用**原位替换版式**：在原始段落数组中定位 `location.paragraphIndex` 或 `anchorText`，把占位符（`____`、`（待填）`等）替换为答案，其余段落原样保留。
- 版式选择规则：字段有 location/anchorText → 原位替换；否则 → 问答稿。一个文档内混用（按字段逐个判断）。
- 每次重建用现有 `importDocumentParagraphs(model)` 流程，抽屉 feedback 显示 `✓ 第 3/12 项已写入`。重建是用户-paced 的（答完一题才触发），实测成本可接受；这是当前架构下唯一可靠路径（officeService.ts:311-322 已验证 insertText 等增量方案全部不可行）。

**用户体验细节**（严格 Neo-Brutalism）：
- 抽屉标题栏左侧出现黄底黑字徽标 `● Ethan 同步中`（`bg-brutal-yellow border-2 border-brutal-black font-bold text-[11px]`，与现有状态徽章同款）；会话结束变 lime 底 `✓ 已完成`。
- FormFillView 头部进度条右侧加一枚小徽标 `已同步至办公抽屉`（同步失败时变粉底 `同步失败·仅记录`）。
- **抽屉被用户手动关闭时**：同步继续静默写入（Univer 实例保活于 display:none，写入不受影响），FormFillView 徽标保持正常；重新打开抽屉即可看到全部已填内容。若同步因插件禁用/实例异常失败，自动降级 `drawerSyncMode='none'`，会话照常走原路线——**同步永远不能阻塞问答**。

### 3.4 阶段四：收尾导出（替代原引擎的新出口）

`FormFillView.handleFillComplete` 中，开关开启且 `drawerSyncMode !== 'none'` 时走新分支：

1. `officeService.exportDocument()` / `exportWorkbook()` → Blob；
2. Blob → ArrayBuffer → `platform.fs.writeBinaryFile(目标路径, buffer)`，目标路径规则与现状一致：原文件同目录 + `_filled` 后缀（`报告.docx → 报告_filled.docx`）；
3. **冲突保护**：目标已存在时自动加时间戳（`报告_filled_20260830_1430.docx`），**绝不覆盖**原文件和任何已有成品；
4. 保存后读回验证（沿用现有前 1000 字节比对逻辑）；
5. 完成卡片：在消息流中渲染一张 **OfficeCard**（复活现有组件）：显示文件名 + 状态徽标 `已批准`（lime）+「在抽屉中打开」按钮——与 v3.0.2 的审批卡片交互完全一致，但此处语义为"成果卡片"；
6. `endSession(新文件路径)`，流程收束与现状一致。

**降级链**：导出 Blob 失败（如 Univer 序列化异常）→ 自动回退到现有 `fillDocument` 多级引擎重填并另存 → 再失败 → 走现有重试 UI。原引擎在本版本**完整保留**，新分支只是前置了一个更稳的出口。

### 3.5 明确不做的事（范围控制）

- 不改 Oliver 路由规则、不改问题提取 prompt、不改 FormField 数据结构（只读它的 location 字段）。
- 不改抽屉现有导入/导出按钮的行为。
- 不引入新 npm 依赖。
- 不做 PDF 导入抽屉、不做抽屉内"手改内容回写 Ethan 会话"的双向同步（抽屉内的手动编辑仅保留在导出结果里——这反而是特性：**用户可以在抽屉里手动润色，导出即所得**，策划上作为亮点而非功能开发）。

---

## 4. 实施计划（5 个里程碑，每步可独立回滚）

| 里程碑 | 内容 | 涉及文件 | 交付判据 |
|---|---|---|---|
| **M0 安全垫** | 建分支 `feature/ethan-drawer-sync`；打 tag `v3.0.3-pre-ethan-sync`；加能力开关（默认**关**） | pluginStore/settingsStore | 开关关闭时全应用行为与 v3.0.3 逐像素一致 |
| **M1 基础设施** | 抽出 `parseDocxParagraphs`（原位 re-export）；officeService 增强方法 + 单元自测（window.__debug 手动验证） | utils/docxParagraphs.ts、officeService.ts、OfficePanel.tsx（改 import） | 现有导入/导出按钮回归通过；新 API 控制台可用 |
| **M2 自动导入** | formDrawerSyncService.autoImport + FileSelector 钩子 + 抽屉打开路由 | formDrawerSyncService.ts、FileSelector.tsx、formFillStore.ts | 选 docx→抽屉文档页出现原文；选 xlsx→工作表页出现多 sheet |
| **M3 答案同步** | updateField 钩子 + 表格 writeCell 精准写格 + 文档 QA 模型重建 + 同步徽标 | formFillStore.ts、formDrawerSyncService.ts、FormFillView.tsx、OfficeDrawer.tsx | 答一题，抽屉对应位置立即更新；中途关抽屉不中断 |
| **M4 导出收尾** | Univer 导出落盘 + 冲突保护 + OfficeCard 成果卡 + 降级链 | FormFillView.tsx、formDrawerSyncService.ts | 全部填完 → 原目录出现 `*_filled` 文件，内容与抽屉一致 |
| **M5 收尾** | 全量回归 + README/版本号 v3.1.0 + 合回 master（squash 或保留里程碑提交） | README.md、package.json | 验收清单（第 6 节）全绿 |

每个里程碑独立 commit，提交信息带里程碑号（如 `feat(ethan-sync): M3 答案实时同步`），保证可单点 revert。

---

## 5. 回滚与安全保障（重点回答你的问题）

### 5.1 分层防护总览

```
第 1 层  Git 结构性隔离      → 改坏了代码，revert 一个 commit 就回去
第 2 层  功能开关（kill-switch）→ 代码合进去了，出问题运行时一键关闭，秒回旧行为
第 3 层  代码写入模式约束     → 新逻辑几乎全在新文件，旧文件只加"被开关包裹的钩子"
第 4 层  数据零破坏原则       → 原文件永不触碰，导出永不覆盖
第 5 层  运行时降级           → 任何同步异常静默降级回旧路线，绝不抛进聊天主流程
```

### 5.2 第 1 层：Git 结构性隔离

- **动手前**打 tag `v3.0.3-pre-ethan-sync`，这是"绝对安全点"——任何时候 `git diff tag` 可看到全部改动，`git checkout tag -- .` 可整体还原。
- 全程在 `feature/ethan-drawer-sync` 分支开发，master 在 M5 验收前**不接收任何提交**。
- 每个里程碑一个独立 commit（M0–M5），出问题按里程碑粒度 `git revert <commit>`，不会牵连其他改动。
- 现有惯例的延续：项目已有 `src/renderer/ui-backup/` 的备份习惯，本次 M0 时同样把将被修改的 4 个 UI 文件（FieldSelector/FormFillView/OfficeDrawer/OfficePanel）**先复制到 `ui-backup/ethan-sync-v3.0.3/`** 作为 Git 之外的物理备份，即使 Git 仓库损坏也有兜底。

### 5.3 第 2 层：功能开关（kill-switch）

- 在插件/设置体系里新增能力项 `ethan-drawer-sync`（复用现有 `pluginStore` 的 `univer-office` 同款机制），**默认关闭**。
- 所有新行为入口都在开关判断之后，共 3 个检查点：① FileSelector 自动导入钩子；② formFillStore.updateField 同步钩子；③ handleFillComplete 导出分支。
- 开关关闭 = 三条新路径全部短路，应用行为与 v3.0.3 完全一致。这样即使新代码合入后在线上（你日常使用中）才发现问题，也不需要回滚代码，在设置里关掉开关即可。
- 开关还服务灰度：M2 完成后你可以先开开关只用"自动导入"，M3 后再体验同步，逐步验证。

### 5.4 第 3 层：代码写入模式约束（防止"UI 崩坏"）

- **新逻辑收敛进新文件**：约 70% 新代码在 `formDrawerSyncService.ts` 和 `utils/docxParagraphs.ts` 两个新文件里，不触碰现有组件。
- **旧文件只做"加法"且全被开关包裹**：对 4 个现有 UI 文件的修改均为"尾部追加一段 `{flag && (...)}` 式条件渲染"或"函数尾部追加一行带守卫的钩子调用"，不改动、不重排、不删除任何现有 JSX 结构和样式类。这是防 UI 崩坏的核心约束——**不重写，只追加**。
- **样式零新增发明**：新增 UI 元素（同步徽标、成果卡、模式说明条）全部复用现有 `Badge.tsx`、`Button.tsx`、`card-brutal`/`btn-brutal` 类和 brutal-* 调色板，不新增任何自定义颜色/阴影/圆角。
- **Univer 白屏防线不破坏**：不改 OfficeDrawer 的常驻挂载 + display 切换结构、不改 docsVersion 重建机制、不改 Docs 懒初始化时序——同步逻辑只调 officeService 的既有重建流程，不自建第四种挂载方式。
- `parseDocxParagraphs` 抽取采用**原位 re-export**（OfficePanel 原位置改为 `export { parseDocxParagraphs } from '../utils/docxParagraphs'`），其他引用方无感知，回归风险最低。

### 5.5 第 4 层：数据零破坏（防"误删除"）

- **原文件从始至终只读**：整条新链路对源文件只做 Neutralino 读操作；写入只发生在导出阶段，且只写新文件（`_filled` 后缀）。
- **导出冲突自动改名**：目标路径已存在 → 加时间戳，绝不覆盖原文件或历史成品。
- **抽屉内内容可重建**：文档文本模型、表格写入全部是内存态（Univer 实例内），应用崩溃/重启后源文件仍在，重新发起会话即可完整重来——没有"改坏了源文件"这个失败态。
- **存储键隔离**：formFillStore 新增的 state（drawerSyncMode 等）若涉及 Neutralino storage 持久化，使用新键前缀 `ffsync_`，与现有会话存储键空间不交叉，回滚后旧数据不受污染。

### 5.6 第 5 层：运行时降级（同步永不阻塞问答）

- `formDrawerSyncService` 所有公开方法内部 `try/catch`，任何异常只写入 `drawerSyncError` 并在 UI 显示粉色徽标提示，**绝不向上抛出**，聊天主流程、问答推进、字段收集完全不受影响。
- 同步连续失败 3 次 → 自动置 `drawerSyncMode='none'` 并提示"已切换为仅对话模式"，会话按 v3.0.3 的原路线（COM/XML 引擎）继续走完。
- 插件开关 `univer-office` 被禁用时（抽屉不可用），`ethan-drawer-sync` 自动视为关闭，无需用户处理联动关系。

### 5.7 万一真的崩了：恢复预案

| 场景 | 恢复动作 |
|---|---|
| 某个 UI 文件改坏，界面崩坏 | `git checkout v3.0.3-pre-ethan-sync -- src/renderer/components/xxx.tsx` 单文件还原；或从 ui-backup 物理备份拷回 |
| 整个功能有问题但已合入 master | 设置里关闭 `ethan-drawer-sync`（立即生效）→ 之后 `git revert` M2–M4 的三个 commit |
| Univer 实例异常/白屏 | 现有防线不变（常驻挂载 + docsVersion 重建）；同步服务检测 `docsInitialized === false` 时直接降级为 none 模式 |
| 用户数据担忧 | 源文件全程只读 + 导出不覆盖，最坏情况是"没填成"，不存在"填坏原文件" |

---

## 6. 验收清单（M5 回归用）

**功能主链路**
- [ ] 说"帮我填这份问卷"→ Oliver 路由到 Ethan → 选文件 → 抽屉自动打开并显示文件内容（docx→文档页 / xlsx→工作表页多 sheet）
- [ ] 逐题作答：抽屉内对应位置实时更新（表格=精准单元格，文档=占位替换或问答稿行）
- [ ] 占位文字确认交互（anchorText 字段）在同步模式下仍正常工作
- [ ] 上一个/下一个跳题、AI 生成、约束校验均不受影响
- [ ] 完成导出：原目录出现 `*_filled` 成品，内容与抽屉所见一致；同名冲突自动加时间戳
- [ ] 消息流出现 OfficeCard 成果卡，"在抽屉中打开"可用

**降级与安全**
- [ ] 选 PDF → 提示不支持同步，走原路线正常完成
- [ ] 答题中途手动关闭抽屉 → 同步静默继续，重开抽屉内容完整
- [ ] 手动在抽屉里修改内容后导出 → 手动修改保留（导出即所得）
- [ ] 关闭 `ethan-drawer-sync` 开关 → 全流程与 v3.0.3 行为一致（回归基线）
- [ ] 模拟同步异常（控制台篡改 officeService）→ 3 次后自动降级，问答不中断

**UI 风格一致性**
- [ ] 新增元素均为 2px 黑边框 + 硬阴影 + 无圆角 + brutal-* 配色 + Space Grotesk
- [ ] 抽屉拖宽、页码指示、IME 行为无回归
- [ ] 亮色 cream 主题下视觉无违和（本项目无暗色模式）

---

## 7. 风险清单与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| 文档页每答一题重建编辑器，闪烁感明显 | 中 | 反馈条 + 徽标转移注意力；重建耗时实测约百毫秒级（用户-paced 可接受）；若体验差，M3.5 迭代为"切下一题时才重建"（合并写入） |
| `cellRef` 覆盖率不足（LLM 提取失败时无定位） | 中 | 降级追加问答稿区，答案永不丢；交叉验证逻辑（crossValidateFields）已有，可顺带提高 cellRef 命中率 |
| Univer `exportFile()` 对复杂 docx 还原度有限 | 中 | 本功能产出的抽屉文档本就是我们构建的简单模型（问答稿/占位替换），复杂度可控；导出失败走原引擎兜底 |
| 多 sheet 导入新建 sheet 的 facade API 版本差异 | 低 | M1 先在控制台验证 `insertSheet`/`getSheets` 可用性，不行则退化为"活动 sheet + 分区标题"（保底可用的旧方案） |
| 包体积增加 | 极低 | 零新依赖，纯逻辑复用 |
| vite iife 约束 | 无影响 | 不使用动态 import/懒加载 |

---

## 8. 结论

这个方案的本质是三件事：

1. **打通**：让 Ethan 会话与办公抽屉共享同一份数据流——文件内容进抽屉（自动导入）、答案进抽屉（同步写入）、成品出抽屉（Univer 导出）。
2. **替换出口**：用 Univer 导出这条"所见即所得"的稳定路径前置替代 Word COM/XML 多级引擎，旧引擎完整保留为兜底。
3. **零风险叠加**：新逻辑收敛在 2 个新文件 + 4 个"只追加"的旧文件，外面套功能开关、Git 里程碑提交、tag 安全点、物理 UI 备份、数据零破坏五层防护——任何一层出问题，都有独立的回退手段，且最坏情况也只影响新功能本身，不伤及现有任何能力。

预计工作量：M0–M5 共 5 个里程碑，每个里程碑约为一次可独立验收的小版本；核心开发集中在 M2/M3（自动导入 + 答案同步）。
