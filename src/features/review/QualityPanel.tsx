import React, { useCallback, useEffect, useState } from 'react';
import { api, type QAReport } from '../../app/api';
import { useEditor } from '../../app/store';
import { SAFE_ZONES, type SafeZonePlatform } from '../../core/rendering/safeZones';
import { Button, Field, Select } from '../../components/controls';
import { Banner, ErrorState, Spinner } from '../../components/feedback';

/**
 * The pre-export check, on its own so it can be run at any time rather than
 * only when the export dialog happens to be open.
 */
export const QualityPanel: React.FC = () => {
  const projectId = useEditor((s) => s.project?.id);
  const captionCount = useEditor((s) => s.project?.captions.length ?? 0);
  const selectCaption = useEditor((s) => s.selectCaption);
  const captions = useEditor((s) => s.project?.captions);

  const [zone, setZone] = useState<SafeZonePlatform>('none');
  const [report, setReport] = useState<QAReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await api.captionQA(projectId, zone === 'none' ? undefined : zone));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [projectId, zone]);

  // a stale report is worse than none, so clear it when the captions change
  useEffect(() => setReport(null), [captionCount]);

  return (
    <div className="cm-quality">
      <Field label="Check against" hint="Platform interface areas are optional.">
        <Select<SafeZonePlatform>
          value={zone}
          ariaLabel="Safe zone to check"
          options={SAFE_ZONES.map((z) => ({ value: z.id, label: z.label }))}
          onChange={setZone}
        />
      </Field>

      <Button block variant="primary" loading={busy} onClick={() => void run()}>
        Check captions
      </Button>

      {busy ? <Spinner size={14} label="Checking" /> : null}

      {error ? (
        <ErrorState title="Check failed" message={error} onRetry={() => void run()} />
      ) : null}

      {report ? (
        <>
          <Banner tone={report.status === 'good' ? 'success' : 'warning'}>
            {report.status === 'good'
              ? `All ${report.checked} captions look good.`
              : `${report.issues.length} thing${report.issues.length === 1 ? '' : 's'} to look at.`}
          </Banner>

          {report.issues.length > 0 ? (
            <ul className="cm-quality__issues">
              {report.issues.map((issue, i) => (
                <li key={i} className={`cm-quality__issue is-${issue.severity}`}>
                  <span>{issue.message}</span>
                  {issue.captionNumber && captions ? (
                    <button
                      type="button"
                      className="cm-quality__jump"
                      onClick={() => {
                        const caption = captions[issue.captionNumber! - 1];
                        if (caption) selectCaption(caption.id);
                      }}
                    >
                      Go to {issue.captionNumber}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
