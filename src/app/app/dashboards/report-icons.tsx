/** Line icons shared by the reports index and the report header (decorative only). */
export const StarIcon = ({ filled, size = 16 }: { filled: boolean; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden>
    <path
      d="M12 3.8l2.45 4.96 5.47.8-3.96 3.86.93 5.45L12 16.3l-4.89 2.57.93-5.45-3.96-3.86 5.47-.8L12 3.8Z"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

export const PencilIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
    <path d="M3 13l2.6-.6 7-7-2-2-7 7L3 13zM9.3 4.7l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const TrashIcon = () => (
  <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ArrowIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden>
    <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
