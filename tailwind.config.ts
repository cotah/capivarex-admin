import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        glass: 'var(--glass)',
        'glass-border': 'var(--glass-border)',
        text: 'var(--text)',
        'text-muted': 'var(--text-muted)',
        accent: 'var(--accent)',
        'accent-glow': 'var(--accent-glow)',
        'accent-soft': 'var(--accent-soft)',
        success: 'var(--success)',
        error: 'var(--error)',
      },
    },
  },
  plugins: [],
};

export default config;
