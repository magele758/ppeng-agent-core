import type { SkillSpec } from '@ppeng/agent-core';

const PLAYBOOK = `# Stock Analysis Playbook (compact)

Use this as a checklist for individual-stock and watchlist work. Always cite the data source per number.

## 1. Snapshot first

Pull \`quote_get\` and \`fundamentals_get\` before saying anything. Anchor the conversation in the actual numbers, not memory.

## 2. Valuation — PE-Band & relative value

| Frame | What to compute | When to use |
|-------|----------------|-------------|
| Trailing PE vs. own 5y | current PE / median(5y PE) | mature, profitable companies |
| Forward PE vs. peers | grouped average, ±1σ | sector rotation, peer ranking |
| EV/EBITDA | for capital-intensive / asset-heavy | utilities, telecom, industrials |
| PS | for unprofitable growth | early SaaS, biotech, pre-IPO |
| PEG (PE / EPS growth) | premium-but-growing names | tech / consumer growth |

Quick rule of thumb: **band = median ± 1σ**. Outside the band needs a story.

## 3. Quick DCF (5-year)

Inputs to estimate: revenue growth (yr1..yr5), terminal growth (g), operating margin trend, tax rate, WACC.

\`\`\`
FCF_t = Revenue_t × OpMargin_t × (1 - tax_rate) - capex_t + d&a_t - ΔWC_t
TV    = FCF_5 × (1 + g) / (WACC - g)
EV    = Σ FCF_t / (1 + WACC)^t  +  TV / (1 + WACC)^5
Equity = EV - Net Debt
Per-share = Equity / shares_outstanding
\`\`\`

Sensitivity: vary WACC ±1pp and g ±0.5pp; report the price range, not a single number.

## 4. Catalysts & risks

Use \`news_search\`. For each top story:
- Mark as macro / sector / company-specific.
- Estimate magnitude: <2% / 2-5% / >5% of valuation.
- Cite headline + URL.

Common red flags:
- Auditor change, revenue restatement, large insider sales.
- Margin compression for >2 quarters with denial in the call.
- Regulatory open investigation.

## 5. Industry-comparison frame

| Metric | Why it matters |
|--------|---------------|
| Revenue growth (3y CAGR) | rank within sector |
| Gross margin | pricing power proxy |
| Operating margin | scale efficiency |
| ROE / ROIC | capital allocation quality |
| Net debt / EBITDA | leverage risk |

Always rank within the same sector (Yahoo/AV give peer lists).

## 6. Output template

\`\`\`md
**Snapshot**: $TICKER • $price ($+/-%) • $sector • $market_cap
**Fundamentals**: PE $x (band $a-$b) • PB $y • ROE $z • Rev YoY $w
**Valuation verdict**: cheap / fair / rich vs. own 5y and vs. peers
**Catalysts**: ...
**Risks**: ...
**Verdict**: long / hold / avoid; invalidation: ...
**Sources**: [quote_get] [fundamentals_get] [news_search] [...]

> Not investment advice.
\`\`\`

## 7. Boundaries

- **Never invent numbers.** Always call a tool.
- **Always disclaim.** Append "Not investment advice." at the bottom.
- For the screener persona: stay terse, use a table; defer deep work to the analyst persona.
`;

export const stockSkills: SkillSpec[] = [
  {
    id: 'stock-analysis-playbook',
    name: 'Stock Analysis Playbook',
    description:
      'Templates for individual-stock work: PE-Band, quick DCF, industry comparison, catalyst/risk taxonomy, output skeleton.',
    aliases: ['stock-analysis', 'analyst-playbook'],
    triggerWords: [
      '股票', '个股', '估值', '基本面', '行情', 'PE', 'PB', 'ROE', 'DCF',
      'stock', 'equity', 'ticker', 'fundamentals', 'valuation',
    ],
    source: 'agents',
    content: PLAYBOOK,
  },
];
