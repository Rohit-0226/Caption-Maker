import React, { useMemo, useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { Tabs } from '../../components/layout';
import { TemplatesPanel } from '../styling/TemplatesPanel';
import { TransitionsTab } from '../styling/TransitionsTab';
import { FontBrowser } from '../gallery/FontBrowser';
import { useEditor } from '../../app/store';
import { getEnterAnimation } from '../../core/rendering/animations';
import { getStylePreset } from '../../core/rendering/presets';

const TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'motion', label: 'Motion' },
  { id: 'fonts', label: 'Fonts' },
];

/**
 * Everything that decides how captions look, in one place.
 *
 * These used to be spread across the rail and two levels of inspector tabs,
 * which meant fonts had two homes and templates had none you could reach from
 * the rail. Browsing belongs in the wide panel, where the cards have room.
 */
export const PresetsWorkspace: React.FC<{
  playerRef?: React.RefObject<PlayerRef | null>;
}> = ({ playerRef }) => {
  const [tab, setTab] = useState('templates');
  const animation = useEditor((s) => s.project?.animation);
  const fontFamily = useEditor((s) => s.project?.style.fontFamily);
  const lastAppliedPresetId = useEditor((s) => s.lastAppliedPresetId);
  const activePreset = lastAppliedPresetId ? getStylePreset(lastAppliedPresetId) : null;

  const body = useMemo(() => {
    switch (tab) {
      case 'motion':
        return <TransitionsTab playerRef={playerRef} />;
      case 'fonts':
        return <FontBrowser />;
      default:
        return <TemplatesPanel />;
    }
  }, [tab, playerRef]);

  // a one-line reminder of what is currently applied, so the panel is not
  // just a shop — it tells you where you already are
  const summary =
    tab === 'templates'
      ? activePreset
        ? `Active: ${activePreset.name}`
        : null
      : tab === 'motion'
        ? animation && getEnterAnimation(animation.enter).label
        : tab === 'fonts'
          ? fontFamily
          : null;

  return (
    <div className="cm-workspace-panel">
      <header className="cm-workspace-panel__head">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        {summary ? <span className="cm-workspace-panel__current">{summary}</span> : null}
      </header>
      <div className="cm-workspace-panel__body">{body}</div>
    </div>
  );
};
