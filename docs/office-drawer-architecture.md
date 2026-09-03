# 办公抽屉文档渲染架构方案

## 1. 概述

本文档描述办公抽屉中文档导入/渲染的整体技术架构、当前面临的核心问题及多种解决方案。

## 2. 现有架构分析

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│  OfficePanel.tsx                                        │
│  ┌──────────────────────────────────────────────────┐   │
│  │  sheets 容器 (UniverSheetsCorePreset)            │   │
│  │  docs 容器 (UniverDocsCorePreset)                │   │
│  └──────────────────────────────────────────────────┘   │
│  ↕ 导入/导出 操作                                       │
├─────────────────────────────────────────────────────────┤
│  officeService.ts                                       │
│  ┌──────────────┐  ┌──────────────────────────────┐     │
│  │ buildDocData │  │ buildDocDataFromRich          │     │
│  │ (纯文本路径)  │  │ (富结构路径: 段落+表格+合并)  │     │
│  └──────────────┘  └──────────────────────────────┘     │
├─────────────────────────────────────────────────────────┤
│  docxParagraphs.ts                                      │
│  ┌───────────────────┐  ┌────────────────────────┐     │
│  │ parseDocxParagraphs │  │ parseDocxRichDocument  │     │
│  │ (旧: 纯段落提取)    │  │ (新: 富结构解析)        │     │
│  └───────────────────┘  └────────────────────────┘     │
├─────────────────────────────────────────────────────────┤
│  formDrawerSyncService.ts                               │
│  (Ethan 表单填写同步)                                    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 DOCX 导入渲染管线

```
DOCX(.docx) ──→ PizZip 解压 ──→ DOMParser ──→ DocxRichDocument
                                                     │
                     ┌───────────────────────────────┘
                     ▼
        buildDocDataFromRich(doc, pageWidth)
                     │
                     ├── dataStream (控制符序列)
                     │   ┌──────────────────────────────┐
                     │   │ \u001A  TABLE_START          │
                     │   │ \u001B  TABLE_ROW_START      │
                     │   │ \u001C  TABLE_CELL_START     │
                     │   │ text... \r                   │
                     │   │ \n \u001D  TABLE_CELL_END   │
                     │   │ \u000E  TABLE_ROW_END        │
                     │   │ \u000F  TABLE_END            │
                     │   └──────────────────────────────┘
                     ├── paragraphs (每个 \r 的索引)
                     ├── sectionBreaks (每个 \n 的索引)
                     ├── textRuns (样式: 粗体/字号/字体)
                     ├── tables (tableId → startIndex/endIndex)
                     └── tableSource (tableId → {tableRows, tableColumns, ...})
                     │
                     ▼
        createUniverDoc({ id, body: {...}, tableSource: {...} })
                     │
                     ▼
        Univer 内部渲染管线
                     │
                     ├── parseDataStreamToTree (扁平→树)
                     ├── _buildTableCache (tableId→tableSource 映射)
                     ├── createTableSkeleton (表格骨架: 列宽、行高)
                     ├── applyMergedCellSpanHeights (合并单元格高度)
                     └── 绘制到画布
```

### 2.3 核心数据结构

**UDM (Univer Document Model) 的核心约束：**

| 数据 | 类型 | 说明 |
|------|------|------|
| `dataStream` | 字符串 | 含控制符的扁平文本流 |
| `paragraphs` | 数组 | 每个元素有 `startIndex` 指向 `\r` 位置 |
| `sectionBreaks` | 数组 | 每个元素有 `startIndex` 指向 `\n` 位置 |
| `textRuns` | 数组 | 每个元素有 `st`/`ed` 指向文本范围 |
| `tables` | 数组 | 每个元素有 `tableId`/`startIndex`/`endIndex` |
| `tableSource` | 对象 | `{ [tableId]: ITable }` 描述表格元数据 |

**关键约束：** 以上所有数组的索引必须精确对齐，**任何一个字符的偏移错误都会导致整个表格渲染错乱，且错误会级联放大。**

## 3. 核心问题分析

### 3.1 根本原因：模型不匹配

```
DOCX (XML 树结构)         Univer (扁平控制符序列)
─────────────────         ───────────────────────
<w:tbl>                   \u001A
  <w:tr>                    \u001B
    <w:tc>                    \u001C
      <w:p>text</w:p>          text\r\n
    </w:tc>                  \u001D
  </w:tr>                  \u000E
</w:tbl>                  \u000F
```

