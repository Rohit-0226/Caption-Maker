import React, { useState } from 'react';
import { IconChevron } from './icons';

export const Section: React.FC<{
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, action, children }) => (
  <section className="cm-section">
    <header className="cm-section__header">
      <h3 className="section-title">{title}</h3>
      {action}
    </header>
    <div className="cm-section__body">{children}</div>
  </section>
);

export const Collapsible: React.FC<{
  title: string;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultOpen = false, badge, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="cm-collapsible">
      <button
        type="button"
        className="cm-collapsible__trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevron open={open} size={13} />
        <span className="section-title">{title}</span>
        {badge}
      </button>
      {open ? <div className="cm-collapsible__body">{children}</div> : null}
    </section>
  );
};

export const Tabs: React.FC<{
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="cm-tabs" role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        className={active === tab.id ? 'is-active' : ''}
        onClick={() => onChange(tab.id)}
      >
        {tab.icon ? (
          <span className="cm-tab-icon" style={{ display: 'inline-flex', marginRight: 5, verticalAlign: 'middle' }}>
            {tab.icon}
          </span>
        ) : null}
        <span>{tab.label}</span>
      </button>
    ))}
  </div>
);

/** The top-level pill switch: Captions | Edit. */
export const SegmentTabs: React.FC<{
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}> = ({ tabs, active, onChange }) => (
  <div className="cm-segment-tabs" role="tablist">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        className={active === tab.id ? 'is-active' : ''}
        onClick={() => onChange(tab.id)}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

/**
 * A titled, collapsible block with the chevron on the left, as the reference
 * inspector uses. Open by default because these are the everyday controls.
 */
export const InspectorSection: React.FC<{
  title: string;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, defaultOpen = true, action, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="cm-isection">
      <div className="cm-isection__head">
        <button
          type="button"
          className="cm-isection__trigger"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <IconChevron open={open} size={12} />
          <span className="section-title">{title}</span>
        </button>
        {action}
      </div>
      {open ? <div className="cm-isection__body">{children}</div> : null}
    </section>
  );
};
