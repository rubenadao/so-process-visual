import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Note: StrictMode disabled because debugger stepping has intentional side effects
// that cannot be safely double-invoked
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
); 