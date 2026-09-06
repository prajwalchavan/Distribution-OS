import { createRoot } from 'react-dom/client'

import { App } from './App.js'

const node = document.getElementById('root')
if (node === null) throw new Error('no #root')
createRoot(node).render(<App />)
