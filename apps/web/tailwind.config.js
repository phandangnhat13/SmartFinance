/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', 'system-ui', 'Arial', 'sans-serif'],
      },
      // Semantic color tokens. Every token reads a CSS variable declared in
      // index.css, so a page never hard-codes a hex value for a UI state.
      colors: {
        app: 'rgb(var(--sf-bg) / <alpha-value>)',
        surface: {
          DEFAULT: 'rgb(var(--sf-surface) / <alpha-value>)',
          muted: 'rgb(var(--sf-surface-muted) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--sf-border) / <alpha-value>)',
          strong: 'rgb(var(--sf-border-strong) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--sf-text) / <alpha-value>)',
          secondary: 'rgb(var(--sf-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--sf-text-muted) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--sf-brand) / <alpha-value>)',
          hover: 'rgb(var(--sf-brand-hover) / <alpha-value>)',
          soft: 'rgb(var(--sf-brand-soft) / <alpha-value>)',
          deep: 'rgb(var(--sf-brand-deep) / <alpha-value>)',
        },
        income: 'rgb(var(--sf-income) / <alpha-value>)',
        expense: 'rgb(var(--sf-expense) / <alpha-value>)',
        warning: {
          DEFAULT: 'rgb(var(--sf-warning) / <alpha-value>)',
          strong: 'rgb(var(--sf-warning-strong) / <alpha-value>)',
          border: 'rgb(var(--sf-warning-border) / <alpha-value>)',
          soft: 'rgb(var(--sf-warning-soft) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--sf-danger) / <alpha-value>)',
          strong: 'rgb(var(--sf-danger-strong) / <alpha-value>)',
          border: 'rgb(var(--sf-danger-border) / <alpha-value>)',
          soft: 'rgb(var(--sf-danger-soft) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--sf-info) / <alpha-value>)',
          strong: 'rgb(var(--sf-info-strong) / <alpha-value>)',
          border: 'rgb(var(--sf-info-border) / <alpha-value>)',
          soft: 'rgb(var(--sf-info-soft) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--sf-accent) / <alpha-value>)',
          strong: 'rgb(var(--sf-accent-strong) / <alpha-value>)',
          border: 'rgb(var(--sf-accent-border) / <alpha-value>)',
          soft: 'rgb(var(--sf-accent-soft) / <alpha-value>)',
        },
      },
      maxWidth: {
        content: '1600px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.05)',
        pop: '0 12px 40px rgba(15, 23, 42, 0.12)',
      },
    },
  },
  plugins: [],
};
