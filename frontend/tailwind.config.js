/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        availity: {
          50: '#f0f7ff',
          100: '#e0effe',
          500: '#0072ce',
          600: '#005fa8',
          700: '#004e8a',
        },
      },
    },
  },
  plugins: [],
};
