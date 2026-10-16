import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
        serif: ['Georgia', 'Playfair Display', 'Cambria', 'Times New Roman', 'Songti SC', 'serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'Courier New', 'monospace'],
      },
      colors: {
        braun: {
          bg: '#E6E4DD',
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
