import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ProviderSummary } from '../../app/api';
import { HINGLISH_DOMAINS, LANGUAGES, LANGUAGE_ORDER } from '../../core/transcription/languages';
import type { HinglishDomain, LanguageCode } from '../../core/types/project';
import { IconChevronDown } from '../../app/shell/icons';

/**
 * The transcription choices shared by "new project" and "Regenerate".
 *
 * Only the two scripts the pipeline is built for sit on the surface:
 * Hinglish in Roman letters and English. (A separate "Hindi (Roman)" mode is
 * not offered because the pipeline has none: Hindi speech in Roman letters is
 * exactly what the Hinglish mode produces.) Every other language the engines
 * accept, the engine itself, and client terminology stay under Advanced.
 */

export type MainLanguage = 'hinglish' | 'en';

export interface TranscribeChoices {
  language: MainLanguage;
  /** an Advanced override; empty means "use the main choice" */
  otherLanguage: LanguageCode | '';
  domain: HinglishDomain;
  providerId: string | null;
  /** extra words to spell exactly, one per line */
  terms: string;
  /** an optional client terminology PDF (new projects only) */
  pdf: File | null;
}

export const defaultChoices = (language: LanguageCode = 'hinglish'): TranscribeChoices => ({
  language: language === 'en' ? 'en' : 'hinglish',
  otherLanguage: language === 'en' || language === 'hinglish' ? '' : language,
  domain: 'general',
  providerId: null,
  terms: '',
  pdf: null,
});

export const effectiveLanguage = (choices: TranscribeChoices): LanguageCode =>
  choices.otherLanguage || choices.language;

