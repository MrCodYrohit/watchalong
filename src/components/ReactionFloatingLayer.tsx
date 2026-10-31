import React, { useEffect, useState } from 'react';
import { ReactionEvent } from '../types';

interface ReactionFloatingLayerProps {
  reactions: ReactionEvent[];
}

interface FloatingItem extends ReactionEvent {
  leftPercent: number;
}

export const ReactionFloatingLayer: React.FC<ReactionFloatingLayerProps> = ({ reactions }) => {
  const [activeItems, setActiveItems] = useState<FloatingItem[]>([]);

  useEffect(() => {
    if (reactions.length === 0) return;
    const latest = reactions[reactions.length - 1];

    const newItem: FloatingItem = {
      ...latest,
      leftPercent: 20 + Math.random() * 60, // distribute across 20% to 80%
    };

    setActiveItems((prev) => [...prev.slice(-20), newItem]);

    const timer = setTimeout(() => {
      setActiveItems((prev) => prev.filter((item) => item.id !== newItem.id));
    }, 3500);

    return () => clearTimeout(timer);
  }, [reactions]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
      {activeItems.map((item) => (
        <div
          key={item.id}
          className="absolute bottom-16 animate-float-up flex flex-col items-center select-none"
          style={{ left: `${item.leftPercent}%` }}
        >
          <div className="text-4xl filter drop-shadow-lg transform transition-transform duration-300 hover:scale-125 animate-wiggle">
            {item.emoji}
          </div>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md text-zinc-300 border border-white/10 mt-1 shadow-sm whitespace-nowrap">
            {item.senderName}
          </span>
        </div>
      ))}
    </div>
  );
};
