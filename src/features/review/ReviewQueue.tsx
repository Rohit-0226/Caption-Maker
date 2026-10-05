import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../app/api';
import { Button } from '../../components/controls';
import { IconChart, IconDatabase, IconSearch, IconTrophy } from '../../components/icons';
import { EmptyState, Spinner } from '../../components/feedback';
import type { VocabularyEntry } from '../../core/vocabulary/vocabularyStore';

interface LexiconCandidate {
  surface_form: string;
  canonical: string;
  hit_count: number;
  distinct_editors: number;
  status: 'candidate' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
}

interface CorrectionEntry {
  id: string;
  segment_id: string;
  before: string;
  after: string;
  category: string;
  editor: string;
  created_at: string;
}

interface VocabularyCandidateWord {
  word: string;
  count: number;
  examples: string[];
  suggested_form: string;
}

interface AIProviderStatus {
  id: string;
  name: string;
  role: string;
  configured: boolean;
  model: string;
  endpoint: string;
  reason: string | null;
}

interface AIModelLog {
  id: string;
  timestamp: string;
  provider: string;
  primaryModel: string;
  secondaryModel?: string;
  responseTimeMs: number;
  confidence: number;
  fallbackUsed: boolean;
  secondOpinionUsed: boolean;
  correctionsCount: number;
  uncertainWordsCount: number;
  tokensCount: number;
}

interface ComparisonData {
  original: string;
  groq: { caption: string; tokens: string[]; confidence: number; responseTimeMs: number; error?: string };
  openrouter: { caption: string; tokens: string[]; confidence: number; responseTimeMs: number; error?: string };
  finalSelected: { caption: string; tokens: string[]; confidence: number; reason: string; secondOpinionUsed: boolean; agreementCount: number };
}

