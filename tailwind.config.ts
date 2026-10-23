import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'Noto Sans SC', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        serif: ['Newsreader', 'Georgia', 'Noto Serif SC', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        braun: {
          bg: '#E8E4DC',
          groove: '#D8D5CC',
          paper: '#FAF8F2',
          ink: '#262523',
          muted: '#7A7873',
          orange: '#EA5B25',
          line: '#E2DFD5',
        },
      },
    },
  },
  plugins: [],
};

export default config;
