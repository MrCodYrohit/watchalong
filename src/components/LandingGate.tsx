import React, { useState } from 'react';
import { Film, Lock, Sparkles, Tv, Users, Volume2, ArrowRight, CheckCircle2, AlertTriangle } from 'lucide-react';

interface LandingGateProps {
  onAuthenticated: (token: string, enteredCode: string) => void;
  initialCode?: string;
  infoMessage?: string | null;
}

export const LandingGate: React.FC<LandingGateProps> = ({
  onAuthenticated,
  initialCode = '',
  infoMessage = null,
}) => {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError('Please enter the secret room code.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          onAuthenticated(data.token, code.trim());
          return;
        }
      }
    } catch {
      // Running statically without backend (GitHub Pages mode)
    }

    // Direct verification for 100% static GitHub Pages deployment
    const normalized = code.trim().toLowerCase();
    if (normalized === 'rohit ko baap bol 15') {
      onAuthenticated(`AUTH_${Date.now()}`, code.trim());
    } else {
      setError('Invalid Secret Code. Access denied.');
    }
    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-4 overflow-hidden bg-zinc-950">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-rose-600/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[450px] h-[350px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Grid pattern overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b15_1px,transparent_1px),linear-gradient(to_bottom,#18181b15_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      <div className="relative z-10 w-full max-w-lg">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold tracking-wide uppercase mb-5 backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Peer-To-Peer Watch Party</span>
          </div>
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center shadow-lg shadow-rose-500/25">
              <Film className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-white font-['Plus_Jakarta_Sans']">
              Sync<span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-amber-300">Stream</span>
            </h1>
          </div>
          <p className="text-zinc-400 text-sm max-w-sm mx-auto leading-relaxed">
            Watch Netflix, YouTube, or Prime Video together with friends in ultra-low latency with synchronized tab audio and live reactions.
          </p>
        </div>

        {/* Authentication Card */}
        <div className="p-8 rounded-3xl bg-zinc-900/90 border border-zinc-800/80 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center gap-2.5 pb-5 border-b border-zinc-800/60 mb-6">
            <Lock className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-semibold text-zinc-200 uppercase tracking-wider">
              Secret Passcode Gatekeeper
            </h2>
          </div>

          {infoMessage && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex items-start gap-3 leading-relaxed shadow-inner">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-amber-300 mb-0.5">Invite Link Expired</div>
                <p className="text-[11px] text-amber-200/90">{infoMessage}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="secret-code" className="block text-xs font-medium text-zinc-300 mb-2">
                Enter Secret Room Code
              </label>
              <div className="relative">
                <input
                  id="secret-code"
                  type="text"
                  autoComplete="off"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Enter secret passcode..."
                  className="w-full px-4 py-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white placeholder-zinc-500 font-sans text-sm tracking-wide focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all"
                />
              </div>

              {error && (
                <div className="mt-2.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-3 py-2 rounded-lg flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-semibold text-sm bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700 active:scale-[0.99] text-white shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? (
                <span className="inline-flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying Passcode...
                </span>
              ) : (
                <>
                  <span>Enter Watch Room</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-3 gap-3 mt-6">
          <div className="p-3.5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 text-center">
            <div className="w-8 h-8 rounded-lg bg-zinc-800/80 flex items-center justify-center mx-auto mb-2 text-rose-400">
              <Volume2 className="w-4 h-4" />
            </div>
            <div className="text-xs font-semibold text-zinc-200">Tab Audio</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Stream movie sound</div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 text-center">
            <div className="w-8 h-8 rounded-lg bg-zinc-800/80 flex items-center justify-center mx-auto mb-2 text-amber-400">
              <Tv className="w-4 h-4" />
            </div>
            <div className="text-xs font-semibold text-zinc-200">Cross-Platform</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Netflix, YT, Prime</div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-900/50 border border-zinc-800/50 text-center">
            <div className="w-8 h-8 rounded-lg bg-zinc-800/80 flex items-center justify-center mx-auto mb-2 text-sky-400">
              <Users className="w-4 h-4" />
            </div>
            <div className="text-xs font-semibold text-zinc-200">WebRTC Mesh</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">Live cam & reactions</div>
          </div>
        </div>

        {/* Invite link bypass reminder */}
        <div className="mt-6 text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Friends with an invite link bypass this screen automatically.</span>
        </div>
      </div>
    </div>
  );
};
