import Link from "next/link";
import { listAutomationRuns } from "../../lib/automation-db";

export const dynamic = "force-dynamic";

function dateTime(value: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-US", {dateStyle:"medium",timeStyle:"short",timeZone:process.env.AUTOMATION_TIMEZONE?.trim() || "America/New_York"}).format(new Date(value));
}

export default function AutomationPage() {
  const runs = listAutomationRuns();
  return (
    <main className="automation-main">
      <Link className="home-menu-button" href="/"><span aria-hidden="true">⌂</span> Home</Link>
      <section className="automation-screen">
        <header className="generation-header">
          <p className="eyebrow">Daily workflow</p>
          <h1>GFNF automation runs</h1>
          <p className="supporting-copy">One overnight GFNF scan feeds a morning A/B carousel approval for Instagram.</p>
        </header>
        <div className="automation-run-list">
          {runs.map((run) => (
            <article className="automation-run-card" key={run.id}>
              <div className="automation-run-heading"><div><span>{run.runDate}</span><strong>{run.status.replaceAll("_"," ")}</strong></div><small>Updated {dateTime(run.updatedAt)}</small></div>
              <p>{run.candidateText || "No candidate selected yet."}</p>
              <dl>
                <div><dt>Reference</dt><dd>{run.referenceName || "Pending"}</dd></div>
                <div><dt>Schedule</dt><dd>{dateTime(run.scheduledFor)}</dd></div>
                <div><dt>Approval</dt><dd>{run.approvedVariation ? `Variation ${run.approvedVariation}` : "Waiting"}</dd></div>
                <div><dt>Zernio</dt><dd>{run.zernioPostId || "Not scheduled"}</dd></div>
              </dl>
              {run.signals && <small>{run.signals.explanation.join(" · ")} · score {run.signals.score}</small>}
              <div className="automation-variations">{run.variations.map((variation) => <span key={variation.id}><b>{variation.label}</b>{variation.status} · review {variation.reviewStatus}</span>)}</div>
              {run.error && <div className="reference-alert">{run.error}</div>}
            </article>
          ))}
          {runs.length === 0 && <div className="generation-empty"><span aria-hidden="true">↻</span><h2>No automation runs yet</h2><p>The first cron check will create today’s collecting run.</p></div>}
        </div>
      </section>
    </main>
  );
}
