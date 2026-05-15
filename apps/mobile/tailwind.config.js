/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        app: {
          background: '#09090b',
          surface: '#111318',
          panel: '#1f2430',
          primary: '#7dd3fc',
          secondary: '#c4b5fd',
          accent: '#fda4af',
        },
      },
    },
  },
  plugins: [],
};
