import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';

// Custom terminal theme - optimized for high-contrast accessibility and modern aesthetics
const terminalTheme = {
  background: '#09090b', // zinc-950
  foreground: '#d4d4d8', // zinc-300
  cursor: '#f97316', // orange-500
  cursorAccent: '#09090b',
  selectionBackground: '#f9731640',
  selectionForeground: '#ffffff',
  selectionInactiveBackground: '#f9731620',

  // ANSI Colors
  black: '#09090b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafa'
};

interface User {
  id: string;
  name: string;
  color: string;
}

interface AppState {
  connected: boolean;
  roomId: string | null;
  userId: string | null;
  userName: string | null;
  userColor: string | null;
  users: User[];
  hasActivePty: boolean;
  typingUser: User | null;
}

function generateRandomUserSuffix(): string {
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return array[0].toString(36).slice(0, 4);
}

export function App() {
  const [state, setState] = useState<AppState>({
    connected: false,
    roomId: null,
    userId: null,
    userName: null,
    userColor: null,
    users: [],
    hasActivePty: false,
    typingUser: null
  });

  const [joinName, setJoinName] = useState('');
  const [joinRoomId, setJoinRoomId] = useState('');
  const [copied, setCopied] = useState(false);

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize Terminal
  useEffect(() => {
    if (!state.connected || !terminalRef.current || xtermRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      theme: terminalTheme,
      fontSize: 15,
      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", monospace',
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.3,
      scrollback: 10000,
      convertEol: true
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    
    // Slight delay to ensure parent container has painted
    setTimeout(() => fitAddon.fit(), 0);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      fitAddon.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'pty_resize', cols: term.cols, rows: term.rows })
        );
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [state.connected]);

  // WebSocket Message Handler
  const handleWsMessage = useCallback((event: MessageEvent) => {
    const message = JSON.parse(event.data);
    const term = xtermRef.current;

    switch (message.type) {
      case 'connected':
        setState((s) => ({
          ...s,
          connected: true,
          userId: message.userId,
          userName: message.userName,
          userColor: message.userColor,
          users: message.users,
          hasActivePty: message.hasActivePty
        }));
        if (message.history && term) term.write(message.history);
        break;
      case 'user_joined':
      case 'user_left':
        setState((s) => ({ ...s, users: message.users }));
        break;
      case 'pty_started':
        setState((s) => ({ ...s, hasActivePty: true }));
        break;
      case 'pty_output':
        if (term) term.write(message.data);
        break;
      case 'pty_exit':
        setState((s) => ({ ...s, hasActivePty: false }));
        if (term) term.writeln(`\r\n[Process exited with code ${message.exitCode}]`);
        break;
      case 'user_typing':
        setState((s) => ({ ...s, typingUser: message.user }));
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setState((s) => ({ ...s, typingUser: null }));
        }, 1000);
        break;
      case 'error':
        if (term) term.writeln(`\r\n\x1b[31m[Error: ${message.message}]\x1b[0m`);
        break;
    }
  }, []);

  const connectToRoom = useCallback((roomId: string, userName: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/room/${roomId}?name=${encodeURIComponent(userName)}`
    );

    ws.addEventListener('open', () => {
      wsRef.current = ws;
      setState((s) => ({ ...s, roomId }));
      window.history.replaceState({}, '', `${window.location.origin}?room=${roomId}`);
    });
    ws.addEventListener('message', handleWsMessage);
    ws.addEventListener('close', () => {
      wsRef.current = null;
      setState((s) => ({ ...s, connected: false, roomId: null, users: [], hasActivePty: false }));
    });
  }, [handleWsMessage]);

  const startPty = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && xtermRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'start_pty',
        cols: xtermRef.current.cols,
        rows: xtermRef.current.rows
      }));
    }
  }, []);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    const disposable = term.onData((data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && state.hasActivePty) {
        wsRef.current.send(JSON.stringify({ type: 'pty_input', data }));
      }
    });
    return () => disposable.dispose();
  }, [state.hasActivePty]);

  const createRoom = async () => {
    const name = joinName.trim() || `User-${generateRandomUserSuffix()}`;
    const response = await fetch('/api/room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userName: name })
    });
    const data = await response.json();
    connectToRoom(data.roomId, name);
  };

  const joinRoom = () => {
    const name = joinName.trim() || `User-${generateRandomUserSuffix()}`;
    const roomId = joinRoomId.trim();
    if (roomId) connectToRoom(roomId, name);
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}?room=${state.roomId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const roomFromUrl = new URLSearchParams(window.location.search).get('room');
    if (roomFromUrl) setJoinRoomId(roomFromUrl);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans relative overflow-hidden flex flex-col">
      {/* Background Layer */}
      <div className="fixed inset-0 pointer-events-none bg-[image:radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(249,115,22,0.15),transparent),radial-gradient(ellipse_60%_40%_at_100%_50%,rgba(249,115,22,0.08),transparent),radial-gradient(ellipse_60%_40%_at_0%_50%,rgba(59,130,246,0.08),transparent)]" />
      <div className="fixed inset-0 pointer-events-none bg-[image:linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />

      {!state.connected ? (
        <main className="flex-1 flex flex-col relative z-10">
          <header className="p-6 md:px-8">
            <div className="flex items-center gap-2.5 font-semibold text-lg text-zinc-50">
              <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-orange-500" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span>Sandbox</span>
            </div>
          </header>

          <section className="flex-1 flex flex-col items-center justify-center px-6 pb-20 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-full text-sm text-orange-400 mb-8 font-medium">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
              Powered by Cloudflare Edge
            </div>
            
            <h1 className="text-5xl md:text-[80px] font-bold leading-[1.1] tracking-tight mb-6">
              Collaborative <br />
              <span className="bg-gradient-to-br from-orange-500 via-orange-400 to-amber-400 bg-clip-text text-transparent">Terminal</span>
            </h1>
            
            <p className="text-lg text-zinc-400 leading-relaxed max-w-[480px] mb-12">
              Real-time terminal sharing. Like Google Docs, but for your shell. Code, debug, and ship together instantly.
            </p>

            <div className="bg-zinc-900/80 border border-zinc-700/50 rounded-2xl p-8 w-full max-w-md backdrop-blur-xl shadow-2xl">
              <div className="mb-5 text-left">
                <label htmlFor="name" className="block text-sm font-medium text-zinc-400 mb-2">Display Name</label>
                <input
                  id="name"
                  type="text"
                  placeholder="Anonymous"
                  value={joinName}
                  onChange={(e) => setJoinName(e.target.value)}
                  className="w-full px-4 py-3 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 transition-all"
                />
              </div>

              <button
                type="button"
                onClick={createRoom}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-br from-orange-500 to-orange-600 hover:-translate-y-[1px] hover:shadow-[0_8px_24px_rgba(249,115,22,0.3)] text-white rounded-xl text-base font-semibold transition-all"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Create New Room
              </button>

              <div className="flex items-center gap-4 my-6 before:flex-1 before:h-px before:bg-zinc-800 after:flex-1 after:h-px after:bg-zinc-800 text-sm text-zinc-500 font-medium">
                or join existing
              </div>

              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Paste Room ID"
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                  className="flex-1 px-4 py-3 bg-zinc-950/80 border border-zinc-800 rounded-xl text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-all"
                />
                <button
                  type="button"
                  onClick={joinRoom}
                  disabled={!joinRoomId.trim()}
                  className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-50 rounded-xl font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Join
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 md:gap-10 mt-16 text-sm text-zinc-400 font-medium">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500" /> Multi-user Sync</div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Sub-50ms Latency</div>
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-purple-500" /> Secure Isolation</div>
            </div>
          </section>
        </main>
      ) : (
        <main className="flex-1 flex flex-col relative z-10">
          <header className="flex flex-wrap items-center justify-between px-5 py-3 bg-zinc-950/90 border-b border-zinc-800/80 backdrop-blur-xl gap-4 z-20">
            <div className="flex items-center gap-4">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-orange-500 hidden sm:block" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg">
                <span className="text-xs text-zinc-400 font-medium tracking-wider uppercase">Room</span>
                <code className="font-mono text-sm font-bold text-orange-500">{state.roomId}</code>
                <button
                  onClick={copyRoomLink}
                  title="Copy Invite Link"
                  className="ml-1 p-1 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50 transition-colors"
                >
                  {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex mr-2">
                {state.users.map((user, idx) => (
                  <div
                    key={user.id}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white border-2 border-zinc-950 -ml-2 relative transition-transform hover:scale-110 hover:z-50 cursor-default"
                    style={{ backgroundColor: user.color, zIndex: state.users.length - idx }}
                    title={`${user.name}${user.id === state.userId ? ' (you)' : ''}`}
                  >
                    {user.name.charAt(0).toUpperCase()}
                    {state.typingUser?.id === user.id && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-zinc-950 rounded-full animate-pulse" />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_8px_#22c55e]" />
                <span className="text-xs font-medium text-green-400">{state.users.length} Online</span>
              </div>
            </div>
          </header>

          <section className="flex-1 p-4 md:p-8 flex justify-center items-start relative">
            <div className="relative w-full max-w-[1400px] h-full max-h-[85vh] flex flex-col bg-[#09090b] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
              
              {/* Window Chrome */}
              <div className="flex items-center px-4 py-3 bg-zinc-900 border-b border-zinc-800 gap-4">
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/90" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/90" />
                  <div className="w-3 h-3 rounded-full bg-green-500/90" />
                </div>
                
                <div className="flex-1 text-center text-xs text-zinc-400 font-mono flex items-center justify-center gap-2">
                  {state.hasActivePty ? (
                    <><span className="text-orange-500 font-bold">~</span> bash — {xtermRef.current?.cols}x{xtermRef.current?.rows}</>
                  ) : 'Terminal Session'}
                </div>

                <div className="min-w-[100px] flex justify-end">
                  {!state.hasActivePty && (
                    <button onClick={startPty} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-400 text-white rounded-md text-xs font-semibold transition-colors">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                      Start
                    </button>
                  )}
                </div>
              </div>

              {/* Terminal Mount */}
              <div className="flex-1 relative overflow-hidden bg-[#09090b]">
                <div 
                  ref={terminalRef} 
                  className={`absolute inset-0 p-4 transition-opacity duration-300 ${!state.hasActivePty ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} 
                />

                {!state.hasActivePty && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#09090b]/95 backdrop-blur-sm z-10">
                    <div className="text-center max-w-sm p-8">
                      <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-500/10 border border-orange-500/20 rounded-2xl mb-6 text-orange-500">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="4 17 10 11 4 5" />
                          <line x1="12" y1="19" x2="20" y2="19" />
                        </svg>
                      </div>
                      <h3 className="text-xl font-semibold text-zinc-50 mb-3">Awaiting Command</h3>
                      <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
                        Initialize a shared session. All connected participants will see and interact with the same environment.
                      </p>
                      <button onClick={startPty} className="inline-flex items-center gap-2 px-6 py-3 bg-white text-zinc-950 hover:bg-zinc-200 rounded-xl text-sm font-semibold transition-colors">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                        Boot Environment
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      )}

      {/* Global overrides required for xterm scrollbar logic */}
      <style>{`
        .xterm-viewport::-webkit-scrollbar { width: 10px; }
        .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
        .xterm-viewport::-webkit-scrollbar-thumb { background: #27272a; border: 2px solid #09090b; border-radius: 8px; }
        .xterm-viewport::-webkit-scrollbar-thumb:hover { background: #3f3f46; }
      `}</style>
    </div>
  );
}
