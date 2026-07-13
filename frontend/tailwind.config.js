/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        board: {
          green: '#0d3222', // Deep blackboard green
          charcoal: '#1a1a1a', // Charcoal dark mode
          slate: '#2c3e50', // Slate blue board
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
