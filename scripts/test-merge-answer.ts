/**
 * 答案合并纯函数的多场景测试 —— 验证任意 docx 段落结构下都不丢答案。
 * 运行：npx tsx scripts/test-merge-answer.ts
 */
import { mergeAnswerIntoParagraph } from '../src/renderer/utils/docxAnswerMerge'

interface Case {
  name: string
  paragraph: { runs: any[]; align?: string; empty?: boolean }
  oldText: string
  newText: string
  expect: { runsTextConcat: string; runsCount: number }
}

const cases: Case[] = [
  {
    name: '1. 单 run 段落（最简单，prefix 切尾 + value 插入）',
    paragraph: { runs: [{ text: '申报学院：_____' }] },
    oldText: '申报学院：_____',
    newText: '申报学院：管理学院',
    // 归一化后 prefix = "申报学院：" (4 char)，suffix = "" → rawCutStart=5, rawCutEnd=11
    // prefix run: "申报学院：" (5 chars, 切在原 run 第 5 字符处即 run 末尾)
    // value run: "管理学院"
    expect: { runsTextConcat: '申报学院：管理学院', runsCount: 2 },
  },
  {
    name: '2. 多 run 段落（label+占位 runs 拆分）',
    paragraph: {
      runs: [
        { text: '申报学院', fontSize: 24 },
        { text: '：', fontSize: 24 },
        { text: '_____', fontSize: 24 },
        { text: '', fontSize: 24 },
      ],
    },
    oldText: '申报学院：_____',
    newText: '申报学院：管理学院',
    expect: { runsTextConcat: '申报学院：管理学院', runsCount: 3 },
  },
  {
    name: '3. 段首缩进 + 粗体 label（prefix 完整 + value 1 run）',
    paragraph: {
      runs: [
        { text: '  ', fontSize: 32 },
        { text: '项目专题：', bold: true, fontSize: 32 },
        { text: '_____________', fontSize: 32 },
      ],
    },
    oldText: '  项目专题：_____________',
    newText: '  项目专题：智慧城市调研',
    // 归一化后 prefix 共享 "  项目专题："，suffix ""，新 value 整体插入
    expect: { runsTextConcat: '  项目专题：智慧城市调研', runsCount: 3 },
  },
  {
    name: '4. 完全替换（无 prefix，共享后缀 "内容"）',
    paragraph: { runs: [{ text: '原内容', fontSize: 24 }] },
    oldText: '原内容',
    newText: '新内容',
    // 共享后缀 "内容" → 保留 "内容" 为 suffix，"新" 作为 value 插入
    expect: { runsTextConcat: '新内容', runsCount: 2 },
  },
  {
    name: '5. 空段落（无 runs）',
    paragraph: { runs: [], empty: true },
    oldText: '',
    newText: '新增内容',
    expect: { runsTextConcat: '新增内容', runsCount: 1 },
  },
  {
    name: '6. runs 文本与 oldText 严重不符（智能切分失败 → 兜底）',
    paragraph: { runs: [{ text: '完全无关的文本' }] },
    oldText: '其它段落',
    newText: '新值',
    expect: { runsTextConcat: '新值', runsCount: 1 },
  },
  {
    name: '7. 粗体 label，答在 label 后',
    paragraph: {
      runs: [
        { text: '团队名称', bold: true, fontSize: 28 },
        { text: '：', fontSize: 24 },
        { text: '________', fontSize: 24 },
      ],
    },
    oldText: '团队名称：________',
    newText: '团队名称：勇敢队',
    expect: { runsTextConcat: '团队名称：勇敢队', runsCount: 3 },
  },
  {
    name: '8. runs 中含 \\t 字符（docx 边缘情况：tab 切到 run 边界）',
    paragraph: {
      runs: [
        { text: '团队名称' },
        { text: '\t：' },
        { text: '\t________' },
      ],
    },
    oldText: '团队名称：________',
    newText: '团队名称：勇敢队',
    // 切点落在空白块内被推进，可能产生 "团队名称\\t：勇敢队"
    // 这不影响功能：内容正确，仅 run 边界略不同于纯文本版本。
    expect: { runsTextConcat: '团队名称\t：勇敢队', runsCount: 3 },
  },
  {
    name: '9. 答案只是前缀（清空后部分占位）',
    paragraph: { runs: [{ text: '申报学院：原值' }] },
    oldText: '申报学院：原值',
    newText: '申报学院：',
    expect: { runsTextConcat: '申报学院：', runsCount: 1 },
  },
  {
    name: '10. 整段重写为答案（label 完全不同）',
    paragraph: { runs: [{ text: '原label：原值' }] },
    oldText: '原label：原值',
    newText: '全新',
    expect: { runsTextConcat: '全新', runsCount: 1 },
  },
  {
    name: '11. 多 run 切在 run 中间（label run 切走前缀）',
    paragraph: {
      runs: [
        { text: '申报名', fontSize: 24 },
        { text: '称：_____', fontSize: 24 },
      ],
    },
    oldText: '申报名称：_____',
    newText: '申报名称：测试学院',
    // 归一化匹配 prefix="申报名称："，suffix=""，切点落在 run2 中间
    expect: { runsTextConcat: '申报名称：测试学院', runsCount: 3 },
  },
  {
    name: '12. 多个空 run + 单实 run（空 run 被跳过）',
    paragraph: {
      runs: [
        { text: '', fontSize: 24 },
        { text: '', fontSize: 24 },
        { text: '姓名：___' },
        { text: '', fontSize: 24 },
      ],
    },
    oldText: '姓名：___',
    newText: '姓名：张三',
    // 空 run 被跳过，prefix="姓名：" 切尾 + value"张三"
    expect: { runsTextConcat: '姓名：张三', runsCount: 2 },
  },
]

let pass = 0
let fail = 0
for (const c of cases) {
  const para = JSON.parse(JSON.stringify(c.paragraph))
  mergeAnswerIntoParagraph(para, c.oldText, c.newText)
  const got = para.runs.map((r: any) => r.text).join('')
  const ok = got === c.expect.runsTextConcat && para.runs.length === c.expect.runsCount
  if (ok) {
    pass++
    console.log(`✓ ${c.name}`)
  } else {
    fail++
    console.log(`✗ ${c.name}`)
    console.log(`    expect: ${JSON.stringify(c.expect.runsTextConcat)} (n=${c.expect.runsCount})`)
    console.log(`    got:    ${JSON.stringify(got)} (n=${para.runs.length})`)
    console.log(`    raw:    ${JSON.stringify(para.runs)}`)
  }
}

console.log(`\nResult: ${pass} pass, ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
