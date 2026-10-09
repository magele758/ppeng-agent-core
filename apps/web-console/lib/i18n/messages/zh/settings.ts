export const settings = {
  categories: {
    general: '通用',
    models: '模型',
    behavior: 'Agent 行为',
    safety: '安全与沙箱',
    tools: '工具与技能',
    integrations: '集成与可观测'
  },
  categoriesLabel: '设置分类',
  searchPlaceholder: '搜索设置（如：沙箱、模型、Langfuse）',
  noResultsTitle: '没有匹配的设置',
  noResultsDesc: '没有找到与「{query}」相关的设置，试试其他关键词。',
  emptyCategoryTitle: '这里暂时没有常用设置',
  emptyCategoryDesc: '打开右上角「显示高级」查看更多选项。',
  entries: {
    language: { title: '语言', keywords: '界面语言 language locale 中文 English' },
    modelProviders: { title: '模型服务商', keywords: 'API Key Base URL 模型 provider openai anthropic' },
    modelFallback: { title: '模型回退', keywords: '备用模型 fallback 重试 降级' }
  }
};
