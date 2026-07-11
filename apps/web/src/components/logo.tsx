export function EveMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 78 25"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M77.7002 3.89551H54.0762L37.5781 24.3818H32.3486L36.5322 19.1729L51.958 0H77.7002V3.89551ZM21.0898 24.3721H0V20.4766H21.0898V24.3721ZM77.7012 20.4766V24.3721H56.6104V20.4766H77.7012ZM17.7744 14.0537H0V10.1582H17.7744V14.0537ZM77.7012 14.0537H59.9268V10.1582H77.7012V14.0537ZM34.7197 3.89551H0V0H34.7197V3.89551Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function StudioLockup({
  markClassName = "h-[15px]",
  wordClassName = "text-[15px]",
}: {
  markClassName?: string
  wordClassName?: string
}) {
  return (
    <span className="inline-flex items-center gap-2.5" role="img" aria-label="eve Studio">
      <EveMark className={`w-auto ${markClassName}`} />
      <span className={`font-mono font-medium uppercase tracking-widest ${wordClassName}`}>
        Studio
      </span>
    </span>
  )
}