- **DOCX 是树结构**：标签嵌套自然表达父子关系，渲染器遍历树即可
- **Univer 是扁平结构**：控制符标记起止，渲染器需先解析为树，再渲染
- **转换过程是"有损压缩"**：列宽单位、边距单位、边框单位不同，需要换算

### 3.2 已知问题清单

| # | 问题 | 状态 | 难度 |
|---|------|------|------|
| 1 | 列宽推导：WPS 导出文档缺少 `<w:tblGrid>` | ✅ 已修复 | 中 |
| 2 | colCount 未随列宽推断更新 | ✅ 已修复 | 低 |
| 3 | padRow 列数计算错误（用 row.length 而非 colSpan 之和） | ✅ 已修复 | 中 |
| 4 | vMerge continue 占位格错误设了 columnSpan=0 | ✅ 已修复 | 中 |
| 5 | 字符串枚举值代替数字枚举（如 'start' 而非 0） | ✅ 已修复 | 高 |
| 6 | tableColumns 长度与 colCount 不匹配 → 渲染引擎崩溃 | ⚠️ 待验证 | 高 |
| 7 | dataStream 中控制符数量与 tableSource 不一致 | ⚠️ 待验证 | 高 |
| 8 | 多表格文档中 tableId 冲突 | ⚠️ 待验证 | 中 |
| 9 | 表格后段落 startIndex 未正确指向 \r | ⚠️ 待验证 | 中 |
| 10 | 嵌套表格（表中表）不支持 | ❌ 未处理 | 极高 |
| 11 | 行高（trHeight）未从 DOCX 解析 | ❌ 未处理 | 低 |
| 12 | 单元格背景色（shd）未解析 | ❌ 未处理 | 低 |
| 13 | 段落缩进/间距未从 DOCX 解析 | ❌ 未处理 | 中 |
| 14 | 列宽缩放比例不精确，导致表格超出/小于页面 | ⚠️ 待验证 | 中 |

### 3.3 渲染引擎的黑盒风险

`createTableSkeleton` 函数在处理以下情况时，引擎内部可能崩溃：

1. `tableColumns` 长度与 `tableRows` 中实际单元格数不匹配
2. 合并单元格的 `rowSpan`/`columnSpan` 导致列数不一致
3. 表格宽度超出页面宽度时，引擎内部布局计算溢出

**这些代码在 `node_modules` 中，我们无法修改，只能通过调整输入数据来规避。**

## 4. 方案 A：修复当前 UDM 转换（推荐，保留编辑能力）

### 4.1 总体策略

**核心思路：** 加入验证层，在数据写入 Univer 之前检查所有约束，确保 `dataStream`、`paragraphs`、`tables`、`tableSource` 完全一致。

### 4.2 实施步骤

#### 步骤 1：增加 UDM 验证器

在 `officeService.ts` 中新增 `_validateUDM(body, tableSource)` 方法，检查：

