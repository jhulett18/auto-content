"use client";

import { useEffect, useState } from "react";
import type { GenerationBudget } from "../lib/reference-types";

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

export function notifyGenerationCostChanged() {
  window.dispatchEvent(new Event("generation-cost-changed"));
}

export default function GenerationCostStatus({ compact = false }: { compact?: boolean }) {
  const [budget, setBudget] = useState<GenerationBudget | null>(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      void fetch("/api/generation-budget", { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: GenerationBudget) => setBudget(payload))
        .catch(() => setBudget(null));
    };
    load();
    window.addEventListener("generation-cost-changed", load);
    return () => window.removeEventListener("generation-cost-changed", load);
  }, []);

  async function saveBalance() {
    const balanceUsd = Number(balanceInput);
    if (!Number.isFinite(balanceUsd) || balanceUsd < 0) {
      setError("Enter the current available balance.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/generation-budget", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ balanceUsd }),
      });
      const payload = await response.json() as GenerationBudget | { error?: string };
      if (!response.ok || !("configured" in payload)) throw new Error("error" in payload && payload.error ? payload.error : "The image budget could not be saved.");
      setBudget(payload);
      setBalanceInput("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The image budget could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const budgetForm = (
    <form className="generation-budget-form" onSubmit={(event) => { event.preventDefault(); void saveBalance(); }}>
      <label>Current available balance<input type="number" min="0" step="0.01" inputMode="decimal" value={balanceInput} onChange={(event) => setBalanceInput(event.target.value)} placeholder="10.00" /></label>
      <button type="submit" disabled={saving}>{saving ? "Saving…" : "Set balance"}</button>
      {error && <small role="alert">{error}</small>}
    </form>
  );

  if (!budget) return null;
  if (!budget.configured) {
    return compact ? null : (
      <div className="generation-budget unconfigured" role="status">
        <strong>Image budget not configured</strong>
        <span>Enter the current balance to track future image spend and enable the $3 warning.</span>
        {budgetForm}
      </div>
    );
  }

  return (
    <div className={`generation-budget ${budget.low ? "low" : ""} ${compact ? "compact" : ""}`} role={budget.low ? "alert" : "status"}>
      <span>{budget.low ? "Low image budget" : "Image budget remaining"}</span>
      <strong>{money(budget.remainingUsd ?? 0)}</strong>
      {!compact && <small>{money(budget.spentUsd)} recorded spend · warning below {money(budget.warningThresholdUsd)}</small>}
      {!compact && <details><summary>Update current balance</summary>{budgetForm}</details>}
    </div>
  );
}

export function generationCostLabel(costUsd: number | null) {
  if (costUsd === null) return "Cost not recorded";
  if (costUsd === 0) return "$0.00 · local render";
  return `${money(costUsd)} API cost`;
}
