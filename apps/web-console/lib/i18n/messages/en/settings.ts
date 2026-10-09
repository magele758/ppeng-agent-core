export const settings = {
  categories: {
    general: 'General',
    models: 'Models',
    behavior: 'Agent behavior',
    safety: 'Safety & sandbox',
    tools: 'Tools & skills',
    integrations: 'Integrations & observability'
  },
  categoriesLabel: 'Settings categories',
  searchPlaceholder: 'Search settings (e.g. sandbox, model, Langfuse)',
  noResultsTitle: 'No matching settings',
  noResultsDesc: 'Nothing matches "{query}". Try another keyword.',
  emptyCategoryTitle: 'No common settings here yet',
  emptyCategoryDesc: 'Turn on "Show advanced" at the top right to see more options.',
  entries: {
    language: { title: 'Language', keywords: 'ui language locale 中文 English' },
    modelProviders: { title: 'Model providers', keywords: 'API key base url model provider openai anthropic' },
    modelFallback: { title: 'Model fallback', keywords: 'backup model fallback retry degrade' }
  }
};
