import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { App as TerminalApp } from './pages/Terminal';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TerminalApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
