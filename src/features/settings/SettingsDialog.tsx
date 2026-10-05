import React, { useEffect, useState } from 'react';
import { api, type AppSettings } from '../../app/api';
import { Modal, Banner, Badge, Spinner } from '../../components/feedback';
import { Button } from '../../components/controls';
import { IconCheck, IconEye, IconEyeOff, IconSettings } from '../../components/icons';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface TestState {
  provider: 'groq' | 'openrouter' | 'gemini';
  status: 'idle' | 'testing' | 'success' | 'error';
  message: string;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Form states
  const [groqKeyDraft, setGroqKeyDraft] = useState('');
  const [showGroqKey, setShowGroqKey] = useState(false);

  const [geminiKeyDraft, setGeminiKeyDraft] = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const [openRouterKeyDraft, setOpenRouterKeyDraft] = useState('');
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);

  // Testing states
  const [groqTest, setGroqTest] = useState<TestState>({ provider: 'groq', status: 'idle', message: '' });
  const [geminiTest, setGeminiTest] = useState<TestState>({ provider: 'gemini', status: 'idle', message: '' });
  const [openRouterTest, setOpenRouterTest] = useState<TestState>({ provider: 'openrouter', status: 'idle', message: '' });

  // Saving state
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const loadCurrentSettings = async () => {
    setLoading(true);
    setSaveMessage(null);
    try {
      const data = await api.getSettings();
      setSettings(data);
      setGroqKeyDraft('');
      setGeminiKeyDraft('');
      setOpenRouterKeyDraft('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SettingsDialog] Failed to load settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadCurrentSettings();
      setGroqTest({ provider: 'groq', status: 'idle', message: '' });
      setGeminiTest({ provider: 'gemini', status: 'idle', message: '' });
      setOpenRouterTest({ provider: 'openrouter', status: 'idle', message: '' });
    }
  }, [open]);

  const handleTestKey = async (provider: 'groq' | 'openrouter' | 'gemini') => {
    let key = '';
    let setTest = setGroqTest;
    let label = 'Groq';
    let hasKey: boolean | undefined = false;

    if (provider === 'groq') {
      key = groqKeyDraft.trim();
      setTest = setGroqTest;
      label = 'Groq';
      hasKey = settings?.hasGroqKey;
    } else if (provider === 'gemini') {
      key = geminiKeyDraft.trim();
      setTest = setGeminiTest;
      label = 'Google Gemini';
      hasKey = settings?.hasGeminiKey;
    } else if (provider === 'openrouter') {
      key = openRouterKeyDraft.trim();
      setTest = setOpenRouterTest;
      label = 'OpenRouter';
      hasKey = settings?.hasOpenRouterKey;
    }

    if (!key) {
      if (!hasKey) {
        setTest({
          provider,
          status: 'error',
          message: `Please paste your ${label} API key first.`,
        });
        return;
      }
      setTest({
        provider,
        status: 'error',
        message: 'To re-test, please paste the API key into the field above.',
      });
      return;
    }

    setTest({ provider, status: 'testing', message: 'Testing key connection…' });
    try {
      const res = await api.testKey(provider, key);
      if (res.ok) {
        setTest({ provider, status: 'success', message: res.message });
      } else {
        setTest({ provider, status: 'error', message: res.message });
      }
    } catch (err) {
      setTest({ provider, status: 'error', message: (err as Error).message });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      const payload: { groqApiKey?: string; geminiApiKey?: string; openRouterApiKey?: string } = {};
      if (groqKeyDraft.trim()) payload.groqApiKey = groqKeyDraft.trim();
      if (geminiKeyDraft.trim()) payload.geminiApiKey = geminiKeyDraft.trim();
      if (openRouterKeyDraft.trim()) payload.openRouterApiKey = openRouterKeyDraft.trim();

      const res = await api.saveSettings(payload);
      setSettings(res.settings);
      setGroqKeyDraft('');
      setGeminiKeyDraft('');
      setOpenRouterKeyDraft('');
      setSaveMessage('Settings saved successfully!');
      onSaved?.();

      setTimeout(() => {
        setSaveMessage(null);
      }, 3000);
    } catch (err) {
      setSaveMessage(`Failed to save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Caption Maker Settings"
      description="Configure your API keys and media tools. Settings are securely stored on your local device."
      onClose={onClose}
      width={600}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ fontSize: '0.85rem', color: saveMessage?.startsWith('Failed') ? 'var(--cm-danger)' : 'var(--cm-accent)' }}>
            {saveMessage}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Spinner size={14} label="Saving…" /> : 'Save & Apply'}
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <Spinner size={24} label="Loading settings…" />
        </div>
      ) : (
        <div className="cm-settings-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
          {/* Groq Key Section */}
          <div className="cm-settings-section" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f1f3f9' }}>
                Groq API Key <span style={{ color: 'var(--cm-accent)', fontSize: '0.8rem' }}>(Required for Transcription)</span>
              </label>
              {settings?.hasGroqKey ? (
                <Badge tone="success">Active · {settings.groqKeyPreview}</Badge>
              ) : (
                <Badge tone="danger">Not Configured</Badge>
              )}
            </div>

            <p style={{ fontSize: '0.82rem', color: '#8c93a8', margin: '0 0 0.75rem 0', lineHeight: 1.4 }}>
              Groq provides free, ultra-fast Whisper speech-to-text models. Get your free key at{' '}
              <a
                href="https://console.groq.com/keys"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#4d9eff', textDecoration: 'underline' }}
              >
                console.groq.com/keys
              </a>.
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showGroqKey ? 'text' : 'password'}
                  className="cm-input"
                  style={{ width: '100%', paddingRight: '2.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
                  placeholder={settings?.hasGroqKey ? 'Paste new key to replace existing…' : 'gsk_...'}
                  value={groqKeyDraft}
                  onChange={(e) => setGroqKeyDraft(e.target.value)}
                />
                <button
                  type="button"
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#8c93a8',
                    cursor: 'pointer',
                    padding: '0.2rem',
                  }}
                  onClick={() => setShowGroqKey(!showGroqKey)}
                  title={showGroqKey ? 'Hide key' : 'Show key'}
                >
                  {showGroqKey ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTestKey('groq')}
                disabled={groqTest.status === 'testing'}
              >
                {groqTest.status === 'testing' ? <Spinner size={13} /> : 'Test Key'}
              </Button>
            </div>

            {groqTest.status !== 'idle' && (
              <div style={{ marginTop: '0.5rem' }}>
                <Banner tone={groqTest.status === 'success' ? 'success' : 'danger'}>
                  {groqTest.message}
                </Banner>
              </div>
            )}
          </div>

          {/* Google Gemini Key Section */}
          <div className="cm-settings-section" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f1f3f9' }}>
                Google Gemini API Key <span style={{ color: '#38ef7d', fontSize: '0.8rem' }}>(Gemini 3.5 Flash-Lite · High Accuracy)</span>
              </label>
              {settings?.hasGeminiKey ? (
                <Badge tone="success">Active · {settings.geminiKeyPreview}</Badge>
              ) : (
                <Badge tone="neutral">Optional</Badge>
              )}
            </div>

            <p style={{ fontSize: '0.82rem', color: '#8c93a8', margin: '0 0 0.75rem 0', lineHeight: 1.4 }}>
              Used for high-accuracy colloquial Hinglish-to-English translation and cleanup with ultra-low token consumption. Obtain a key at{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#4d9eff', textDecoration: 'underline' }}
              >
                aistudio.google.com
              </a>.
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showGeminiKey ? 'text' : 'password'}
                  className="cm-input"
                  style={{ width: '100%', paddingRight: '2.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
                  placeholder={settings?.hasGeminiKey ? 'Paste new key to replace existing…' : 'AQ.... or AIza...'}
                  value={geminiKeyDraft}
                  onChange={(e) => setGeminiKeyDraft(e.target.value)}
                />
                <button
                  type="button"
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#8c93a8',
                    cursor: 'pointer',
                    padding: '0.2rem',
                  }}
                  onClick={() => setShowGeminiKey(!showGeminiKey)}
                  title={showGeminiKey ? 'Hide key' : 'Show key'}
                >
                  {showGeminiKey ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTestKey('gemini')}
                disabled={geminiTest.status === 'testing'}
              >
                {geminiTest.status === 'testing' ? <Spinner size={13} /> : 'Test Key'}
              </Button>
            </div>

            {geminiTest.status !== 'idle' && (
              <div style={{ marginTop: '0.5rem' }}>
                <Banner tone={geminiTest.status === 'success' ? 'success' : 'danger'}>
                  {geminiTest.message}
                </Banner>
              </div>
            )}
          </div>

          {/* OpenRouter Key Section */}
          <div className="cm-settings-section" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f1f3f9' }}>
                OpenRouter API Key <span style={{ color: '#8c93a8', fontSize: '0.8rem' }}>(Optional · Multi-Model Router)</span>
              </label>
              {settings?.hasOpenRouterKey ? (
                <Badge tone="accent">Active · {settings.openRouterKeyPreview}</Badge>
              ) : (
                <Badge tone="neutral">Optional</Badge>
              )}
            </div>

            <p style={{ fontSize: '0.82rem', color: '#8c93a8', margin: '0 0 0.75rem 0', lineHeight: 1.4 }}>
              Used for AI commands, caption grammar cleanup, and multi-model fallbacks. Obtain at{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                style={{ color: '#4d9eff', textDecoration: 'underline' }}
              >
                openrouter.ai/keys
              </a>.
            </p>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type={showOpenRouterKey ? 'text' : 'password'}
                  className="cm-input"
                  style={{ width: '100%', paddingRight: '2.5rem', fontFamily: 'monospace', fontSize: '0.85rem' }}
                  placeholder={settings?.hasOpenRouterKey ? 'Paste new key to replace existing…' : 'sk-or-...'}
                  value={openRouterKeyDraft}
                  onChange={(e) => setOpenRouterKeyDraft(e.target.value)}
                />
                <button
                  type="button"
                  style={{
                    position: 'absolute',
                    right: '0.5rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#8c93a8',
                    cursor: 'pointer',
                    padding: '0.2rem',
                  }}
                  onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
                  title={showOpenRouterKey ? 'Hide key' : 'Show key'}
                >
                  {showOpenRouterKey ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                </button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleTestKey('openrouter')}
                disabled={openRouterTest.status === 'testing'}
              >
                {openRouterTest.status === 'testing' ? <Spinner size={13} /> : 'Test Key'}
              </Button>
            </div>

            {openRouterTest.status !== 'idle' && (
              <div style={{ marginTop: '0.5rem' }}>
                <Banner tone={openRouterTest.status === 'success' ? 'success' : 'danger'}>
                  {openRouterTest.message}
                </Banner>
              </div>
            )}
          </div>

          {/* Local Nemotron GPU Status Section */}
          <div className="cm-settings-section" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f1f3f9' }}>
                Local Nemotron ASR (GPU)
              </label>
              {settings?.nemotron?.installed ? (
                <Badge tone="success">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <IconCheck size={12} /> Ready · GPU Vulkan
                  </span>
                </Badge>
              ) : (
                <Badge tone="neutral">Not Found</Badge>
              )}
            </div>

            <p style={{ fontSize: '0.82rem', color: '#8c93a8', margin: '0 0 0.5rem 0', lineHeight: 1.4 }}>
              {settings?.nemotron?.installed
                ? 'Runs offline on this GPU with no tokens. It gives text only, so the Hybrid engine uses it as one voter and takes word timing from Whisper and the audio.'
                : 'Install Handy to add local Nemotron as an extra, offline voter in the Hybrid engine.'}
            </p>

            {settings?.nemotron?.path && (
              <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#6d758d', wordBreak: 'break-all', background: 'rgba(0,0,0,0.2)', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                Engine: {settings.nemotron.path} · Model: {settings.nemotron.model}
              </div>
            )}
          </div>

          {/* FFmpeg Engine Status Section */}
          <div className="cm-settings-section" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
              <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#f1f3f9' }}>
                FFmpeg Engine
              </label>
              {settings?.ffmpeg.installed ? (
                <Badge tone="success">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <IconCheck size={12} /> Ready
                  </span>
                </Badge>
              ) : (
                <Badge tone="warning">Not Detected</Badge>
              )}
            </div>

            <p style={{ fontSize: '0.82rem', color: '#8c93a8', margin: '0 0 0.5rem 0', lineHeight: 1.4 }}>
              {settings?.ffmpeg.installed
                ? 'FFmpeg is active and handles video proxies, audio extraction, and waveforms.'
                : 'FFmpeg is required for video extraction and proxies. Install via Windows Terminal: winget install Gyan.FFmpeg'}
            </p>

            {settings?.ffmpeg.path && (
              <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#6d758d', wordBreak: 'break-all', background: 'rgba(0,0,0,0.2)', padding: '0.4rem 0.6rem', borderRadius: '4px' }}>
                Binary: {settings.ffmpeg.path}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
};
