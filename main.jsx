import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('TurfBook startup/render error:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <main style={{minHeight:'100vh',background:'#090909',color:'#f5f0e7',padding:'32px',fontFamily:'Arial,sans-serif'}}>
          <h1 style={{color:'#d9b875'}}>TurfBook could not finish opening</h1>
          <p>The app caught a startup error instead of closing silently.</p>
          <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',background:'#17130f',padding:'16px',border:'1px solid #66502e'}}>{String(this.state.error?.message || this.state.error)}</pre>
          <p>Please send this error text when reporting a problem.</p>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StartupErrorBoundary>
    <React.StrictMode>
      <App />
    </React.StrictMode>
  </StartupErrorBoundary>,
);
