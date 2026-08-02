const VARIANTS = {
  primary: 'bg-amber-500 text-stone-950 hover:bg-amber-400 focus-visible:outline-amber-500',
  secondary: 'bg-stone-800 text-stone-100 hover:bg-stone-700 focus-visible:outline-stone-500',
  ghost: 'bg-transparent text-stone-300 hover:bg-stone-800 focus-visible:outline-stone-500',
  danger: 'bg-rose-600/90 text-white hover:bg-rose-600 focus-visible:outline-rose-500',
};

const SIZES = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
  icon: 'p-2',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition-colors
        disabled:opacity-50 disabled:pointer-events-none
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
