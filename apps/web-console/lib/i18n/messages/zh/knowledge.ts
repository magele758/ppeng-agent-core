export const knowledge = {
  sourceUi: '界面配置',
  sourceDefault: '默认',
  ingestion: {
    title: '附件与浏览器',
    desc: '决定 Agent 如何读取你上传的文件和访问网页。保存后立即生效，无需改 .env。',
    enabled: '启用附件摄取',
    enabledDesc: '归档上传的文本，并从 Office 文档中抽取文字，让 Agent 能读懂附件。',
    browser: '启用浏览器工具',
    browserDesc: '让 Agent 通过本机 Playwright 打开网页（需本机已安装 Playwright）。新会话生效。',
    advancedTitle: '高级摄取选项',
    advancedDesc: '多数情况下无需改动。',
    gbk: 'GBK 文本回退',
    gbkDesc: '无法按 UTF-8 解码时再尝试 GBK，适合老旧的中文文本文件。',
    webSearchUrl: '网页搜索 URL 模板（须含 {query}）',
    webSearchHint: '未配置时不会向模型提供网页搜索，避免空搜后整轮失败。',
    webSearchPh: 'https://html.duckduckgo.com/html/?q={query}',
    webSearchSave: '保存搜索模板',
    webSearchClear: '清空（关闭网页搜索）',
    saved: '附件设置已保存，立即生效',
    browserSaved: '浏览器设置已保存。新会话会加载浏览器工具',
    webSearchSaved: '搜索模板已保存，立即生效',
    loadFailed: '加载摄取设置失败：{error}'
  }
};
