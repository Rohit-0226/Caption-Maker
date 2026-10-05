import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type AICommandResult,
  type AIStatus,
  type QAReport,
} from '../../app/api';
import { useEditor } from '../../app/store';
import { playbackClock } from '../../app/playbackClock';
import { Button } from '../../components/controls';
import { Banner, ErrorState, Spinner } from '../../components/feedback';
import { IconCheck, IconSparkle, IconX, IconZap } from '../../components/icons';
import { applyActions, type AIChange } from '../../core/ai/executor';
import type { AIAction } from '../../core/ai/actions';
import { interpretCommandLocally } from '../../core/ai/localInterpreter';

interface HistoryEntry {
  id: string;
  prompt: string;
  changes: { label: string; before: string; after: string }[];
  at: string;
}

const EXAMPLES = [
  'Make every caption first word or letter uppercase',
  'Apply Hormozi style with punchy green highlight',
  'Make all captions 2-3 words per line',
  'Make spoken word bright yellow with subtle pop',
  'Move captions into safe zone area',
  'Highlight keywords in red with bold outline',
  'Check project for sync & readability issues',
];

const QAList: React.FC<{ report: QAReport }> = ({ report }) => (
  <div className="cm-ai__qa">
    <Banner tone={report.status === 'good' ? 'success' : 'warning'}>
      {report.status === 'good'
        ? `All ${report.checked} captions look good.`
        : `${report.issues.length} thing${report.issues.length === 1 ? '' : 's'} to look at across ${report.checked} captions.`}
    </Banner>
    {report.issues.length > 0 ? (
      <ul className="cm-ai__issues">
        {report.issues.slice(0, 12).map((issue, i) => (
          <li key={i} className={`cm-ai__issue is-${issue.severity}`}>
            {issue.message}
          </li>
        ))}
        {report.issues.length > 12 ? (
          <li className="cm-ai__issue">…and {report.issues.length - 12} more.</li>
        ) : null}
      </ul>
    ) : null}
  </div>
);

