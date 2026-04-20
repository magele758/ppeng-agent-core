'use client';

/**
 * A2UI v0.9 basic catalog renderers (subset).
 *
 * Each renderer reads its props off `component` and uses `evalProp` /
 * `evalText` to resolve Dynamic* values against the live data model. Two-way
 * inputs (TextField, CheckBox, ChoicePicker) extract the bound JSON Pointer
 * from `value: { path: "/..." }` and write changes through `setAt`.
 */

import { type ChangeEvent } from 'react';
import { isPathRef } from '../bindings';
import type { ComponentRenderer } from '../registry';

function actionFrom(component: Record<string, unknown>): { name: string; context: Record<string, unknown> } | undefined {
  const a = component.action;
  if (!a || typeof a !== 'object') return undefined;
  const ev = (a as { event?: unknown }).event;
  if (!ev || typeof ev !== 'object') return undefined;
  const name = (ev as { name?: unknown }).name;
  if (typeof name !== 'string' || !name) return undefined;
  const context = (ev as { context?: unknown }).context;
  return {
    name,
    context: context && typeof context === 'object' ? (context as Record<string, unknown>) : {}
  };
}

function pathFromValueRef(component: Record<string, unknown>): string | undefined {
  if (isPathRef(component.value)) return (component.value as { path: string }).path;
  return undefined;
}

const Text: ComponentRenderer = ({ component, evalText }) => {
  const text = evalText(component.text);
  const variant = typeof component.variant === 'string' ? component.variant : 'body';
  const className = `a2ui-text a2ui-text--${variant}`;
  if (variant === 'h1') return <h1 className={className}>{text}</h1>;
  if (variant === 'h2') return <h2 className={className}>{text}</h2>;
  if (variant === 'h3') return <h3 className={className}>{text}</h3>;
  if (variant === 'caption') return <small className={className}>{text}</small>;
  return <span className={className}>{text}</span>;
};

const Icon: ComponentRenderer = ({ component }) => {
  const name = typeof component.name === 'string' ? component.name : '';
  return (
    <span className="a2ui-icon" aria-label={name} title={name}>
      [{name}]
    </span>
  );
};

const Image: ComponentRenderer = ({ component, evalText }) => {
  const url = evalText(component.url ?? component.src);
  const alt = evalText(component.alt) || 'image';
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="a2ui-image" src={url} alt={alt} />;
};

const Divider: ComponentRenderer = ({ component }) => {
  const axis = component.axis === 'vertical' ? 'vertical' : 'horizontal';
  return <hr className={`a2ui-divider a2ui-divider--${axis}`} />;
};

const Card: ComponentRenderer = ({ renderChildren }) => {
  return <div className="a2ui-card">{renderChildren()}</div>;
};

const Column: ComponentRenderer = ({ renderChildren, component }) => {
  const align = typeof component.align === 'string' ? component.align : 'stretch';
  const justify = typeof component.justify === 'string' ? component.justify : 'start';
  return (
    <div className={`a2ui-column a2ui-column--align-${align} a2ui-column--justify-${justify}`}>
      {renderChildren()}
    </div>
  );
};

const Row: ComponentRenderer = ({ renderChildren, component }) => {
  const align = typeof component.align === 'string' ? component.align : 'center';
  const justify = typeof component.justify === 'string' ? component.justify : 'start';
  return (
    <div className={`a2ui-row a2ui-row--align-${align} a2ui-row--justify-${justify}`}>{renderChildren()}</div>
  );
};

const ListContainer: ComponentRenderer = ({ renderChildren }) => {
  return <ul className="a2ui-list">{renderChildren()}</ul>;
};

const Button: ComponentRenderer = ({ component, renderChild, evalText, dispatchAction }) => {
  const action = actionFrom(component);
  const variant = typeof component.variant === 'string' ? component.variant : 'default';
  const labelChild = typeof component.child === 'string' ? renderChild(component.child) : null;
  const fallbackText = evalText(component.text);
  return (
    <button
      type="button"
      className={`a2ui-button a2ui-button--${variant}`}
      onClick={() => action && dispatchAction(action.name, action.context)}
      disabled={!action}
    >
      {labelChild ?? fallbackText ?? 'Button'}
    </button>
  );
};

const TextField: ComponentRenderer = ({ component, evalText, evalProp, setAt }) => {
  const path = pathFromValueRef(component);
  const value = path ? (evalProp({ path }) as unknown) : evalProp(component.value);
  const label = evalText(component.label);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (path) setAt(path, e.target.value);
  };
  return (
    <label className="a2ui-textfield">
      {label ? <span className="a2ui-textfield__label">{label}</span> : null}
      <input
        className="a2ui-textfield__input"
        type="text"
        value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        onChange={onChange}
        readOnly={!path}
      />
    </label>
  );
};

const CheckBox: ComponentRenderer = ({ component, evalText, evalProp, setAt }) => {
  const path = pathFromValueRef(component);
  const value = path ? (evalProp({ path }) as unknown) : evalProp(component.value);
  const label = evalText(component.label);
  return (
    <label className="a2ui-checkbox">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => path && setAt(path, e.target.checked)}
        disabled={!path}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
};

const ChoicePicker: ComponentRenderer = ({ component, evalProp, setAt, evalText }) => {
  const options = Array.isArray(component.options) ? (component.options as Array<{ label?: unknown; value?: unknown }>) : [];
  const path = pathFromValueRef(component);
  const current = path ? (evalProp({ path }) as unknown) : evalProp(component.value);
  const variant = component.variant === 'mutuallyExclusive' ? 'radio' : 'select';
  if (variant === 'radio') {
    return (
      <div className="a2ui-choice a2ui-choice--radio">
        {options.map((opt, i) => {
          const v = opt.value;
          const checked =
            Array.isArray(current) ? current.includes(v) : current === v;
          return (
            <label key={i} className="a2ui-choice__option">
              <input
                type="radio"
                name={path ?? `choice-${i}`}
                checked={checked}
                onChange={() => path && setAt(path, [v])}
              />
              <span>{evalText(opt.label) || String(v ?? '')}</span>
            </label>
          );
        })}
      </div>
    );
  }
  return (
    <select
      className="a2ui-choice a2ui-choice--select"
      value={typeof current === 'string' ? current : ''}
      onChange={(e) => path && setAt(path, e.target.value)}
    >
      {options.map((opt, i) => (
        <option key={i} value={String(opt.value ?? '')}>
          {evalText(opt.label) || String(opt.value ?? '')}
        </option>
      ))}
    </select>
  );
};

export const BASIC_RENDERERS: Record<string, ComponentRenderer> = {
  Text,
  Icon,
  Image,
  Divider,
  Card,
  Column,
  Row,
  List: ListContainer,
  Button,
  TextField,
  CheckBox,
  ChoicePicker
};
