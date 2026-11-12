type Props = {
  size?: number;
  className?: string;
};

/**
 * Supalens brand mark — "Quantum": three circles of descending size in an
 * asymmetric orbit (large ink · mid clay · small faded ink). The ink circles
 * follow currentColor so the mark adapts to the active theme tokens; the mid
 * circle reads var(--clay).
 */
export default function LogoMark({ size = 18, className }: Props) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      fill="none"
      aria-hidden
    >
      <circle cx="18" cy="28" r="13" fill="currentColor" />
      <circle cx="35" cy="15" r="7.5" fill="var(--clay)" />
      <circle cx="38" cy="34" r="3.6" fill="currentColor" opacity="0.5" />
    </svg>
  );
}
