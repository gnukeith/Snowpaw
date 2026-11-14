/** Snowpaw's mark. The caller sizes and colours it. */
export function Paw({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="16 36 480 480" aria-hidden="true">
      <ellipse cx="146" cy="232" rx="38" ry="50" transform="rotate(-24 146 232)" />
      <ellipse cx="214" cy="160" rx="40" ry="54" transform="rotate(-8 214 160)" />
      <ellipse cx="298" cy="160" rx="40" ry="54" transform="rotate(8 298 160)" />
      <ellipse cx="366" cy="232" rx="38" ry="50" transform="rotate(24 366 232)" />
      <path d="M256 250c-62 0-112 52-112 104 0 36 28 56 60 56 20 0 34-8 52-8s32 8 52 8c32 0 60-20 60-56 0-52-50-104-112-104z" />
    </svg>
  );
}
