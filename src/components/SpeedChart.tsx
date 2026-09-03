import { useId } from 'react';

import { formatSpeed } from '../lib/format';
import type { Sample } from '../lib/store';

const WIDTH = 600;
const HEIGHT = 96;

/**
 * Throughput over the last minute.
 *
 * Both series share one vertical scale so their relative size stays readable;
 * a fixed floor keeps an idle connection from magnifying noise into mountains.
 */
export function SpeedChart({ history, label }: { history: Sample[]; label: string }) {
  const id = useId();
  const peak = Math.max(1024, ...history.map((s) => Math.max(s.up, s.down)));

  const path = (pick: (s: Sample) => number) => {
    if (history.length < 2) return '';
    const step = WIDTH / (history.length - 1);
    const points = history.map((sample, i) => {
      const x = i * step;
      const y = HEIGHT - (pick(sample) / peak) * (HEIGHT - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M ${points.join(' L ')}`;
  };

  const area = (pick: (s: Sample) => number) => {
    const line = path(pick);
    return line ? `${line} L ${WIDTH},${HEIGHT} L 0,${HEIGHT} Z` : '';
  };

  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="card__title">{label}</figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: HEIGHT, display: 'block' }}
        role="img"
        aria-label={`${label}: ${formatSpeed(history.at(-1)?.down ?? 0)}`}
      >
        <defs>
          <linearGradient id={`${id}-down`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-up`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#7c5cff" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area((s) => s.down)} fill={`url(#${id}-down)`} />
        <path
          d={path((s) => s.down)}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />

        <path d={area((s) => s.up)} fill={`url(#${id}-up)`} />
        <path
          d={path((s) => s.up)}
          fill="none"
          stroke="#7c5cff"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}