```typescript
/**
 * 验证 UDM 结构的一致性。
 * 返回所有发现的错误，如果无错误则返回空数组。
 */
private _validateUDM(body: any, tableSource: Record<string, any>): string[] {
  const errors: string[] = []
  const ds = body.dataStream

  // 1. 检查 dataStream 以 \n 结尾
  if (!ds.endsWith('\n')) {
    errors.push('dataStream 必须以 \\n 结尾')
  }

  // 2. 检查控制符配对
  const tableStarts = (ds.match(/\u001A/g) || []).length
  const tableEnds = (ds.match(/\u000F/g) || []).length
  if (tableStarts !== tableEnds) {
    errors.push(`TABLE_START(${tableStarts}) 与 TABLE_END(${tableEnds}) 数量不匹配`)
  }

  const rowStarts = (ds.match(/\u001B/g) || []).length
  const rowEnds = (ds.match(/\u000E/g) || []).length
  if (rowStarts !== rowEnds) {
    errors.push(`ROW_START(${rowStarts}) 与 ROW_END(${rowEnds}) 数量不匹配`)
  }

  const cellStarts = (ds.match(/\u001C/g) || []).length
  const cellEnds = (ds.match(/\u001D/g) || []).length
  if (cellStarts !== cellEnds) {
    errors.push(`CELL_START(${cellStarts}) 与 CELL_END(${cellEnds}) 数量不匹配`)
  }

  // 3. 检查 tables 数组中的每个 startIndex 是否指向 TABLE_START
  if (body.tables) {
    for (const t of body.tables) {
      if (ds[t.startIndex] !== '\u001A') {
        errors.push(`table ${t.tableId} startIndex(${t.startIndex}) 不指向 TABLE_START`)
      }
      if (ds[t.endIndex] !== '\u000F') {
        errors.push(`table ${t.tableId} endIndex(${t.endIndex}) 不指向 TABLE_END`)
      }
      // 检查 tableSource 存在
      if (!tableSource || !tableSource[t.tableId]) {
        errors.push(`table ${t.tableId} 在 tableSource 中不存在`)
      }
    }
  }

  // 4. 检查 paragraphs 的 startIndex 指向 \r
  if (body.paragraphs) {
    for (let i = 0; i < body.paragraphs.length; i++) {
      const idx = body.paragraphs[i].startIndex
      if (ds[idx] !== '\r') {
        errors.push(`paragraphs[${i}] startIndex(${idx}) 不指向 PARAGRAPH(\\r)`)
      }
    }
  }

  // 5. 检查 sectionBreaks 的 startIndex 指向 \n
  if (body.sectionBreaks) {
    for (let i = 0; i < body.sectionBreaks.length; i++) {
      const idx = body.sectionBreaks[i].startIndex
      if (ds[idx] !== '\n') {
        errors.push(`sectionBreaks[${i}] startIndex(${idx}) 不指向 SECTION_BREAK(\\n)`)
      }
    }
  }

  // 6. 检查 tableSource 中 tableColumns 长度与 tableRows 列数一致
  if (tableSource) {
    for (const [id, table] of Object.entries(tableSource)) {
      const colCount = (table as any).tableColumns?.length ?? 0
      for (let ri = 0; ri < ((table as any).tableRows?.length ?? 0); ri++) {
        const row = (table as any).tableRows[ri]
        const actualCells = row.tableCells?.filter((c: any) => !c.rowSpan || c.rowSpan > 0).length ?? 0
        if (actualCells > 0 && actualCells !== colCount) {
          errors.push(`table ${id} 第 ${ri} 行: 实际单元格(${actualCells}) 与列数(${colCount}) 不匹配`)
        }
      }
    }
  }

  return errors
}
```

**作用：** 在 `buildDocDataFromRich` 返回前调用此验证器，提前发现错误并打印到控制台，而不是等到渲染出问题。

#### 步骤 2：修复 textRuns 的 st/ed 指向

当前 `textRuns` 的 `st`/`ed` 指向文本范围，但 `paragraphs` 的 `startIndex` 指向 `\r`。如果 `textRuns` 跨段落，会导致渲染器把样式应用到错误范围。

检查 `buildDocDataFromRich` 中 `pushParagraph` 函数，确保每个 run 的 `st` 和 `ed` 只在本段落内：

```typescript
// pushParagraph 中：
for (let i = 0; i < p.runs.length; i++) {
  const run = p.runs[i]
  const isLast = i === p.runs.length - 1
  const runStart = dataStream.length
  dataStream += run.text
  const runEnd = dataStream.length
  if (runEnd > runStart) {
    const ts: any = {}
    // ... 样式设置
    if (Object.keys(ts).length) {
      textRuns.push({ st: runStart, ed: runEnd, ts })
    }
  }
  if (isLast) {
    dataStream += T.PARAGRAPH
    paragraphs.push({ startIndex: dataStream.length - 1, paragraphStyle: paraStyle })
  }
}
```

**关键检查点：** `st` 必须在段落文本开始位置，`ed` 必须在段落文本末尾（`\r` 之前）。如果 `st` 或 `ed` 跨越了 `\r`，则样式会应用到多个段落。

#### 步骤 3：处理表格后段落

当前代码在表格后插入一个空段落：

```typescript
if (dataStream.endsWith(T.TABLE_END)) {
  dataStream += T.PARAGRAPH
  paragraphs.push({
    startIndex: dataStream.length - 1,
    paragraphStyle: { spaceAbove: { v: 0 }, lineSpacing: 1.5, spaceBelow: { v: 2 } },
  })
}
```

