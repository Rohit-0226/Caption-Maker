import React, { useEffect, useState } from 'react';
import { api, type WebShareInfo } from '../../app/api';
import { Modal, Badge, Spinner } from '../../components/feedback';
import { Button } from '../../components/controls';
import { IconShare, IconCopy, IconCheck, IconExternalLink } from '../../components/icons';

interface WebShareModalProps {
  open: boolean;
  onClose: () => void;
}

export const WebShareModal: React.FC<WebShareModalProps> = ({ open, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [shareInfo, setShareInfo] = useState<WebShareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchShareInfo = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getShareInfo();
      setShareInfo(data);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[WebShareModal] Failed to fetch share info:', err);
      // Fallback info from window.location
      const port = Number(window.location.port) || 5173;
      setShareInfo({
        ok: true,
        apiPort: 5180,
        webPort: port,
        localhostUrl: `http://localhost:${port}`,
        lanUrls: [],
        tunnelUrl: null,
        isAutoPort: port !== 5173,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchShareInfo();
    } else {
      setCopiedKey(null);
    }
  }, [open]);

  const copyToClipboard = async (url: string, key: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 2000);
    } catch {
      // ignore
    }
  };

  const openUrl = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const localhostUrl = shareInfo?.localhostUrl || `http://localhost:${shareInfo?.webPort || 5173}`;

  return (
    <Modal
      open={open}
      title="Web Hub & Network Share"
      description="Access and control Caption Maker from this PC, your mobile phone on local Wi-Fi, or anywhere on the web."
      onClose={onClose}
      width={560}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <Button size="sm" variant="ghost" onClick={fetchShareInfo} disabled={loading}>
            {loading ? <Spinner size={13} /> : 'Refresh Ports'}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {loading && !shareInfo ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '36px 0', gap: 10 }}>
            <Spinner size={20} />
            <span style={{ fontSize: 13, color: 'var(--cm-text-muted)' }}>Detecting active ports and network interfaces...</span>
          </div>
        ) : null}

        {error ? (
          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        {shareInfo ? (
          <>
            {/* 1. Localhost Card */}
            <div
              style={{
                borderRadius: 8,
                border: '1px solid var(--cm-border, #333a46)',
                background: 'var(--cm-surface-subtle, rgba(255, 255, 255, 0.03))',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>💻</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cm-text-primary)' }}>This Computer (Localhost)</span>
                  {shareInfo.isAutoPort ? (
                    <Badge tone="accent">Dynamic Port: {shareInfo.webPort}</Badge>
                  ) : (
                    <Badge tone="neutral">Port {shareInfo.webPort}</Badge>
                  )}
                </div>
              </div>

              {shareInfo.isAutoPort && (
                <div style={{ fontSize: 12, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.08)', padding: '6px 10px', borderRadius: 6 }}>
                  ℹ️ Port 5173 was in use by another app. Caption Maker automatically bound to port {shareInfo.webPort} without conflicting.
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <code
                  style={{
                    flex: 1,
                    fontFamily: 'Consolas, monospace',
                    fontSize: 12.5,
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: 'var(--cm-surface-base, #111419)',
                    border: '1px solid var(--cm-border, #282e39)',
                    color: '#60a5fa',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {localhostUrl}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={copiedKey === 'local' ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  onClick={() => copyToClipboard(localhostUrl, 'local')}
                  title="Copy Localhost URL"
                >
                  {copiedKey === 'local' ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<IconExternalLink size={13} />}
                  onClick={() => openUrl(localhostUrl)}
                  title="Open in new browser tab"
                >
                  Open
                </Button>
              </div>
            </div>

            {/* 2. Same Wi-Fi (LAN) Card */}
            <div
              style={{
                borderRadius: 8,
                border: '1px solid var(--cm-border, #333a46)',
                background: 'var(--cm-surface-subtle, rgba(255, 255, 255, 0.03))',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>📱</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cm-text-primary)' }}>Same Wi-Fi (Mobile & LAN)</span>
                  <span style={{ fontSize: 12, color: 'var(--cm-text-muted)' }}>Use from mobile phone or laptop</span>
                </div>
              </div>

              {shareInfo.lanUrls && shareInfo.lanUrls.length > 0 ? (
                shareInfo.lanUrls.map((lanUrl, idx) => (
                  <div key={lanUrl} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: idx > 0 ? 4 : 4 }}>
                    <code
                      style={{
                        flex: 1,
                        fontFamily: 'Consolas, monospace',
                        fontSize: 12.5,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'var(--cm-surface-base, #111419)',
                        border: '1px solid var(--cm-border, #282e39)',
                        color: '#60a5fa',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lanUrl}
                    </code>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={copiedKey === `lan-${idx}` ? <IconCheck size={13} /> : <IconCopy size={13} />}
                      onClick={() => copyToClipboard(lanUrl, `lan-${idx}`)}
                      title="Copy LAN URL"
                    >
                      {copiedKey === `lan-${idx}` ? 'Copied' : 'Copy'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<IconExternalLink size={13} />}
                      onClick={() => openUrl(lanUrl)}
                      title="Open in new browser tab"
                    >
                      Open
                    </Button>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12, color: 'var(--cm-text-muted)', padding: '4px 0' }}>
                  Connect this PC to a Wi-Fi or Ethernet network to generate a mobile access link.
                </div>
              )}
            </div>

            {/* 3. Public Cloudflare Tunnel Card */}
            <div
              style={{
                borderRadius: 8,
                border: '1px solid var(--cm-border, #333a46)',
                background: 'var(--cm-surface-subtle, rgba(255, 255, 255, 0.03))',
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14 }}>🌐</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cm-text-primary)' }}>Anywhere (Public Link)</span>
                  {shareInfo.tunnelUrl ? (
                    <Badge tone="success">LIVE</Badge>
                  ) : (
                    <Badge tone="neutral">Offline</Badge>
                  )}
                </div>
              </div>

              {shareInfo.tunnelUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <code
                    style={{
                      flex: 1,
                      fontFamily: 'Consolas, monospace',
                      fontSize: 12.5,
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: 'var(--cm-surface-base, #111419)',
                      border: '1px solid var(--cm-border, #282e39)',
                      color: '#34d399',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {shareInfo.tunnelUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={copiedKey === 'tunnel' ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    onClick={() => copyToClipboard(shareInfo.tunnelUrl!, 'tunnel')}
                    title="Copy Public Tunnel URL"
                  >
                    {copiedKey === 'tunnel' ? 'Copied' : 'Copy'}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<IconExternalLink size={13} />}
                    onClick={() => openUrl(shareInfo.tunnelUrl!)}
                    title="Open in new browser tab"
                  >
                    Open
                  </Button>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--cm-text-muted)', lineHeight: 1.5 }}>
                  Public link allows anyone outside your network to access your project. To start it, keep &ldquo;Share public link&rdquo; checked in the Caption Maker launcher window.
                </div>
              )}
            </div>

            {/* 4. Active Backend & Ports Summary Footer */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 11.5,
                color: 'var(--cm-text-muted)',
                padding: '4px 6px',
              }}
            >
              <span>
                Backend API: <strong>http://127.0.0.1:{shareInfo.apiPort}</strong>
              </span>
              <span>
                Web Server: <strong>http://localhost:{shareInfo.webPort}</strong>
              </span>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
};
