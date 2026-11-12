export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={small ? 22 : 30} height={small ? 22 : 30} viewBox="0 0 64 64" aria-hidden>
        <defs>
          <radialGradient id="bg" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fff" />
            <stop offset=".35" stopColor="#a78bfa" />
            <stop offset="1" stopColor="#7c5cff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <line x1="16" y1="20" x2="48" y2="44" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" />
        <circle cx="16" cy="20" r="12" fill="url(#bg)" />
        <circle cx="48" cy="44" r="12" fill="url(#bg)" />
      </svg>
      <span className={`font-display font-semibold tracking-tight ${small ? "text-sm" : "text-lg"}`}>
        Unleash <span className="text-mist font-medium">the</span> Agents
      </span>
    </div>
  );
}
