import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import { tw , color } from './constants/tailwind'


function App() {
  const [count, setCount] = useState(0)

  return (
    <main className={`min-h-screen bg-slate-100 ${color.text}`} style={{ backgroundColor: color.background, color: color.text }}>
      <section className={`mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-3xl items-center justify-center`}>
        <div className={tw.panel} style={{ backgroundColor: color.card }}>
          <div className={tw.logoRow}>
            <a href="https://vite.dev" target="_blank" rel="noreferrer">
              <img src={viteLogo} className={tw.logo} alt="Vite logo" />
            </a>
            <a href="https://react.dev" target="_blank" rel="noreferrer">
              <img src={reactLogo} className={tw.logoReact} alt="React logo" />
            </a>
          </div>
          <h1 className={`text-center text-4xl font-bold tracking-tight ${color.text}`}>Vite + React</h1>
          <div className={tw.card} style={{ backgroundColor: color.card }}>
            <button className={tw.button} onClick={() => setCount((count) => count + 1)}>
              count is {count}
            </button>
            <p className={tw.hint}>
              Edit <code className={tw.code}>src/App.jsx</code> and save to test HMR
            </p>
          </div>
          <p className={tw.docs}>
            Click on the Vite and React logos to learn more
          </p>
        </div>
      </section>
    </main>
  )
}

export default App