/** One word or phrase per line (commas also work), de-duplicated, capped like the old panel. */
export const parseTerms = (text: string): string[] => {
  const seen = new Set<string>();
  return text
    .split(/[\n,]+/)
    .map((term) => term.trim())
    .filter((term) => {
      const key = term.toLocaleLowerCase('en');
      if (!term || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 200);
};

/** Engines, loaded once per modal; the first configured one is the default. */
export const useProviders = () => {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api
      .providers()
      .then((list) => !cancelled && setProviders(list))
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { providers, failed };
};

export const resolveProvider = (
  providers: ProviderSummary[] | null,
  choices: TranscribeChoices,
): ProviderSummary | null => {
  if (!providers || providers.length === 0) return null;
  return (
    providers.find((p) => p.id === choices.providerId) ??
    providers.find((p) => p.configured) ??
    providers[0]
  );
};

/** Why "Generate captions" cannot run yet, in words that say what to do. */
export const blockingReason = (
  provider: ProviderSummary | null,
  choices: TranscribeChoices,
): string | null => {
  if (!provider) return null;
  if (!provider.configured) {
    return provider.reason ?? `${provider.label} is not set up yet. Open Settings to add its key, or pick another engine under Advanced.`;
  }
  const language = effectiveLanguage(choices);
  if (!provider.supportedLanguages.includes(language)) {
    return `${provider.label} does not handle ${LANGUAGES[language].label}. Pick another engine or language under Advanced.`;
  }
  return null;
};

export const LanguagePicker: React.FC<{
  choices: TranscribeChoices;
  onChange: (next: TranscribeChoices) => void;
}> = ({ choices, onChange }) => {
  const overridden = Boolean(choices.otherLanguage);
  return (
    <div className="ui-field">
      <div className="ui-field__head">
        <span className="ui-label">Language</span>
        {overridden ? (
          <span className="ui-label__value">{LANGUAGES[choices.otherLanguage as LanguageCode].label}</span>
        ) : null}
      </div>
      <div className={`ui-seg ${overridden ? 'is-muted' : ''}`} role="radiogroup" aria-label="Caption language">
        {(
          [
            { value: 'hinglish', label: 'Hinglish (Roman)' },
            { value: 'en', label: 'English' },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={!overridden && choices.language === option.value}
            className={!overridden && choices.language === option.value ? 'is-active' : ''}
            onClick={() => onChange({ ...choices, language: option.value, otherLanguage: '' })}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="ui-hint">
        {overridden
          ? 'Using the language chosen under Advanced. Pick one here to switch back.'
          : choices.language === 'hinglish'
            ? 'Hindi words in Roman letters, English words in proper English spelling.'
            : 'Everything transcribed as English.'}
      </p>
    </div>
  );
};

const PDF_LIMIT_MB = 20;

export const AdvancedTranscription: React.FC<{
  choices: TranscribeChoices;
  onChange: (next: TranscribeChoices) => void;
  providers: ProviderSummary[] | null;
  /** new projects can carry a terminology PDF; an open project manages its own */
  allowPdf?: boolean;
  defaultOpen?: boolean;
  /** the PDF the open project already uses, if any */
  currentPdf?: string | null;
  onRemoveCurrentPdf?: () => void;
}> = ({
  choices,
  onChange,
  providers,
  allowPdf = true,
  defaultOpen = false,
  currentPdf = null,
  onRemoveCurrentPdf,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const pdfRef = useRef<HTMLInputElement>(null);
  const provider = resolveProvider(providers, choices);
  const language = effectiveLanguage(choices);

  const otherOptions = useMemo(
    () => LANGUAGE_ORDER.filter((code) => code !== 'hinglish' && code !== 'en'),
    [],
  );

  const summary = [
    provider ? provider.label.split(' — ')[0] : null,
    choices.otherLanguage ? LANGUAGES[choices.otherLanguage].label : null,
    choices.pdf ? 'PDF' : null,
    parseTerms(choices.terms).length ? `${parseTerms(choices.terms).length} words` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`ui-disclosure ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="ui-disclosure__trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <IconChevronDown size={14} className="ui-disclosure__chev" />
        <span>Advanced</span>
        {!open && summary ? <span className="ui-disclosure__summary">{summary}</span> : null}
      </button>
      {open ? (
        <div className="ui-disclosure__body">
          <label className="ui-field">
            <span className="ui-field__head">
              <span className="ui-label">Engine</span>
            </span>
            <select
              className="ui-select"
              value={provider?.id ?? ''}
              disabled={!providers || providers.length === 0}
              onChange={(event) => onChange({ ...choices, providerId: event.target.value })}
            >
              {(providers ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.configured ? p.label : `${p.label} (not set up)`}
                </option>
              ))}
            </select>
            {provider?.description ? <span className="ui-hint">{provider.description}</span> : null}
          </label>

          <label className="ui-field">
            <span className="ui-field__head">
              <span className="ui-label">Other language</span>
            </span>
            <select
              className="ui-select"
              value={choices.otherLanguage}
              onChange={(event) =>
                onChange({ ...choices, otherLanguage: event.target.value as LanguageCode | '' })
              }
            >
              <option value="">None (use the choice above)</option>
              {otherOptions.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGES[code].label}
                </option>
              ))}
            </select>
          </label>

          {language === 'hinglish' ? (
            <label className="ui-field">
              <span className="ui-field__head">
                <span className="ui-label">Topic</span>
              </span>
              <select
                className="ui-select"
                value={choices.domain}
                onChange={(event) => onChange({ ...choices, domain: event.target.value as HinglishDomain })}
              >
                {HINGLISH_DOMAINS.map((domain) => (
                  <option key={domain.id} value={domain.id}>
                    {domain.label}
                  </option>
                ))}
              </select>
              <span className="ui-hint">Primes the engine with words common to this kind of video.</span>
            </label>
          ) : null}

          <label className="ui-field">
            <span className="ui-field__head">
              <span className="ui-label">Words to spell exactly</span>
            </span>
            <textarea
              className="ui-input ui-textarea"
              rows={3}
              spellCheck={false}
              value={choices.terms}
              placeholder={'Brand names, people, places…\none per line'}
              onChange={(event) => onChange({ ...choices, terms: event.target.value })}
            />
          </label>

          {allowPdf ? (
            <div className="ui-field">
              <span className="ui-field__head">
                <span className="ui-label">Client terminology PDF</span>
                <span className="ui-field__optional">Optional</span>
              </span>
              <div className="ui-file-row">
                <span className="ui-file-row__name" title={choices.pdf?.name ?? currentPdf ?? undefined}>
                  {choices.pdf
                    ? choices.pdf.name
                    : currentPdf
                      ? `${currentPdf} (in use)`
                      : `A glossary or brief, up to ${PDF_LIMIT_MB} MB`}
                </span>
                {choices.pdf ? (
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onChange({ ...choices, pdf: null })}>
                    Remove
                  </button>
                ) : currentPdf && onRemoveCurrentPdf ? (
                  <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onRemoveCurrentPdf}>
                    Remove
                  </button>
                ) : null}
                <button type="button" className="ui-btn ui-btn--sm" onClick={() => pdfRef.current?.click()}>
                  {choices.pdf || currentPdf ? 'Replace' : 'Choose PDF'}
                </button>
                <input
                  ref={pdfRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = '';
                    if (file) onChange({ ...choices, pdf: file });
                  }}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
