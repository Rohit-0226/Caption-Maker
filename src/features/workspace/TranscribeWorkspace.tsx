import React, { useState } from 'react';
import type { PlayerRef } from '@remotion/player';
import { Tabs } from '../../components/layout';
import { CaptionList } from '../captions/CaptionList';
import { TranscriptionPanel } from '../transcription/TranscriptionPanel';
import { useEditor } from '../../app/store';
import { LANGUAGES } from '../../core/transcription/languages';
import { IconText, IconWaveform } from '../../components/icons';
import type { LanguageCode } from '../../core/types/project';

const TABS = [
  { id: 'captions', label: 'Captions', icon: <IconText size={13} /> },
  { id: 'audio', label: 'Audio & Transcript', icon: <IconWaveform size={13} /> },
];

export const TranscribeWorkspace: React.FC<{
  playerRef: React.RefObject<PlayerRef | null>;
}> = ({ playerRef }) => {
  const [tab, setTab] = useState('captions');
  const project = useEditor((s) => s.project);
  const captionCount = project?.captions.length ?? 0;
  const languageLabel = project?.language
    ? project.language === 'auto'
      ? project.transcript?.detectedLanguage
        ? `Auto (${LANGUAGES[project.transcript.detectedLanguage as LanguageCode]?.label ?? project.transcript.detectedLanguage})`
        : 'Auto Detect'
      : (LANGUAGES[project.language]?.label ?? 'Audio')
    : null;

  return (
    <div className="cm-workspace-panel cm-transcribe-workspace">
      <header className="cm-workspace-panel__head">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <span className="cm-workspace-panel__current">
          {tab === 'captions'
            ? `${captionCount} captions`
            : languageLabel ?? 'Audio'}
        </span>
      </header>
      <div className="cm-workspace-panel__body cm-transcribe-workspace__body">
        {tab === 'captions' ? (
          <CaptionList playerRef={playerRef} />
        ) : (
          <div className="cm-panel__section cm-panel__section--grow">
            <TranscriptionPanel />
          </div>
        )}
      </div>
    </div>
  );
};
