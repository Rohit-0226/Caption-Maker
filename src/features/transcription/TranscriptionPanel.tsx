import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, subscribeToJobs, type JobState, type ProviderSummary } from '../../app/api';
import { useEditor } from '../../app/store';
import { HINGLISH_DOMAINS, LANGUAGES, LANGUAGE_ORDER } from '../../core/transcription/languages';
import type { HinglishDomain, LanguageCode } from '../../core/types/project';
import { Button, Field, Select } from '../../components/controls';
import { Banner, ErrorState, ProgressBar } from '../../components/feedback';
import { IconAlert, IconSparkle, IconTrash, IconUpload, IconX } from '../../components/icons';

export const TranscriptionPanel: React.FC = () => {
  const project = useEditor((s) => s.project);
  const setProject = useEditor((s) => s.setProject);

  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [termDraft, setTermDraft] = useState('');
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const importSubtitles = useEditor((s) => s.importSubtitles);
  const [srtNotice, setSrtNotice] = useState<string | null>(null);
  const [srtError, setSrtError] = useState<string | null>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  const onSrtFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSrtError(null);
    setSrtNotice(null);
    try {
      const text = await file.text();
      const res = importSubtitles(text);
      setSrtNotice(`Successfully imported ${res.count} captions (${res.words} words) from ${file.name}.`);
    } catch (err) {
      setSrtError((err as Error).message);
    }
    e.target.value = '';
  };

  const language = project?.language ?? 'auto';
  const hinglishDomain = project?.hinglishDomain ?? 'general';
  const transcript = project?.transcript ?? null;
  const projectId = project?.id;
  const terminology = project?.terminology;

  useEffect(() => {
    setTermDraft(terminology?.terms.join('\n') ?? '');
  }, [projectId, terminology?.terms]);

  useEffect(() => {
    api
      .providers()
      .then((list) => {
        setProviders(list);
        setProviderId((current) => current ?? list.find((p) => p.configured)?.id ?? list[0]?.id ?? null);
      })
      .catch(() => setProviders([]));
  }, []);

  // follow job progress and reload the project when a run finishes
  useEffect(() => {
    if (!projectId) return;
    return subscribeToJobs(projectId, (update) => {
      if (update.type !== 'transcribe') return;
      setJob(update);
      if (update.status === 'done') {
        void api.loadProject(projectId).then(setProject);
      }
    });
  }, [projectId, setProject]);

  const activeProvider = useMemo(
    () => providers.find((p) => p.id === providerId) ?? null,
    [providers, providerId],
  );

  const languageSupported =
    !activeProvider || activeProvider.supportedLanguages.includes(language);

  const running = job?.status === 'running';

  const transcribe = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setStarting(true);
    try {
      const started = await api.transcribe(projectId, providerId, language, hinglishDomain);
      setJob(started);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setStarting(false);
    }
  }, [projectId, providerId, language, hinglishDomain]);

  const translateWithAI = useCallback(async (target: LanguageCode) => {
    if (!projectId) return;
    setError(null);
    setStarting(true);
    try {
      const started = await api.translateProject(projectId, target);
      setJob(started);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setStarting(false);
    }
  }, [projectId]);

  const cancel = useCallback(async () => {
    if (job) await api.cancelJob(job.id).catch(() => undefined);
  }, [job]);

  const uploadPdf = useCallback(async (file: File) => {
    if (!projectId) return;
    setPdfError(null);
    setUploadingPdf(true);
    try {
      const updated = await api.uploadTerminologyPdf(projectId, file);
      setProject(updated);
    } catch (e) {
      setPdfError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setUploadingPdf(false);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
    }
  }, [projectId, setProject]);

  const removePdf = useCallback(async () => {
    if (!projectId) return;
    setPdfError(null);
    try {
      setProject(await api.removeTerminologyPdf(projectId));
    } catch (e) {
      setPdfError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  }, [projectId, setProject]);

  const saveTermDraft = useCallback(() => {
    if (!project?.terminology) return;
    const seen = new Set<string>();
    const terms = termDraft
      .split(/[\n,]+/)
      .map((term) => term.trim())
      .filter((term) => {
        const key = term.toLocaleLowerCase('en');
        if (!term || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 200);
    if (terms.join('\n') === project.terminology.terms.join('\n')) return;
    useEditor.getState().update({
      terminology: {
        ...project.terminology,
        terms,
        rules: project.terminology.rules.filter((rule) =>
          terms.some(
            (term) => term.toLocaleLowerCase('en') === rule.preferred.toLocaleLowerCase('en'),
          ),
        ),
      },
    });
  }, [project, termDraft]);

  if (!project?.media) return null;

  return (
    <div className="cm-transcribe">
      <Field label="Language">
        <Select<LanguageCode>
          value={language}
          ariaLabel="Transcription language"
          options={LANGUAGE_ORDER.map((code) => ({
            value: code,
            label: LANGUAGES[code].label,
          }))}
          onChange={(value) => useEditor.getState().update({ language: value })}
        />
      </Field>

      {language === 'auto' && project.transcript?.detectedLanguage ? (
        <div className="cm-transcribe-detected">
          <span className="cm-transcribe-detected__label">Auto-detected:</span>
          <span className="cm-transcribe-detected__badge">
            {LANGUAGES[project.transcript.detectedLanguage as LanguageCode]?.label ??
              project.transcript.detectedLanguage}
          </span>
        </div>
      ) : null}

      <p className="cm-transcribe__hint">{LANGUAGES[language].hint}</p>

      {language === 'hinglish' ? (
        <Field label="Topic / Domain Preset">
          <Select<HinglishDomain>
            value={hinglishDomain}
            ariaLabel="Hinglish topic domain preset"
            options={HINGLISH_DOMAINS.map((d) => ({
              value: d.id,
              label: `${d.label} — ${d.description}`,
            }))}
            onChange={(value) => useEditor.getState().update({ hinglishDomain: value })}
          />
        </Field>
      ) : null}

      <section className="cm-terminology" aria-label="Vocabulary and custom terms">
        <div className="cm-terminology__head">
          <div>
            <strong>Vocabulary & Terminology</strong>
            <span>Optional</span>
          </div>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf,application/pdf"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadPdf(file);
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            loading={uploadingPdf}
            disabled={running}
            icon={<IconUpload size={14} />}
            onClick={() => pdfInputRef.current?.click()}
          >
            {terminology?.document ? 'Replace PDF' : 'Import PDF'}
          </Button>
        </div>

        {terminology?.document ? (
          <div className="cm-terminology__document">
            <div className="cm-terminology__file">
              <strong title={terminology.document.fileName}>{terminology.document.fileName}</strong>
              <span>
                {terminology.document.pageCount} page{terminology.document.pageCount === 1 ? '' : 's'}
                {' · '}{terminology.terms.length} preferred term{terminology.terms.length === 1 ? '' : 's'}
              </span>
            </div>
            <button
              type="button"
              className="cm-terminology__remove"
              aria-label="Remove terminology PDF"
              title="Remove terminology PDF"
              disabled={running || uploadingPdf}
              onClick={() => void removePdf()}
            >
              <IconTrash size={14} />
            </button>
          </div>
        ) : null}

        <details className="cm-terminology__review" open={Boolean(terminology?.terms.length)}>
          <summary>
            {terminology?.terms.length
              ? `Custom vocabulary & preferred terms (${terminology.terms.length})`
              : 'Add custom vocabulary words'}
          </summary>
          <textarea
            value={termDraft}
            rows={4}
            aria-label="Preferred custom vocabulary"
            placeholder="Add words or phrases (one per line, e.g. brand names, Hindi/Hinglish words, creator names)"
            onChange={(event) => setTermDraft(event.target.value)}
            onBlur={saveTermDraft}
          />
          <p>One per line. These terms prime the speech model and ensure exact spelling in captions.</p>
        </details>

        {pdfError ? <Banner tone="danger">{pdfError}</Banner> : null}
      </section>

      <section className="cm-terminology" aria-label="Import existing subtitles">
        <div className="cm-terminology__head">
          <div>
            <strong>Import Subtitles (.SRT / .VTT)</strong>
            <span>Direct</span>
          </div>
          <input
            ref={srtInputRef}
            type="file"
            accept=".srt,.vtt,text/plain"
            hidden
            onChange={onSrtFileChange}
          />
          <Button
            size="sm"
            variant="secondary"
            icon={<IconUpload size={14} />}
            onClick={() => srtInputRef.current?.click()}
          >
            Choose .SRT
          </Button>
        </div>
        <p className="cm-field__hint" style={{ marginTop: 6 }}>
          Already have an SRT or VTT for this video? Import it directly to skip AI transcription and immediately style with templates.
        </p>
        {srtNotice ? (
          <div className="cm-caption-import-banner cm-caption-import-banner--success" style={{ marginTop: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconSparkle size={13} />{srtNotice}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setSrtNotice(null)}><IconX size={12} /></button>
          </div>
        ) : null}
        {srtError ? (
          <div className="cm-caption-import-banner cm-caption-import-banner--error" style={{ marginTop: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconAlert size={13} />{srtError}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setSrtError(null)}><IconX size={12} /></button>
          </div>
        ) : null}
      </section>

      {providers.length > 1 ? (
        <Field label="Engine">
          <Select
            value={providerId ?? providers[0].id}
            ariaLabel="Transcription engine"
            options={providers.map((p) => ({
              value: p.id,
              label: p.configured ? p.label : `${p.label} — not set up`,
            }))}
            onChange={setProviderId}
          />
          {activeProvider?.description ? (
            <p className="cm-field__hint" style={{ marginTop: 6, fontSize: '0.8rem', color: '#8c93a8' }}>
              {activeProvider.description}
            </p>
          ) : null}
        </Field>
      ) : null}

      {activeProvider && !activeProvider.configured ? (
        <Banner tone="warning">{activeProvider.reason}</Banner>
      ) : null}

      {activeProvider && activeProvider.configured && !languageSupported ? (
        <Banner tone="warning">
          {activeProvider.label} does not handle {LANGUAGES[language].label} well. Pick another
          engine or change the language.
        </Banner>
      ) : null}

      {running ? (
        <div className="cm-transcribe__progress">
          <ProgressBar value={job?.progress ?? null} label={job?.message ?? 'Working'} />
          <Button size="sm" variant="ghost" block onClick={() => void cancel()}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="cm-transcribe__actions">
          {transcript ? (
            <Button
              variant="secondary"
              block
              loading={starting}
              icon={<IconSparkle size={15} />}
              onClick={() => void translateWithAI(language === 'hinglish' ? 'hinglish' : 'en')}
            >
              {language === 'hinglish'
                ? 'Convert Captions to Hinglish (AI)'
                : 'Translate Captions to English (AI)'}
            </Button>
          ) : null}

          <Button
            variant={transcript ? 'ghost' : 'primary'}
            block
            loading={starting}
            disabled={
              !activeProvider?.configured || !languageSupported || !project.media.hasAudio
            }
            icon={<IconSparkle size={15} />}
            onClick={() => void transcribe()}
          >
            {transcript ? 'Retranscribe Audio' : 'Transcribe'}
          </Button>
        </div>
      )}

      {!project.media.hasAudio ? (
        <Banner tone="warning">
          This file has no audio track, so there is nothing to transcribe.
        </Banner>
      ) : null}

      {job?.status === 'error' && job.error ? (
        <ErrorState
          title="Transcription failed"
          message={job.error.message}
          onRetry={job.error.retryable ? () => void transcribe() : undefined}
          onDismiss={() => setJob(null)}
        />
      ) : null}

      {error ? (
        <ErrorState
          title="Could not start"
          message={error}
          onRetry={() => void transcribe()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {transcript ? (
        <dl className="cm-transcribe__summary">
          <div>
            <dt>Words</dt>
            <dd className="mono">{transcript.words.length}</dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>{transcript.modelId}</dd>
          </div>
          <div>
            <dt>Took</dt>
            <dd className="mono">{(transcript.durationMs / 1000).toFixed(1)}s</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
};
