import React from 'react';
import { IconCheck } from '../../components/icons';
import { stepIndex, type PipelineStep } from './pipeline';

/**
 * The step list under "Generating captions". Finished steps get a tick, the
 * current one a spinner plus the server's own words for what it is doing, and
 * the rest wait in grey.
 */
export const PipelineSteps: React.FC<{
  steps: { id: PipelineStep; label: string }[];
  current: PipelineStep;
  /** the live message for the current step, straight from the server */
  detail?: string | null;
  /** 0..1 for the current step, when the server reports it */
  progress?: number | null;
  /** the whole run has finished: every step shows as done */
  finished?: boolean;
  /** shown under the current step instead of a progress bar, e.g. upload bytes */
  extra?: React.ReactNode;
  /** the current step stopped with an error */
  failed?: boolean;
}> = ({ steps, current, detail, progress, finished = false, extra, failed = false }) => {
  const currentIndex = stepIndex(current);
  return (
    <ol className="hm-steps">
      {steps.map((step) => {
        const index = stepIndex(step.id);
        const state =
          finished || index < currentIndex
            ? 'done'
            : index === currentIndex
              ? failed
                ? 'failed'
                : 'active'
              : 'waiting';
        return (
          <li key={step.id} className={`hm-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="hm-step__mark" aria-hidden>
              {state === 'done' ? (
                <IconCheck size={12} />
              ) : state === 'active' ? (
                <span className="hm-step__spin" />
              ) : state === 'failed' ? (
                '!'
              ) : null}
            </span>
            <div className="hm-step__text">
              <span className="hm-step__label">{step.label}</span>
              {state === 'active' && detail && detail !== step.label ? (
                <span className="hm-step__detail">{detail}</span>
              ) : null}
              {state === 'active' && extra ? extra : null}
              {state === 'active' && !extra && progress != null ? (
                <span className="hm-step__bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${Math.min(100, Math.max(2, progress * 100))}%` }} />
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
};
