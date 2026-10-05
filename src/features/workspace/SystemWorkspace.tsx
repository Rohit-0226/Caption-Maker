import React, { useMemo, useState } from 'react';
import { Tabs } from '../../components/layout';
import { ProjectLibrary } from '../library/ProjectLibrary';
import { ReviewQueue } from '../review/ReviewQueue';
import { QualityPanel } from '../review/QualityPanel';

const TABS = [
  { id: 'projects', label: 'Projects' },
  { id: 'review', label: 'Review' },
  { id: 'quality', label: 'Quality' },
];

/** Everything that is about the project rather than the captions themselves. */
export const SystemWorkspace: React.FC = () => {
  const [tab, setTab] = useState('projects');

  const body = useMemo(() => {
    switch (tab) {
      case 'review':
        return <ReviewQueue />;
      case 'quality':
        return <QualityPanel />;
      default:
        return <ProjectLibrary />;
    }
  }, [tab]);

  return (
    <div className="cm-workspace-panel">
      <header className="cm-workspace-panel__head">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </header>
      <div className="cm-workspace-panel__body">{body}</div>
    </div>
  );
};
