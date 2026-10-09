'use client';

import { useId, useState, type ReactNode } from 'react';

interface DisclosureProps {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/** 本地折叠区：用于「高级选项」，不依赖全局高级开关。 */
export function Disclosure({ label, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <div className="ag-disclosure">
      <button
        type="button"
        className="ag-disclosure__toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true" className="ag-disclosure__caret">{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open ? (
        <div id={bodyId} className="ag-disclosure__body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
