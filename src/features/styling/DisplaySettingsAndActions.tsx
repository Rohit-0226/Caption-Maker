import React, { useMemo } from 'react';
import { useEditor } from '../../app/store';

export const DisplaySettingsAndActions: React.FC = () => {
  const segmentation = useEditor((s) => s.project?.segmentation);
  const style = useEditor((s) => s.project?.style);
  const captions = useEditor((s) => s.project?.captions ?? []);
  const updateSegmentation = useEditor((s) => s.updateSegmentation);
  const updateStyle = useEditor((s) => s.updateStyle);
  const regenerateCaptions = useEditor((s) => s.regenerateCaptions);
  const togglePunctuation = useEditor((s) => s.togglePunctuation);
  const addPunctuation = useEditor((s) => s.addPunctuation);
  const removePunctuation = useEditor((s) => s.removePunctuation);
  const clearAllEmphasis = useEditor((s) => s.clearAllEmphasis);
  const toggleCaptionGaps = useEditor((s) => s.toggleCaptionGaps);

  const hasPunctuation = useMemo(() => {
    return captions.some((c) => c.words.some((w) => /[.?!,;:]+/.test(w.text)));
  }, [captions]);

  const gapsRemoved = useMemo(() => {
    return captions.some((c) => c.gapRestoreEnd !== undefined);
  }, [captions]);

  const emphasisRemoved = !style?.emphasisEnabled;

  if (!segmentation || !style) return null;

  const handleWordsChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = Number(e.target.value);
    updateSegmentation({ maxWordsPerLine: val });
    setTimeout(() => regenerateCaptions(), 100);
  };

  const handleLinesChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = Number(e.target.value) as 1 | 2 | 3;
    updateSegmentation({ maxLines: val });
    setTimeout(() => regenerateCaptions(), 100);
  };

  const handleMaxCharsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    if (!isNaN(val) && val > 0) {
      updateSegmentation({ maxCharacters: val });
      setTimeout(() => regenerateCaptions(), 150);
    }
  };

  const handleResetMaxChars = () => {
    updateSegmentation({ maxCharacters: 20 });
    setTimeout(() => regenerateCaptions(), 100);
  };

  return (
    <div className="cm-display-settings-section">
      {/* 1. DISPLAY SETTINGS */}
      <div className="cm-section-divider-title">
        <span>Display Settings</span>
      </div>

      <div className="cm-display-grid">
        {/* Words */}
        <div className="cm-display-col">
          <label className="cm-display-label">Words</label>
          <div className="cm-display-box" title="Words per line budget">
            <span className="cm-display-icon">T</span>
            <select
              className="cm-display-select"
              value={segmentation.maxWordsPerLine}
              onChange={handleWordsChange}
              aria-label="Words per line"
            >
              <option value="4">Default</option>
              <option value="1">1 Word</option>
              <option value="2">2 Words</option>
              <option value="3">3 Words</option>
              <option value="4">4 Words</option>
              <option value="5">5 Words</option>
              <option value="6">6 Words</option>
              <option value="7">7 Words</option>
              <option value="8">8 Words</option>
            </select>
          </div>
        </div>

        {/* Max Chars */}
        <div className="cm-display-col">
          <label className="cm-display-label">Max Chars</label>
          <div className="cm-display-box" title="Maximum characters per caption">
            <span className="cm-display-icon">T</span>
            <input
              type="number"
              className="cm-display-input"
              value={segmentation.maxCharacters}
              onChange={handleMaxCharsChange}
              min={10}
              max={200}
              aria-label="Max characters"
            />
            <button
              type="button"
              className="cm-display-reset-btn"
              onClick={handleResetMaxChars}
              title="Reset characters to default (20)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Lines */}
        <div className="cm-display-col">
          <label className="cm-display-label">Lines</label>
          <div className="cm-display-box" title="Maximum lines per caption">
            <span className="cm-display-icon">≡</span>
            <select
              className="cm-display-select"
              value={segmentation.maxLines}
              onChange={handleLinesChange}
              aria-label="Max lines"
            >
              <option value="1">1 Line</option>
              <option value="2">2 Lines</option>
              <option value="3">3 Lines</option>
            </select>
          </div>
        </div>
      </div>

      {/* 2. ACTIONS */}
      <div className="cm-section-divider-title" style={{ marginTop: '14px' }}>
        <span>Actions</span>
      </div>

      <div className="cm-actions-list">
        {/* Action 1: Remove Punctuation */}
        <div className="cm-action-card">
          <div className="cm-action-badge" title="Punctuation">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" />
              <path d="m5 11 9 9" />
            </svg>
          </div>
          <div className="cm-action-info">
            <div className="cm-action-title">Remove Punctuation</div>
            <div className="cm-action-desc">Strip all punctuation for a cleaner, minimal look</div>
          </div>
          <label className="cm-pill-switch" title={!hasPunctuation ? 'Punctuation is removed (Click to restore punctuation)' : 'Remove all punctuation'}>
            <input
              type="checkbox"
              checked={!hasPunctuation}
              onChange={(e) => {
                if (e.target.checked) {
                  removePunctuation();
                } else {
                  addPunctuation();
                }
              }}
            />
            <span className="cm-pill-slider" />
          </label>
        </div>

        {/* Action 2: Remove Emphasis */}
        <div className="cm-action-card">
          <div className="cm-action-badge" title="Emphasis">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div className="cm-action-info">
            <div className="cm-action-title">Remove Emphasis</div>
            <div className="cm-action-desc">Remove all text emphasis for uniform appearance</div>
          </div>
          <label className="cm-pill-switch" title={emphasisRemoved ? 'Emphasis is removed (Click to enable)' : 'Remove all emphasis'}>
            <input
              type="checkbox"
              checked={emphasisRemoved}
              onChange={(e) => {
                if (e.target.checked) {
                  clearAllEmphasis();
                  updateStyle({ emphasisEnabled: false });
                } else {
                  updateStyle({ emphasisEnabled: true });
                }
              }}
            />
            <span className="cm-pill-slider" />
          </label>
        </div>

        {/* Action 3: Remove Gaps in Captions */}
        <div className="cm-action-card">
          <div className="cm-action-badge" title="Gaps">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M9 3v18" />
              <path d="M15 3v18" />
            </svg>
          </div>
          <div className="cm-action-info">
            <div className="cm-action-title">Remove Gaps in Captions</div>
            <div className="cm-action-desc">Eliminate gaps between captions for seamless flow</div>
          </div>
          <label className="cm-pill-switch" title={gapsRemoved ? 'Gaps are removed (Click to restore gaps)' : 'Remove gaps between captions'}>
            <input
              type="checkbox"
              checked={gapsRemoved}
              onChange={(e) => toggleCaptionGaps(e.target.checked)}
            />
            <span className="cm-pill-slider" />
          </label>
        </div>
      </div>
    </div>
  );
};
