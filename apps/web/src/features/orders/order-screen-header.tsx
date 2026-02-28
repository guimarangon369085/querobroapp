type OrderScreenHeaderProps = {
  chip: string;
  title: string;
  description: string;
  isCalendarScreen: boolean;
  showCleanupButton: boolean;
  cleaningTestData: boolean;
  canCreateOrder: boolean;
  hasSelectedOrder: boolean;
  selectedOrderPaymentStatus: 'PENDENTE' | 'PARCIAL' | 'PAGO';
  onCleanupTestData: () => void;
  onFocusNewOrder: () => void;
  onFocusList: () => void;
  onFocusDetail: () => void;
};

export function OrderScreenHeader({
  chip,
  title,
  description,
  showCleanupButton,
  cleaningTestData,
  onCleanupTestData,
}: OrderScreenHeaderProps) {
  return (
    <>
      <div className="app-section-title app-section-title--compact">
        <div className="flex flex-wrap items-center gap-3">
          <span className="app-chip">{chip}</span>
          <h2 className="text-3xl font-semibold">{title}</h2>
          <p className="text-sm text-neutral-500">{description}</p>
        </div>
      </div>
      {showCleanupButton ? (
        <div className="app-inline-actions mt-3">
          <button
            type="button"
            className="app-button app-button-ghost"
            onClick={onCleanupTestData}
            disabled={cleaningTestData}
          >
            {cleaningTestData ? 'Limpando...' : 'Limpar dados de teste'}
          </button>
        </div>
      ) : null}
    </>
  );
}
