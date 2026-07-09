import { useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '@/lib/utils'

// Mock 24h throughput (bytes/interval), one point every 2h. Replace with real
// time-series data once the backend keeps bandwidth history.
const HOURS = ['00:00', '02:00', '04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00', '24:00']
const OUT = [1.2, 0.9, 0.7, 1.1, 2.4, 3.1, 4.0, 3.6, 4.8, 5.6, 4.2, 3.0, 2.1].map((v) => v * 1024 * 1024)
const IN = [0.4, 0.3, 0.25, 0.4, 0.9, 1.2, 1.5, 1.3, 1.8, 2.1, 1.6, 1.1, 0.8].map((v) => v * 1024 * 1024)

const PAD = { l: 8, r: 8, t: 14, b: 22 }
const H = 240

export function ThroughputChart() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => setW(Math.max(320, entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { outLine, outArea, inLine, xs, max } = useMemo(() => {
    const n = OUT.length
    const max = Math.max(...OUT, ...IN) * 1.15
    const innerW = w - PAD.l - PAD.r
    const innerH = H - PAD.t - PAD.b
    const xs = OUT.map((_, i) => PAD.l + (innerW * i) / (n - 1))
    const y = (v: number) => PAD.t + innerH - (innerH * v) / max
    const line = (arr: number[]) => arr.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${y(v).toFixed(1)}`).join(' ')
    const outLine = line(OUT)
    const inLine = line(IN)
    const outArea = `${outLine} L${xs[n - 1].toFixed(1)},${(PAD.t + innerH).toFixed(1)} L${xs[0].toFixed(1)},${(PAD.t + innerH).toFixed(1)} Z`
    return { outLine, outArea, inLine, xs, max }
  }, [w])

  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) - ((H - PAD.t - PAD.b) * v) / max

  return (
    <div ref={wrapRef} className="w-full">
      <svg
        width={w}
        height={H}
        className="block"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const x = e.clientX - rect.left
          let best = 0
          let bd = Infinity
          xs.forEach((xx, i) => { const d = Math.abs(xx - x); if (d < bd) { bd = d; best = i } })
          setHover(best)
        }}
      >
        <defs>
          <linearGradient id="egOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(188 84% 53%)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(188 84% 53%)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD.l} x2={w - PAD.r} y1={y(max * f)} y2={y(max * f)} stroke="hsl(210 45% 16%)" strokeWidth="1" strokeDasharray="2 4" />
        ))}

        {/* area + lines */}
        <path d={outArea} fill="url(#egOut)" />
        <path d={outLine} fill="none" stroke="hsl(188 84% 53%)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={inLine} fill="none" stroke="hsl(255 100% 68%)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* x labels */}
        {HOURS.map((h, i) => (i % 2 === 0 ? (
          <text key={h} x={xs[i]} y={H - 6} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>{h}</text>
        ) : null))}

        {/* hover */}
        {hover !== null && (
          <g>
            <line x1={xs[hover]} x2={xs[hover]} y1={PAD.t} y2={H - PAD.b} stroke="hsl(210 45% 24%)" strokeWidth="1" />
            <circle cx={xs[hover]} cy={y(OUT[hover])} r="3.5" fill="hsl(188 84% 53%)" stroke="hsl(218 42% 9%)" strokeWidth="2" />
            <circle cx={xs[hover]} cy={y(IN[hover])} r="3.5" fill="hsl(255 100% 68%)" stroke="hsl(218 42% 9%)" strokeWidth="2" />
          </g>
        )}
      </svg>

      {/* tooltip */}
      {hover !== null && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">{HOURS[hover]}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'hsl(188 84% 53%)' }} /><span className="text-muted-foreground">saída</span> <span className="font-medium text-foreground">{formatBytes(OUT[hover])}</span></span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: 'hsl(255 100% 68%)' }} /><span className="text-muted-foreground">entrada</span> <span className="font-medium text-foreground">{formatBytes(IN[hover])}</span></span>
        </div>
      )}
    </div>
  )
}
