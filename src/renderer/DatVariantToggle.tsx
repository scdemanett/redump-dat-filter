import type { DatVariant } from '../shared';

interface DatVariantToggleProps {
  value: DatVariant;
  onChange: (value: DatVariant) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function DatVariantToggle({
  value,
  onChange,
  disabled = false,
  compact = false
}: DatVariantToggleProps) {
  return (
    <div
      className={`theme-toggle${compact ? ' theme-toggle--compact' : ''}${disabled ? ' is-disabled' : ''}`}
      role="group"
      aria-label="DAT variant"
      aria-disabled={disabled}
    >
      <button
        type="button"
        className={`theme-toggle__option ${value === 'standard' ? 'is-active' : ''}`}
        onClick={() => onChange('standard')}
        aria-pressed={value === 'standard'}
        disabled={disabled}
        title="Standard DAT"
      >
        <span>DAT</span>
      </button>
      <button
        type="button"
        className={`theme-toggle__option ${value === 'serial' ? 'is-active' : ''}`}
        onClick={() => onChange('serial')}
        aria-pressed={value === 'serial'}
        disabled={disabled}
        title="DAT + Serial/Version"
      >
        <span>DAT + Serial/Version</span>
      </button>
    </div>
  );
}
