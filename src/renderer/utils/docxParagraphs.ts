/**
 * docxParagraphs — docx/文本文件段落提取（从 OfficePanel 抽出的公共工具）
 *
 * 原 OfficePanel 内部函数，Ethan 抽屉同步（formDrawerSyncService）需要复用同一套
 * 解析逻辑，故抽取为独立工具；OfficePanel 改为从此处 import，行为不变。
 */

import PizZip from 'pizzip'

/**
 * 解析上传文件为段落数组（保留结构，避免 docx 所有文本拼成一行）
 * 支持 .docx（按 <w:p> 段落提取）及其余格式（按纯文本分行）
 */
export async function parseDocxParagraphs(fileName: string, buffer: ArrayBuffer): Promise<string[]> {
  if (!/\.docx$/i.test(fileName)) {
    const text = new TextDecoder().decode(buffer)
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
  }

  const zip = new PizZip(buffer)
  const docXml = zip.file('word/document.xml')?.asText()
  if (!docXml) return []

  // 解码 XML 实体（&amp; &lt; 等），否则导入的文本会带实体字面量
  const decodeEntities = (s: string) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')

  // 把自闭合空段落 <w:p/> 归一化为 <w:p></w:p>，统一交给下面的段落正则处理
  // （注意不能用 <w:p[^>]*> 之类的宽松匹配：<w:pPr>、<w:pgSz> 等标签也会被误匹配）
  const normalizedXml = docXml.replace(/<w:p\b([^>]*)\/>/g, '<w:p$1></w:p>')

  // 按 <w:p>...</w:p> 切分段落
  const paragraphs: string[] = []
  const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g

  // 段落内按 token 提取：<w:t> 文本、<w:tab/> 制表符、<w:br/> 换行。
  // 注意 <w:t> 必须带边界匹配（<w:t(?:\s...)?>），否则会误匹配 <w:tab .../>，
  // 把整段 OOXML 标签当正文抽出来（乱码根因）
  const tokenRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g

  let paraMatch: RegExpExecArray | null
  while ((paraMatch = paraRegex.exec(normalizedXml))) {
    const paraXml = paraMatch[0]
    let paraText = ''
    let tokenMatch: RegExpExecArray | null
    tokenRegex.lastIndex = 0
    while ((tokenMatch = tokenRegex.exec(paraXml))) {
      if (tokenMatch[1] !== undefined) {
        paraText += decodeEntities(tokenMatch[1])
      } else if (tokenMatch[0].startsWith('<w:tab')) {
        paraText += '\t'
      } else {
        paraText += '\n'
      }
    }
    paragraphs.push(paraText.trim())
  }

  return paragraphs
}

/**
 * 从 base64 编码的文件内容解析段落数组（Ethan 抽屉同步使用：
 * FormDocument.rawContent 存的是 docx/文本文件的 base64）
 */
export async function parseDocxParagraphsFromBase64(fileName: string, base64: string): Promise<string[]> {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return parseDocxParagraphs(fileName, bytes.buffer)
}
