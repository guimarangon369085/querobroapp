type FloatingActionButtonProps = {
  label: string;
  onClick: () => void;
};

export function FloatingActionButton({ label, onClick }: FloatingActionButtonProps) {
  return (
    <button
      type="button"
      className="app-fab"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <span className="app-fab__icon">+</span>
      <span className="app-fab__label">{label}</span>
    </button>
  );
}
