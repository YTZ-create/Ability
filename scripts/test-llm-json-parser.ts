/**
 * 测试 LLM JSON 鲁棒解析器。
 */
import { parseLLMJson } from '../src/renderer/utils/llmJsonParser'

const cases: Array<{
  name: string
  input: string
  expectOk: boolean
  expectFieldCount?: number
  expectStrategy?: string
  expectFirstFieldLabel?: string
}> = [
  {
    name: '1. 正常 JSON 数组',
    input: '[{"label":"姓名","value":""},{"label":"电话","value":""}]',
    expectOk: true,
    expectFieldCount: 2,
    expectStrategy: 'direct',
    expectFirstFieldLabel: '姓名',
  },
  {
    name: '2. ```json 包裹',
    input: '```json\n[{"label":"姓名"}]\n```',
    expectOk: true,
    expectFieldCount: 1,
    expectStrategy: 'codeblock',
    expectFirstFieldLabel: '姓名',
  },
  {
    name: '3. 截断（缺 ]）',
    input: '[{"label":"A"},{"label":"B"},{"label":"C"',
    expectOk: true,
    expectFieldCount: 3,
    expectStrategy: 'truncated-fix',
    expectFirstFieldLabel: 'A',
  },
  {
    name: '4. 截断（多个完整 + 一个残缺 → 补全后 parse 成功）',
    input: '[{"label":"A"},{"label":"B"},{"label":"C","placeholder":"___',
    expectOk: true,
    expectFieldCount: 3,
    expectStrategy: 'truncated-fix',
    expectFirstFieldLabel: 'A',
  },
  {
    name: '5. 截断（缺结尾文字 "Here is the result"）',
    input: '[{"label":"A"},{"label":"B"}]\nHere is the result:',
    expectOk: true,
    expectFieldCount: 2,
    // 末尾 "Here is the result:" 阻断 direct parse，需要 truncated-fix
    expectStrategy: 'truncated-fix',
    expectFirstFieldLabel: 'A',
  },
  {
    name: '6. 完全乱码 + 多个独立对象',
    input: 'Some text {"label":"A","placeholder":"_"} then {"label":"B"} more text',
    expectOk: true,
    expectFieldCount: 2,
    expectStrategy: 'regex-objects',
    expectFirstFieldLabel: 'A',
  },
  {
    name: '7. 空响应',
    input: '',
    expectOk: false,
    expectStrategy: 'failed',
  },
  {
    name: '8. 完全非 JSON',
    input: 'I cannot extract fields from this document.',
    expectOk: false,
    expectStrategy: 'failed',
  },
  {
    name: '9. 真实场景：LLM 输出了大段解释 + 末尾 JSON',
    input: `Here are the fields I found:
\`\`\`json
[
  {"label":"申报学院","anchorText":"申报学院："},
  {"label":"团队名称","anchorText":"团队名称："},
  {"label":"负责人姓名","anchorText":"负责人姓名："}
]
\`\`\``,
    expectOk: true,
    expectFieldCount: 3,
    expectStrategy: 'codeblock',
    expectFirstFieldLabel: '申报学院',
  },
  {
    name: '10. 中文 key',
    input: '[{"标签":"姓名","类型":"单行"}]',
    expectOk: true,
    expectFieldCount: 1,
    expectStrategy: 'direct',
  },
]

let pass = 0
let fail = 0
for (const c of cases) {
  const r = parseLLMJson(c.input)
  const okOk = r.ok === c.expectOk
  const okStrategy = !c.expectStrategy || r.strategy === c.expectStrategy
  const okFieldCount =
    c.expectFieldCount === undefined ||
    (Array.isArray(r.value) && r.value.length === c.expectFieldCount)
  const okFirstField =
    !c.expectFirstFieldLabel ||
    (Array.isArray(r.value) && r.value[0]?.label === c.expectFirstFieldLabel) ||
    (Array.isArray(r.value) && r.value[0]?.标签 === c.expectFirstFieldLabel)
  if (okOk && okStrategy && okFieldCount && okFirstField) {
    pass++
    console.log(`✓ ${c.name}`)
  } else {
    fail++
    console.log(`✗ ${c.name}`)
    console.log(`    ok=${r.ok} (expect ${c.expectOk})`)
    console.log(`    strategy=${r.strategy} (expect ${c.expectStrategy})`)
    console.log(`    fieldCount=${Array.isArray(r.value) ? r.value.length : 'n/a'} (expect ${c.expectFieldCount})`)
    if (c.expectFirstFieldLabel && Array.isArray(r.value)) {
      console.log(`    first=${JSON.stringify(r.value[0])}`)
    }
  }
}
console.log(`\nResult: ${pass} pass, ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