**问题：** 如果表格后紧接着就是文档结尾，这个多余的段落会导致分页错误。

**修复：** 检查表格后是否还有段落块，只有有后续段落块时才插入空段落。

#### 步骤 4：列宽缩放精确化

当前列宽缩放逻辑：

```typescript
const scale = Math.min(1, containerTwip / docxTotalW)
scaledWidths.push(Math.max(MIN_COL_TWIP, Math.round((t.columnWidths?.[i] ?? 0) * scale)))
```

**问题：** `Math.round` 可能导致每列宽度累加后与 `tableWidth` 不一致，进而导致 `tableWidth` 与 `scaledWidths.reduce()` 不匹配。

**修复：** 按比例缩放后，用最后一列补足差值：

```typescript
let totalScaled = scaledWidths.reduce((a, b) => a + b, 0)
if (totalScaled > containerTwip) {
  // 超出时缩小每列，最后一列补足
  const diff = totalScaled - containerTwip
  scaledWidths[scaledWidths.length - 1] -= diff
} else if (totalScaled < containerTwip && scaledWidths.length > 0) {
  // 不足时最后一列补足
  scaledWidths[scaledWidths.length - 1] += containerTwip - totalScaled
}
```

#### 步骤 5：处理表格外边框

当前只解析了单元格边框（`<w:tcBorders>`），但表格级边框（`<w:tblBorders>`）和表格外边框受到单元格边框的影响。如果表格外边框未设置而单元格边框已设置，渲染时单元格之间可能有双边框。

**修复：** 在 `parseWTable` 中解析 `<w:tblBorders>`，传递给 `tableSource` 作为表格级边框。

#### 步骤 6：增加调试日志

在 `buildDocDataFromRich` 的关键位置增加 `console.log` 输出：

```typescript
// 在 buildTable 中：
console.log(`[buildTable] tableId=${tableId}, colCount=${t.colCount}, tableWidth=${tableWidth}`)
console.log(`[buildTable] scaledWidths:`, scaledWidths)
console.log(`[buildTable] tableRows count:`, tableRows.length)
console.log(`[buildTable] tableColumns count:`, scaledWidths.length)
console.log(`[buildTable] dataStream table section:`, 
  dataStream.slice(tableStart, dataStream.length))

// 在 buildDocDataFromRich 返回前：
const errors = this._validateUDM(body, tableSource)
if (errors.length > 0) {
  console.error('[UDM Validation] 发现错误:', errors)
} else {
  console.log('[UDM Validation] 验证通过')
}
```

### 4.3 调试方法论

由于无法直接修改 Univer 渲染引擎，调试采用"二分法 + 简化法"：

1. **简化法：** 创建一个仅包含 1 行 1 列的最小表格，逐步增加复杂度
2. **二分法：** 注释掉部分表格数据，每次只保留一半，看哪一半渲染正常
3. **对比法：** 用 Univer 官方 demo 的表格数据与我们的输出对比，找出差异

### 4.4 验证标准

修复完成后，以下场景必须全部通过：

- [ ] 单列表格（1 列 × N 行）正常显示
- [ ] 多列表格（N 列 × M 行）正常显示
- [ ] 含横向合并单元格（colSpan > 1）的表格
- [ ] 含纵向合并单元格（vMerge）的表格
- [ ] 含横向+纵向合并的表格
- [ ] 含边框样式的表格
- [ ] WPS 导出的 DOCX 表格
- [ ] Word 导出的 DOCX 表格
- [ ] 表格后有段落文本
- [ ] 表格前有段落文本
- [ ] 多个表格连续排列
- [ ] 表格内单元格含多段落
- [ ] 表格内单元格含粗体/字号样式

## 5. 方案 B：HTML 渲染（mammoth.js，不可编辑，完全免费商用）

### 5.1 技术方案

用 `mammoth.js` 把 DOCX 转为 HTML，用 `<iframe>` 或 `<div>` 展示：