export const AIPanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const selectedCaptionId = useEditor((s) => s.selectedCaptionId);
  const update = useEditor((s) => s.update);
  const undo = useEditor((s) => s.undo);
  const canUndo = useEditor((s) => s.past.length > 0);

  const [status, setStatus] = useState<AIStatus | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AICommandResult | null>(null);
  const [autoApply, setAutoApply] = useState(true);
  const [lastApplied, setLastApplied] = useState<{
    prompt: string;
    reply: string;
    changes: AIChange[];
    offline?: boolean;
  } | null>(null);
  const [qa, setQa] = useState<QAReport | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.aiStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const executeActions = useCallback(
    (actions: AIAction[], reply: string, changes: AIChange[], offline = false) => {
      const currentProject = useEditor.getState().project;
      if (!currentProject) return;

      const applied = applyActions(currentProject, actions, {
        selectedCaptionIds: selectedCaptionId ? [selectedCaptionId] : [],
      });

      // One undoable transaction covering every slice the assistant touched.
      update(
        {
          captions: applied.project.captions,
          style: applied.project.style,
          position: applied.project.position,
          animation: applied.project.animation,
          background: applied.project.background,
          segmentation: applied.project.segmentation,
          transcript: applied.project.transcript,
        },
        { history: true },
      );

      void useEditor.getState().save();

      const finalChanges = changes && changes.length > 0 ? changes : applied.changes;
      setLastApplied({
        prompt: prompt.trim(),
        reply,
        changes: finalChanges,
        offline,
      });

      setHistory((h) => [
        {
          id: `${Date.now()}`,
          prompt: prompt.trim(),
          changes: finalChanges,
          at: new Date().toLocaleTimeString(),
        },
        ...h,
      ].slice(0, 20));

      setPending(null);
      setPrompt('');
      inputRef.current?.focus();
    },
    [prompt, selectedCaptionId, update],
  );

  const ask = useCallback(async () => {
    const text = prompt.trim();
    const liveProject = useEditor.getState().project ?? project;
    if (!liveProject || !text) return;

    setBusy(true);
    setError(null);
    setPending(null);
    setQa(null);
    setLastApplied(null);

    try {
      const result = await api.aiCommand(
        liveProject.id,
        text,
        selectedCaptionId ? [selectedCaptionId] : [],
        playbackClock.getTime(),
        liveProject,
      );

      if (result.qa) setQa(result.qa);

      if (autoApply && result.actions && result.actions.length > 0) {
        executeActions(result.actions, result.reply, result.changes, false);
      } else {
        setPending(result);
      }
    } catch (e) {
      // Cloud AI failed or offline — try deterministic local interpreter!
      const localActions = interpretCommandLocally(liveProject, text, {
        selectedCaptionIds: selectedCaptionId ? [selectedCaptionId] : [],
      });

      if (localActions && localActions.length > 0) {
        executeActions(localActions, 'Applied instantly (offline mode).', [], true);
      } else {
        setError(e instanceof ApiError ? e.message : (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }, [autoApply, executeActions, project, prompt, selectedCaptionId]);

  const applyPending = useCallback(() => {
    if (!pending) return;
    if (pending.actions && pending.actions.length > 0) {
      executeActions(pending.actions, pending.reply, pending.changes, false);
    } else {
      const currentProject = useEditor.getState().project ?? project;
      if (!currentProject) return;
      const next = pending.project;
      update(
        {
          captions: next.captions,
          style: next.style,
          position: next.position,
          animation: next.animation,
          background: next.background,
          segmentation: next.segmentation,
          transcript: next.transcript,
        },
        { history: true },
      );
      setPending(null);
      setPrompt('');
      inputRef.current?.focus();
    }
  }, [pending, executeActions, project, update]);

  if (!project) return null;

  const notConfigured = status && !status.configured;

  return (
    <section className="cm-ai">
      <div className="cm-ai__composer">
        <textarea
          ref={inputRef}
          className="cm-ai__input"
          value={prompt}
          rows={3}
          placeholder="Ask Caption Maker to change something (e.g. uppercase, colors, fonts, layout)…"
          aria-label="Ask Caption Maker"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter makes a new line
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
        />
        <Button
          variant="primary"
          block
          loading={busy}
          disabled={!prompt.trim()}
          icon={<IconSparkle size={14} />}
          onClick={() => void ask()}
        >
          {autoApply ? 'Run AI' : 'Preview AI'}
        </Button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 2px 2px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-muted, #94A3B8)' }}>
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(e) => setAutoApply(e.target.checked)}
            />
            Auto-apply to video
          </label>
          {canUndo ? (
            <button
              type="button"
              className="cm-chip"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={() => undo()}
            >
              Undo
            </button>
          ) : null}
        </div>
      </div>

      {notConfigured ? (
        <Banner tone="info">
          Offline fallback active. Connect AI API key in <code>.env</code> for full conversational capabilities.
        </Banner>
      ) : null}

      {lastApplied ? (
        <div className="cm-ai__proposal" style={{ borderLeft: '3px solid var(--accent, #4ADE80)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-bright, #fff)', fontSize: 13 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {lastApplied.offline ? <IconZap size={13} /> : <IconCheck size={13} />}
                {lastApplied.offline ? 'Applied (Offline Mode)' : 'Changes Applied to Video'}
              </span>
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  undo();
                  setLastApplied(null);
                }}
              >
                Undo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLastApplied(null)}
                aria-label="Dismiss"
              >
                <IconX size={13} />
              </Button>
            </div>
          </div>
          {lastApplied.reply ? <p className="cm-ai__reply">{lastApplied.reply}</p> : null}
          {lastApplied.changes.length > 0 ? (
            <ul className="cm-ai__changes">
              {lastApplied.changes.map((change, i) => (
                <li key={i}>
                  <span className="cm-ai__change-label">{change.label}</span>
                  <span className="cm-ai__change-value mono">
                    {change.before} → {change.after}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!pending && !busy && !error && !lastApplied ? (
        <div className="cm-ai__examples">
          <span className="cm-field__hint">Try:</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="cm-chip"
              onClick={() => {
                setPrompt(example);
                inputRef.current?.focus();
              }}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {busy ? <Spinner size={14} label="Thinking" /> : null}

      {error ? (
        <ErrorState
          title="The assistant could not answer"
          message={error}
          onRetry={() => void ask()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {pending ? (
        <div className="cm-ai__proposal">
          {pending.reply ? <p className="cm-ai__reply">{pending.reply}</p> : null}

          {pending.changes.length > 0 ? (
            <>
              <h4 className="section-title">Proposed changes</h4>
              <ul className="cm-ai__changes">
                {pending.changes.map((change, i) => (
                  <li key={i}>
                    <span className="cm-ai__change-label">{change.label}</span>
                    <span className="cm-ai__change-value mono">
                      {change.before} → {change.after}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="cm-field__hint">Nothing needed changing.</p>
          )}

          {pending.rejected.length > 0 ? (
            <ul className="cm-ai__issues">
              {pending.rejected.map((reason, i) => (
                <li key={i} className="cm-ai__issue is-warning">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}

          {pending.changes.length > 0 ? (
            <div className="cm-ai__actions">
              <Button variant="primary" onClick={applyPending}>
                Apply
              </Button>
              <Button variant="ghost" onClick={() => setPending(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="cm-ai__actions">
              <Button variant="ghost" onClick={() => setPending(null)}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {qa ? <QAList report={qa} /> : null}

      {history.length > 0 ? (
        <div className="cm-ai__history">
          <div className="cm-ai__history-head">
            <h4 className="section-title">Recent</h4>
            <Button size="sm" variant="ghost" disabled={!canUndo} onClick={undo}>
              Undo last
            </Button>
          </div>
          {history.map((entry) => (
            <div key={entry.id} className="cm-ai__history-item">
              <div className="cm-ai__history-prompt truncate" title={entry.prompt}>
                {entry.prompt}
              </div>
              <div className="cm-ai__history-changes">
                {entry.changes.slice(0, 3).map((c, i) => (
                  <span key={i}>
                    {c.label}: {c.before} → {c.after}
                  </span>
                ))}
                {entry.changes.length > 3 ? (
                  <span>…and {entry.changes.length - 3} more</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};
