export function Card({ className = '', children, ...props }) {
  return (
    <div
      className={`rounded-xl border border-stone-800 bg-stone-900/60 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className = '', children }) {
  return <div className={`p-4 border-b border-stone-800 ${className}`}>{children}</div>;
}

export function CardBody({ className = '', children }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
