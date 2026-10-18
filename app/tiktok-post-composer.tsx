"use client";

import { useEffect, useState } from "react";
import ReliableImage from "./reliable-image";

type TikTokAccount = {
  id: string;
  username: string;
  privacyLevels: Array<{ value: string; label: string }>;
};

type Props = {
  imageUrl: string;
  generatedTitle: string;
  onClose: () => void;
};

export default function TikTokPostComposer({ imageUrl, generatedTitle, onClose }: Props) {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [privacyLevel, setPrivacyLevel] = useState("");
  const [title, setTitle] = useState(generatedTitle.slice(0, 90));
  const [description, setDescription] = useState("");
  const [allowComment, setAllowComment] = useState(true);
  const [autoAddMusic, setAutoAddMusic] = useState(true);
  const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [aiAcknowledged, setAiAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; postId: string | null; status: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/zernio/tiktok/accounts", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { accounts?: TikTokAccount[]; error?: string };
        if (!response.ok) throw new Error(body.error || "TikTok accounts could not be loaded.");
        const nextAccounts = body.accounts ?? [];
        setAccounts(nextAccounts);
        const first = nextAccounts[0];
        if (first) {
          setAccountId(first.id);
          setPrivacyLevel(first.privacyLevels[0]?.value ?? "");
        }
      })
      .catch((loadError) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "TikTok accounts could not be loaded.");
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const ready = Boolean(
    accountId && privacyLevel && title.trim() && description.trim()
    && previewConfirmed && consentGiven && aiAcknowledged,
  );

  async function submit() {
    if (!ready || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/zernio/tiktok/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          imageUrl,
          title,
          description,
          privacyLevel,
          allowComment,
          autoAddMusic,
          contentPreviewConfirmed: previewConfirmed,
          expressConsentGiven: consentGiven,
          aiLabelAcknowledged: aiAcknowledged,
        }),
      });
      const body = await response.json() as { message?: string; postId?: string | null; status?: string; error?: string };
      if (!response.ok) throw new Error(body.error || "The photo could not be sent to TikTok.");
      setResult({
        message: body.message || "Photo sent to TikTok Creator Inbox.",
        postId: body.postId ?? null,
        status: body.status || "submitted",
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The photo could not be sent to TikTok.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="preview-backdrop tiktok-composer-backdrop" role="dialog" aria-modal="true" aria-label="Send generated photo to TikTok">
      <div className="tiktok-composer">
        <button type="button" className="preview-close" onClick={onClose} aria-label="Close TikTok posting controls">×</button>
        <div className="tiktok-composer-preview">
          <ReliableImage src={imageUrl} alt="Generated content preview for TikTok" fill sizes="(max-width: 760px) 92vw, 42vw" fallbackLabel="Generated image unavailable" />
          <span>Exact photo TikTok will receive</span>
        </div>
        <div className="tiktok-composer-controls">
          <div>
            <span className="testing-label">TikTok Creator Inbox</span>
            <h2>Review before sending</h2>
            <p>This uploads one generated photo through Zernio. TikTok opens it as a draft so you can verify the preview, apply the AI-generated label, and publish in the TikTok app.</p>
          </div>

          {loading ? <div className="tiktok-composer-status">Loading connected account…</div> : null}
          {error ? <div className="reference-alert" role="alert">{error}</div> : null}
          {result ? (
            <div className="tiktok-composer-success" role="status">
              <strong>{result.message}</strong>
              <span>Status: {result.status}{result.postId ? ` · Zernio post ${result.postId}` : ""}</span>
              <p>Open TikTok, inspect the received preview, turn on the AI-generated content label, then publish.</p>
            </div>
          ) : (
            <>
              <label>
                Account
                <select value={accountId} onChange={(event) => {
                  const nextId = event.target.value;
                  setAccountId(nextId);
                  const account = accounts.find((item) => item.id === nextId);
                  setPrivacyLevel(account?.privacyLevels[0]?.value ?? "");
                }} disabled={loading || accounts.length === 0}>
                  {accounts.length === 0 ? <option value="">No connected TikTok account</option> : null}
                  {accounts.map((account) => <option key={account.id} value={account.id}>@{account.username}</option>)}
                </select>
              </label>
              <label>
                Privacy supplied by TikTok
                <select value={privacyLevel} onChange={(event) => setPrivacyLevel(event.target.value)} disabled={!selectedAccount}>
                  {(selectedAccount?.privacyLevels ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                Photo title <small>{title.length}/90</small>
                <input value={title} maxLength={90} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label>
                Caption <small>{description.length}/4000</small>
                <textarea value={description} maxLength={4_000} rows={5} placeholder="Write the factual caption and any hashtags…" onChange={(event) => setDescription(event.target.value)} />
              </label>
              <div className="tiktok-composer-options">
                <label><input type="checkbox" checked={allowComment} onChange={(event) => setAllowComment(event.target.checked)} /> Allow comments</label>
                <label><input type="checkbox" checked={autoAddMusic} onChange={(event) => setAutoAddMusic(event.target.checked)} /> Let TikTok suggest music</label>
              </div>
              <div className="tiktok-composer-confirmations">
                <label><input type="checkbox" checked={previewConfirmed} onChange={(event) => setPreviewConfirmed(event.target.checked)} /> I reviewed the exact photo preview above.</label>
                <label><input type="checkbox" checked={consentGiven} onChange={(event) => setConsentGiven(event.target.checked)} /> I expressly consent to sending this content to TikTok.</label>
                <label><input type="checkbox" checked={aiAcknowledged} onChange={(event) => setAiAcknowledged(event.target.checked)} /> I will apply TikTok’s AI-generated content label before publishing.</label>
              </div>
              <button type="button" className="tiktok-send-button" disabled={!ready || sending} onClick={() => void submit()}>
                {sending ? "Uploading to TikTok…" : "Send photo to TikTok inbox"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