```typescript
import mammoth from 'mammoth'

// DOCX → HTML
const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
// result.value 是完整的 HTML 字符串，表格渲染由浏览器原生处理

// 展示
iframeRef.current.srcdoc = `
  <html>
  <head>
    <style>
      table { border-collapse: collapse; width: 100%; }
      td, th { border: 1px solid #000; padding: 4px; }
    </style>
  </head>
  <body>${result.value}</body>
  </html>
`
```

### 5.2 优缺点

| 优点 | 缺点 |
|------|------|
| 表格天然正确，CrOS 浏览器原生 `<table>` 渲染 | 不可编辑，只能查看 |
| 许可证 BSD-2-Clause，完全免费商用 | 可能与现有 brutalist 设计风格不统一 |
| 包体积小（~200KB gzip） | 表单填写功能需要另寻编辑方案 |
| 开发成本低，几天内可完成替换 | 需维护两份渲染方案（文档 HTML + 电子表格 Univer） |

### 5.3 适用场景

- 用户只需要"查看"文档（办公抽屉的主要用途）
- 表单填写通过对话气泡完成，不依赖文档编辑器
- 对编辑功能无硬性需求

## 6. 方案 C：OnlyOffice 商业许可（编辑+表格正确，需付费）

### 6.1 技术方案

安装 `@agentbridges-ai/onlyoffice-browser`，用 OnlyOffice 替换 Univer 文档编辑器：

```typescript
import { createOfficeEditor } from '@agentbridges-ai/onlyoffice-browser'

const editor = await createOfficeEditor(container, {
  file: docxArrayBuffer,
  fileName: '文档.docx',
  mode: 'edit',  // 编辑模式
  lang: 'zh-CN',
  saveBehavior: 'callback',
  onSave: (savedFile) => { /* 保存到本地 */ },
})
```

### 6.2 优缺点

| 优点 | 缺点 |
|------|------|
| DOCX 原生支持，表格肯定正确 | AGPL-3.0 许可证，商用需购买许可 |
| 完整编辑功能 | WASM 运行时 ~24MB，打包体积大 |
| 支持 DOCX/XLSX/PPTX | 新依赖，与现有架构集成需要较多开发工作 |
| 与 WPS/Word 兼容性极高 | 如果后续要商用，许可证费用 $1200-$2400 |

### 6.3 适用场景

- 用户需要完整编辑功能
- 表格渲染是硬性要求
- 愿意为商业许可证付费

## 7. 决策建议

```
                    ┌─────────────────────────────┐
                    │ 用户需要编辑文档吗？          │
                    └──────────┬──────────────────┘
                               │
             ┌─────────────────┼─────────────────┐
             ▼                                   ▼
        ┌────────┐                          ┌────────┐
        │ 需要   │                          │ 不需要  │
        └───┬────┘                          └───┬────┘
            │                                   │
            ▼                                   ▼
  ┌─────────────────────┐            ┌───────────────────────┐
  │ 预算够买许可证吗？   │            │ 方案 B：mammoth.js   │
  └──────────┬──────────┘            │ BSD 许可，免费商用    │
             │                       │ 几天可完成替换        │
     ┌───────┴───────┐               └───────────────────────┘
     ▼               ▼
  ┌────────┐  ┌──────────────────┐
  │ 够     │  │ 不够             │
  └───┬────┘  └────────┬─────────┘
      │                │
      ▼                ▼
┌──────────────┐ ┌──────────────────────┐
│ 方案 C：     │ │ 方案 A：继续修 Univer│
│ OnlyOffice  │ │ 免费，但需要调试时间  │
│ 商业许可     │ │ 能编辑，但表格可能   │
└──────────────┘ │ 还有问题             │
                 └──────────────────────┘
```

## 8. 推荐路径

**短期（1-2 天）：** 按方案 A 的验证器 + 调试日志 + 已知问题修复，先全力解决当前表格渲染问题。

**如果短期修复后仍无法满足要求：**

- **只需要查看 → 切方案 B**（mammoth.js，2-3 天完成）
- **需要编辑且有预算 → 切方案 C**（OnlyOffice 商业许可，3-5 天完成）
- **需要编辑但无预算 → 继续方案 A**（长期维护，逐步完善）

## 9. 附录：Univer 渲染引擎关键代码路径

```
node_modules/@univerjs/engine-render/lib/es/index.js

_createTableSkeleton: ~L13137  — 表格骨架创建
_buildTableCache:     ~L12515  — 表格缓存构建
_getTableLeft:        ~L12600  — 表格水平定位
applyMergedCellSpanHeights:   — 合并单元格高度计算
```

这些函数接受 `IDocumentData` 作为输入，无法直接修改。只能通过调整输入数据来影响渲染结果。