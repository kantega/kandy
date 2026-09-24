// Sidebar "Generelt"-ikon. Erstatter det opprinnelige hånd-glyfet fra Handy
// med en minimalistisk mikrofon i strøkstil, matcher lucide-ikonene til de
// andre sidebar-elementene (Cog, History, Info, Sparkles, Cpu, Users). Farge
// arves via `stroke="currentColor"` slik at aktiv-tilstand fungerer.
const MicrophoneOutlineIcon = ({
  width,
  height,
}: {
  width?: number | string;
  height?: number | string;
}) => (
  <svg
    width={width || 24}
    height={height || 24}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    {/* Mic capsule */}
    <rect x="9" y="2" width="6" height="12" rx="3" />
    {/* Boom / arc under capsule */}
    <path d="M5 11a7 7 0 0 0 14 0" />
    {/* Stem */}
    <line x1="12" y1="18" x2="12" y2="22" />
    {/* Base */}
    <line x1="8" y1="22" x2="16" y2="22" />
  </svg>
);

export default MicrophoneOutlineIcon;