export const ReviewQueue: React.FC = () => {
  const [candidates, setCandidates] = useState<LexiconCandidate[]>([]);
  const [promotable, setPromotable] = useState<LexiconCandidate[]>([]);
  const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
  const [vocabulary, setVocabulary] = useState<VocabularyEntry[]>([]);
  const [extractedCandidates, setExtractedCandidates] = useState<VocabularyCandidateWord[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<AIProviderStatus[]>([]);
  const [modelLogs, setModelLogs] = useState<AIModelLog[]>([]);

  // Side-by-Side Comparison State
  const [compareInput, setCompareInput] = useState('Yeh video bohot accha hai aur main is video me explain kar raha hoon');
  const [comparisonResult, setComparisonResult] = useState<ComparisonData | null>(null);
  const [comparing, setComparing] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<any | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);

  const [vocabSearch, setVocabSearch] = useState('');
  const [historicalInput, setHistoricalInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'promotable' | 'vocabulary' | 'learner' | 'providers' | 'history'>('promotable');
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // New Word Form Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newApproved, setNewApproved] = useState('');
  const [newRejected, setNewRejected] = useState('');
  const [newContext, setNewContext] = useState('');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [lex, corrs, vocabRes, providersRes, logsRes] = await Promise.all([
        api.getLexiconCandidates().catch(() => ({ all: [], promotable: [] })),
        api.getCorrections(100).catch(() => []),
        api.getVocabulary().catch(() => ({ version: 1, description: '', entries: [] })),
        api.getAIProviderStatuses().catch(() => []),
        api.getAIModelLogs().catch(() => []),
      ]);
      setCandidates(lex.all || []);
      setPromotable(lex.promotable || []);
      setCorrections(corrs || []);
      setVocabulary(vocabRes.entries || []);
      setProviderStatuses(providersRes || []);
      setModelLogs(logsRes || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleApprove = async (surfaceForm: string) => {
    try {
      await api.approveLexicon(surfaceForm, 'Owner');
      setActionMsg(`Approved "${surfaceForm}" into protected lexicon`);
      setTimeout(() => setActionMsg(null), 3000);
      void loadData();
    } catch (e) {
      setActionMsg(`Failed to approve: ${(e as Error).message}`);
    }
  };

  const handleReject = async (surfaceForm: string) => {
    try {
      await api.rejectLexicon(surfaceForm);
      setActionMsg(`Rejected "${surfaceForm}"`);
      setTimeout(() => setActionMsg(null), 3000);
      void loadData();
    } catch (e) {
      setActionMsg(`Failed to reject: ${(e as Error).message}`);
    }
  };

  const handleBackup = async () => {
    try {
      setBackupMsg('Creating database backup...');
      const res = await api.backupDb();
      setBackupMsg(`Backup saved: ${res.backupFile.split(/[\/\\]/).pop()}`);
      setTimeout(() => setBackupMsg(null), 4000);
    } catch (e) {
      setBackupMsg(`Backup failed: ${(e as Error).message}`);
    }
  };

  const handleSaveVocabularyEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWord.trim() || !newApproved.trim()) return;

    const entry: VocabularyEntry = {
      word: newWord.trim().toLowerCase(),
      approved_form: newApproved.trim().toLowerCase(),
      alternatives: [],
      rejected_forms: newRejected
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      context: newContext.trim() || 'user approved vocabulary',
      examples: [],
      confidence: 1.0,
    };

    try {
      await api.saveVocabularyEntry(entry);
      setActionMsg(`Added "${entry.approved_form}" to controlled vocabulary database`);
      setTimeout(() => setActionMsg(null), 3500);
      setShowAddModal(false);
      setNewWord('');
      setNewApproved('');
      setNewRejected('');
      setNewContext('');
      void loadData();
    } catch (err) {
      setActionMsg(`Failed to save vocabulary: ${(err as Error).message}`);
    }
  };

  const handleDeleteVocabularyEntry = async (word: string) => {
    try {
      await api.deleteVocabularyEntry(word);
      setActionMsg(`Removed "${word}" from vocabulary database`);
      setTimeout(() => setActionMsg(null), 3000);
      void loadData();
    } catch (err) {
      setActionMsg(`Failed to delete: ${(err as Error).message}`);
    }
  };

  const handleExtractCandidates = async () => {
    if (!historicalInput.trim()) {
      setActionMsg('Paste captions text first to extract vocabulary candidates');
      setTimeout(() => setActionMsg(null), 3000);
      return;
    }
    try {
      setLoading(true);
      const res = await api.extractVocabularyCandidates([historicalInput]);
      setExtractedCandidates(res.candidates || []);
      setActionMsg(`Found ${res.candidates?.length || 0} candidate words from captions`);
      setTimeout(() => setActionMsg(null), 3500);
    } catch (err) {
      setActionMsg(`Extraction failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleApproveCandidate = async (candidate: VocabularyCandidateWord) => {
    const entry: VocabularyEntry = {
      word: candidate.word.toLowerCase(),
      approved_form: candidate.suggested_form.toLowerCase(),
      alternatives: [],
      rejected_forms: [],
      context: `Learned from approved captions (appeared ${candidate.count} times)`,
      examples: candidate.examples.slice(0, 2),
      confidence: 1.0,
    };

    try {
      await api.saveVocabularyEntry(entry);
      setExtractedCandidates((prev) => prev.filter((c) => c.word !== candidate.word));
      setActionMsg(`Approved "${entry.approved_form}" into vocabulary database!`);
      setTimeout(() => setActionMsg(null), 3000);
      void loadData();
    } catch (err) {
      setActionMsg(`Failed to approve: ${(err as Error).message}`);
    }
  };

  const handleRunComparison = async () => {
    if (!compareInput.trim()) return;
    try {
      setComparing(true);
      const res = await api.compareAIProviders(compareInput);
      setComparisonResult(res);
      setActionMsg('Comparison finished! See Groq vs OpenRouter results below.');
      setTimeout(() => setActionMsg(null), 4000);
    } catch (err) {
      setActionMsg(`Comparison failed: ${(err as Error).message}`);
    } finally {
      setComparing(false);
    }
  };

  const handleRunBenchmark = async () => {
    try {
      setBenchmarking(true);
      const res = await api.benchmarkAIProviders();
      setBenchmarkResult(res);
      setActionMsg('Benchmark completed successfully!');
      setTimeout(() => setActionMsg(null), 4000);
    } catch (err) {
      setActionMsg(`Benchmark failed: ${(err as Error).message}`);
    } finally {
      setBenchmarking(false);
    }
  };

  const filteredVocab = vocabulary.filter(
    (v) =>
      v.word.toLowerCase().includes(vocabSearch.toLowerCase()) ||
      v.approved_form.toLowerCase().includes(vocabSearch.toLowerCase()) ||
      v.rejected_forms?.some((r) => r.toLowerCase().includes(vocabSearch.toLowerCase()))
  );

  return (
    <div className="cm-review-queue" style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-3)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 'var(--space-2)', borderBottom: '1px solid var(--line)' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>Vocabulary & AI Studio</h3>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
            Dual-AI Orchestration (Groq + OpenRouter) · Controlled Vocabulary · Human-in-the-Loop Triage
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button size="sm" variant="ghost" onClick={handleBackup} icon={<IconDatabase size={13} />}>
            Backup DB
          </Button>
        </div>
      </div>

      {backupMsg ? (
        <div style={{ padding: '6px 12px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-xs)', fontSize: '11px', color: 'var(--locked)' }}>
          {backupMsg}
        </div>
      ) : null}

      {actionMsg ? (
        <div style={{ padding: '6px 12px', background: 'var(--surface-sunken)', borderRadius: 'var(--radius-xs)', fontSize: '11px', color: 'var(--accent-primary, #F59E0B)' }}>
          {actionMsg}
        </div>
      ) : null}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--line)', paddingBottom: '6px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`cm-filter-tab ${activeTab === 'promotable' ? 'is-active' : ''}`}
          style={{
            background: activeTab === 'promotable' ? 'var(--surface-hover)' : 'transparent',
            border: 'none',
            color: activeTab === 'promotable' ? 'var(--text)' : 'var(--muted)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-xs)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
          onClick={() => setActiveTab('promotable')}
        >
          Review Triage ({promotable.length})
        </button>

        <button
          type="button"
          className={`cm-filter-tab ${activeTab === 'vocabulary' ? 'is-active' : ''}`}
          style={{
            background: activeTab === 'vocabulary' ? 'var(--surface-hover)' : 'transparent',
            border: 'none',
            color: activeTab === 'vocabulary' ? 'var(--text)' : 'var(--muted)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-xs)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
          onClick={() => setActiveTab('vocabulary')}
        >
          Controlled Vocabulary ({vocabulary.length})
        </button>

        <button
          type="button"
          className={`cm-filter-tab ${activeTab === 'learner' ? 'is-active' : ''}`}
          style={{
            background: activeTab === 'learner' ? 'var(--surface-hover)' : 'transparent',
            border: 'none',
            color: activeTab === 'learner' ? 'var(--text)' : 'var(--muted)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-xs)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
          onClick={() => setActiveTab('learner')}
        >
          Candidate Learner ({extractedCandidates.length})
        </button>

        <button
          type="button"
          className={`cm-filter-tab ${activeTab === 'providers' ? 'is-active' : ''}`}
          style={{
            background: activeTab === 'providers' ? 'var(--surface-hover)' : 'transparent',
            border: 'none',
            color: activeTab === 'providers' ? 'var(--text)' : 'var(--muted)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-xs)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
          onClick={() => setActiveTab('providers')}
        >
          Dual-AI & Compare
        </button>

        <button
          type="button"
          className={`cm-filter-tab ${activeTab === 'history' ? 'is-active' : ''}`}
          style={{
            background: activeTab === 'history' ? 'var(--surface-hover)' : 'transparent',
            border: 'none',
            color: activeTab === 'history' ? 'var(--text)' : 'var(--muted)',
            padding: '4px 10px',
            borderRadius: 'var(--radius-xs)',
            cursor: 'pointer',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
          onClick={() => setActiveTab('history')}
        >
          Corrections Log ({corrections.length})
        </button>
      </div>

      {/* Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {loading ? (
          <Spinner size={20} label="Loading data..." />
        ) : activeTab === 'promotable' ? (
          promotable.length === 0 ? (
            <EmptyState
              compact
              title="No flagged corrections awaiting review"
              description="Low-confidence tokens and editor modifications requiring human triage will appear here."
            />
          ) : (
            promotable.map((c) => (
              <div
                key={c.surface_form}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--flag, #EF4444)', textDecoration: 'line-through' }}>
                      {c.surface_form}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: '11px' }}>→</span>
                    <span style={{ color: 'var(--locked, #10B981)', fontWeight: 600 }}>{c.canonical}</span>
                    <span
                      style={{
                        fontSize: '10px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: 'var(--locked, #10B981)',
                        padding: '1px 6px',
                        borderRadius: '3px',
                      }}
                    >
                      Confidence: 96%
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '3px' }}>
                    Reason: Approved project vocabulary · Hits: <strong>{c.hit_count}</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <Button size="sm" variant="primary" onClick={() => handleApprove(c.surface_form)}>
                    Accept
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleReject(c.surface_form)}>
                    Reject
                  </Button>
                </div>
              </div>
            ))
          )
        ) : activeTab === 'providers' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Provider Status Badges */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {providerStatuses.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: p.configured ? 'var(--locked, #10B981)' : 'var(--muted)',
                        }}
                      />
                      <span style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text)' }}>
                        {p.name}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        background: p.role === 'primary' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        color: p.role === 'primary' ? 'var(--accent-primary, #F59E0B)' : '#3B82F6',
                        fontWeight: 600,
                      }}
                    >
                      {p.role}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text)', fontFamily: 'monospace' }}>
                    Model: {p.model}
                  </div>
                  <div style={{ fontSize: '10px', color: p.configured ? 'var(--locked, #10B981)' : 'var(--flag, #EF4444)' }}>
                    {p.configured ? '● Available & Ready' : `○ Not Configured (${p.reason})`}
                  </div>
                </div>
              ))}
            </div>

            {/* Side by Side Comparison Tool */}
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text)' }}>
                <span style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 5 }}><IconSearch size={12} /></span>Side-by-Side Model Comparison & Second Opinion Tester
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Test any sentence with Groq (Primary) and OpenRouter (Secondary) simultaneously to inspect arbitration.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={compareInput}
                  onChange={(e) => setCompareInput(e.target.value)}
                  placeholder="Enter sentence to test..."
                  style={{
                    flex: 1,
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '6px 10px',
                    color: 'var(--text)',
                    fontSize: '11px',
                  }}
                />
                <Button size="sm" variant="primary" disabled={comparing} onClick={handleRunComparison}>
                  {comparing ? 'Testing...' : 'Compare Models'}
                </Button>
                <Button size="sm" variant="ghost" disabled={benchmarking} onClick={handleRunBenchmark}>
                  {benchmarking ? 'Benchmarking...' : 'Run Benchmark'}
                </Button>
              </div>

              {/* Comparison Results */}
              {comparisonResult && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ background: 'var(--surface-sunken)', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--accent-primary, #F59E0B)' }}>
                        GROQ PRIMARY ({comparisonResult.groq.responseTimeMs}ms)
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text)', marginTop: '3px' }}>
                        {comparisonResult.groq.caption}
                      </div>
                    </div>

                    <div style={{ background: 'var(--surface-sunken)', padding: '8px', borderRadius: '4px', border: '1px solid var(--line)' }}>
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#3B82F6' }}>
                        OPENROUTER SECOND OPINION ({comparisonResult.openrouter.responseTimeMs}ms)
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text)', marginTop: '3px' }}>
                        {comparisonResult.openrouter.caption}
                      </div>
                    </div>
                  </div>

                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--locked, #10B981)', padding: '8px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--locked, #10B981)' }}>
                      <span style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 5 }}><IconTrophy size={11} /></span>FINAL ARBITRATED OUTPUT ({comparisonResult.finalSelected.reason})
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginTop: '2px' }}>
                      {comparisonResult.finalSelected.caption}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px' }}>
                      Confidence: {Math.round(comparisonResult.finalSelected.confidence * 100)}% · Second Opinion Used: {comparisonResult.finalSelected.secondOpinionUsed ? 'Yes' : 'No'}
                    </div>
                  </div>
                </div>
              )}

              {/* Benchmark Results */}
              {benchmarkResult && (
                <div style={{ background: 'var(--surface-sunken)', padding: '10px', borderRadius: '4px', border: '1px solid var(--line)', marginTop: '6px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>
                    <span style={{ display: 'inline-flex', verticalAlign: '-2px', marginRight: 5 }}><IconChart size={12} /></span>Benchmark Report ({benchmarkResult.casesCount} Test Cases)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginTop: '6px' }}>
                    <div>Groq: <strong>{benchmarkResult.groqAccuracy}%</strong> ({benchmarkResult.averageLatencyGroqMs}ms)</div>
                    <div>OpenRouter: <strong>{benchmarkResult.openRouterAccuracy}%</strong> ({benchmarkResult.averageLatencyOpenRouterMs}ms)</div>
                    <div style={{ color: 'var(--locked, #10B981)' }}>Hybrid: <strong>{benchmarkResult.hybridAccuracy}%</strong></div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '6px' }}>
                    Recommendation: {benchmarkResult.recommendation}
                  </div>
                </div>
              )}
            </div>

            {/* Model Logs Table */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text)' }}>
                Recent Caption Model Executions ({modelLogs.length})
              </div>
              {modelLogs.length === 0 ? (
                <div style={{ fontSize: '11px', color: 'var(--muted)', padding: '8px', background: 'var(--surface-sunken)', borderRadius: '4px' }}>
                  No caption model requests logged yet. Transcribe media to populate logs.
                </div>
              ) : (
                modelLogs.slice(0, 15).map((log) => (
                  <div
                    key={log.id}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-xs)',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, textTransform: 'uppercase', color: log.provider === 'groq' ? 'var(--accent-primary, #F59E0B)' : log.provider === 'hybrid' ? 'var(--locked, #10B981)' : '#3B82F6' }}>
                        {log.provider}
                      </span>
                      <span style={{ color: 'var(--muted)', marginLeft: '6px' }}>
                        ({log.primaryModel}{log.secondaryModel ? ` + ${log.secondaryModel}` : ''})
                      </span>
                      <span style={{ color: 'var(--muted)', marginLeft: '8px' }}>
                        {log.responseTimeMs}ms
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: 'var(--locked, #10B981)' }}>
                        Conf: {Math.round(log.confidence * 100)}%
                      </span>
                      {log.fallbackUsed && (
                        <span style={{ fontSize: '9px', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--flag, #EF4444)', padding: '1px 5px', borderRadius: '3px' }}>
                          Fallback
                        </span>
                      )}
                      {log.secondOpinionUsed && (
                        <span style={{ fontSize: '9px', background: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6', padding: '1px 5px', borderRadius: '3px' }}>
                          2nd Opinion
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : activeTab === 'vocabulary' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Search and Add Word bar */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search controlled vocabulary or rejected forms..."
                value={vocabSearch}
                onChange={(e) => setVocabSearch(e.target.value)}
                style={{
                  flex: 1,
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-xs)',
                  padding: '6px 10px',
                  color: 'var(--text)',
                  fontSize: '12px',
                }}
              />
              <Button size="sm" variant="primary" onClick={() => setShowAddModal(true)}>
                + Add Word
              </Button>
            </div>

            {/* Add Word Modal Form */}
            {showAddModal && (
              <form
                onSubmit={handleSaveVocabularyEntry}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--accent-primary, #F59E0B)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--accent-primary, #F59E0B)' }}>
                  Add / Edit Controlled Vocabulary Entry
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Word Key (e.g. bahut)"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    required
                    style={{
                      background: 'var(--surface-sunken)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-xs)',
                      padding: '6px 8px',
                      color: 'var(--text)',
                      fontSize: '11px',
                    }}
                  />
                  <input
                    type="text"
                    placeholder="Approved Form (e.g. bahut)"
                    value={newApproved}
                    onChange={(e) => setNewApproved(e.target.value)}
                    required
                    style={{
                      background: 'var(--surface-sunken)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-xs)',
                      padding: '6px 8px',
                      color: 'var(--text)',
                      fontSize: '11px',
                    }}
                  />
                </div>
                <input
                  type="text"
                  placeholder="Rejected Forms (comma-separated, e.g. bohot, bhut, bhot)"
                  value={newRejected}
                  onChange={(e) => setNewRejected(e.target.value)}
                  style={{
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '6px 8px',
                    color: 'var(--text)',
                    fontSize: '11px',
                  }}
                />
                <input
                  type="text"
                  placeholder="Context / Usage Note (e.g. general Hinglish adverb)"
                  value={newContext}
                  onChange={(e) => setNewContext(e.target.value)}
                  style={{
                    background: 'var(--surface-sunken)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-xs)',
                    padding: '6px 8px',
                    color: 'var(--text)',
                    fontSize: '11px',
                  }}
                />
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setShowAddModal(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" type="submit">
                    Save to Database
                  </Button>
                </div>
              </form>
            )}

            {filteredVocab.length === 0 ? (
              <EmptyState compact title="No matching vocabulary entries" description="Try a different search term or add a new approved word." />
            ) : (
              filteredVocab.map((entry) => (
                <div
                  key={entry.word}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--locked, #10B981)' }}>{entry.approved_form}</span>
                      {entry.rejected_forms && entry.rejected_forms.length > 0 && (
                        <span style={{ fontSize: '11px', color: 'var(--flag, #EF4444)' }}>
                          (Avoid: {entry.rejected_forms.join(', ')})
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      {entry.context}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteVocabularyEntry(entry.word)}>
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        ) : activeTab === 'learner' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              Extract recurring vocabulary patterns from historical approved captions. Candidate words are vetted by you before entering the database.
            </div>

            <textarea
              rows={3}
              placeholder="Paste historical approved captions here (or text from past videos)..."
              value={historicalInput}
              onChange={(e) => setHistoricalInput(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--surface-sunken)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-xs)',
                padding: '8px',
                color: 'var(--text)',
                fontSize: '11px',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button size="sm" variant="primary" onClick={handleExtractCandidates} icon={<IconSearch size={13} />}>
                Extract Candidates
              </Button>
            </div>

            {extractedCandidates.length === 0 ? (
              <EmptyState
                compact
                title="No candidates extracted yet"
                description="Paste captions above and click 'Extract Candidates' to discover unindexed words for review."
              />
            ) : (
              extractedCandidates.map((cand) => (
                <div
                  key={cand.word}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{cand.word}</span>
                      <span style={{ fontSize: '10px', background: 'var(--surface-hover)', padding: '1px 6px', borderRadius: '3px', color: 'var(--muted)' }}>
                        Count: {cand.count}
                      </span>
                    </div>
                    {cand.examples.length > 0 && (
                      <div style={{ fontSize: '10px', color: 'var(--muted)', marginTop: '2px', fontStyle: 'italic' }}>
                        "...{cand.examples[0]}..."
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Button size="sm" variant="primary" onClick={() => handleApproveCandidate(cand)}>
                      Approve into DB
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExtractedCandidates((prev) => prev.filter((c) => c.word !== cand.word))}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : corrections.length === 0 ? (
          <EmptyState
            compact
            title="No corrections logged yet"
            description="When editors edit words or segments in the studio, the audit trail is recorded here."
          />
        ) : (
          corrections.map((corr) => (
            <div
              key={corr.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: '11px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', marginBottom: '4px' }}>
                <span>Editor: <strong>{corr.editor}</strong></span>
                <span>{new Date(corr.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--flag, #EF4444)', textDecoration: 'line-through' }}>{corr.before}</span>
                <span style={{ color: 'var(--muted)' }}>→</span>
                <span style={{ color: 'var(--locked, #10B981)', fontWeight: 600 }}>{corr.after}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
