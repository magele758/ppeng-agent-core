'use client';

interface SearchBoxProps {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
}

export function SearchBox({ value, onChange, placeholder, ariaLabel }: SearchBoxProps) {
  return (
    <input
      type="search"
      className="ag-search"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
