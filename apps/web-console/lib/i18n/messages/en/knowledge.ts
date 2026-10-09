export const knowledge = {
  sourceUi: 'UI config',
  sourceDefault: 'Default',
  ingestion: {
    title: 'Attachments & browser',
    desc: 'Controls how agents read files you upload and browse the web. Saved settings take effect immediately — no .env change.',
    enabled: 'Enable attachment ingestion',
    enabledDesc: 'Archives uploaded text and extracts text from Office documents so agents can read attachments.',
    browser: 'Enable browser tools',
    browserDesc: 'Lets agents open web pages through local Playwright (must be installed locally). Applies to new sessions.',
    advancedTitle: 'Advanced ingestion options',
    advancedDesc: 'Most setups never need to change these.',
    gbk: 'GBK text fallback',
    gbkDesc: 'Try GBK when UTF-8 decoding fails; useful for older Chinese text files.',
    webSearchUrl: 'Web search URL template (must contain {query})',
    webSearchHint: 'Web search is hidden from the model until a template is set, so an empty search cannot fail the run.',
    webSearchPh: 'https://html.duckduckgo.com/html/?q={query}',
    webSearchSave: 'Save search template',
    webSearchClear: 'Clear (turn web search off)',
    saved: 'Attachment settings saved, effective immediately',
    browserSaved: 'Browser settings saved. New sessions load the browser tools',
    webSearchSaved: 'Search template saved, effective immediately',
    loadFailed: 'Failed to load ingestion settings: {error}'
  }
};
