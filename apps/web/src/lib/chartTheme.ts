/**
 * One palette for every chart in the app. Colors describe semantics (income,
 * expense, budget status, category identity), never a specific page, so the
 * same data reads the same way on the dashboard, insights and analytics.
 *
 * This is intentionally a plain object rather than a theming abstraction:
 * components import the values they need and pass them to Recharts.
 */
export const chartTheme = {
  series: {
    income: '#059669',
    expense: '#f43f5e',
    netPositive: '#059669',
    netNegative: '#f43f5e',
  },
  budget: {
    onTrack: '#059669',
    warning: '#f59e0b',
    exceeded: '#f43f5e',
    limit: '#cbd5e1',
  },
  /** Fixed categorical order; assign by index, never cycle for a 9th series. */
  category: [
    '#059669',
    '#0ea5e9',
    '#f59e0b',
    '#8b5cf6',
    '#ef4444',
    '#14b8a6',
    '#f97316',
    '#64748b',
    '#db2777',
  ],
  forecast: {
    income: '#059669',
    expense: '#e11d48',
  },
  grid: '#e2e8f0',
  axis: {
    label: '#64748b',
    tick: '#94a3b8',
  },
  tooltip: {
    label: '#0f172a',
  },
} as const;
