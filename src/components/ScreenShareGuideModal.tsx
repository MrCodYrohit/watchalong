import React from 'react';
import { X, Volume2, ShieldAlert, Check, Monitor, Sparkles } from 'lucide-react';

interface ScreenShareGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartShare: () => void;
}

export const ScreenShareGuideModal: React.FC<ScreenShareGuideModalProps> = ({
  isOpen,
  onClose,
  onStartShare,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl p-6 overflow-hidden">
        {/* Glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center">
              <Volume2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">How to Stream with Sound</h3>
              <p className="text-xs text-zinc-400">Share Netflix, YouTube, or Movies with full tab audio</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 3 Steps */}
        <div className="space-y-3.5 mb-6">
          <div className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800/80 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
              1
            </div>
            <div>
              <div className="text-xs font-semibold text-zinc-200">
                Choose &ldquo;Chrome Tab&rdquo; or &ldquo;Browser Tab&rdquo;
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                In the browser share popup, click the <strong>Tab</strong> option (where Netflix, YouTube, or Prime Video is playing).
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
              2
            </div>
            <div>
              <div className="text-xs font-semibold text-rose-300 flex items-center gap-1.5">
                <span>Check &ldquo;Also share tab audio&rdquo;</span>
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              </div>
              <p className="text-[11px] text-zinc-300 mt-0.5">
                Look at the bottom left of the browser share prompt and make sure the <strong>Share audio</strong> toggle or checkbox is turned ON!
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-zinc-950 border border-zinc-800/80 flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-rose-500/20 text-rose-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
              3
            </div>
            <div>
              <div className="text-xs font-semibold text-zinc-200">
                DRM Black Screen Fix (Netflix / Disney+)
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                If the screen is black for viewers, open your browser settings and disable <em>&ldquo;Use graphics acceleration when available&rdquo;</em>, then restart browser.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onStartShare();
            }}
            className="flex-1 py-3 px-4 rounded-xl text-xs font-bold bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white shadow-lg shadow-rose-500/20 flex items-center justify-center gap-2 cursor-pointer transition-all"
          >
            <Monitor className="w-4 h-4" />
            <span>Select Tab & Share Now</span>
          </button>
        </div>
      </div>
    </div>
  );
};
