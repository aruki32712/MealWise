import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type LatestRun = {
  status: "passed" | "failed" | "error";
  passed_assertions: number;
  failed_assertions: number;
  executed_at: string;
};

type Scenario = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  scenario_version: number;
  expected: Record<string, unknown>;
  latest_run: LatestRun | null;
};

type SuiteResult = {
  passed: boolean;
  total_scenarios: number;
  passed_scenarios: number;
  failed_scenarios: number;
  runner_version: string;
  results: Array<{
    slug: string;
    name: string;
    status: string;
    assertions: Record<string, boolean>;
    actual: Record<string, unknown>;
  }>;
};

function niceCategory(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function when(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function statusLabel(status?: string | null) {
  if (!status) return "Not run";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function MealWiseDemoTest() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [suite, setSuite] = useState<SuiteResult | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [singleResult, setSingleResult] = useState<any>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadScenarios();
  }, []);

  async function invoke(action: string, extra: Record<string, unknown> = {}) {
    const { data, error } = await supabase.functions.invoke("mealwise-demo-test", {
      body: { action, ...extra },
    });
    if (error) throw error;
    return data;
  }

  async function loadScenarios() {
    setBusy(true);
    setError("");
    try {
      const data = await invoke("list");
      setScenarios(data?.scenarios ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Unable to load Demo/Test Mode.");
    } finally {
      setBusy(false);
    }
  }

  async function runAll() {
    setBusy(true);
    setError("");
    setMessage("");
    setSingleResult(null);
    try {
      const data = await invoke("run_all");
      setSuite(data?.suite ?? null);
      const summary = data?.suite;
      setMessage(summary?.passed
        ? `All ${summary.total_scenarios} permanent MealWise scenarios passed.`
        : `${summary?.failed_scenarios ?? 0} scenario(s) failed. Open the failed scenario below.`);
      await loadScenarios();
    } catch (e: any) {
      setError(e?.message ?? "Unable to run the test suite.");
      setBusy(false);
    }
  }

  async function runOne(slug: string) {
    setBusy(true);
    setError("");
    setMessage("");
    setSelectedSlug(slug);
    setSingleResult(null);
    try {
      const data = await invoke("run_one", { slug });
      setSingleResult(data);
      const passed = Boolean(data?.evaluation?.passed);
      setMessage(passed ? `${data?.scenario?.name ?? slug} passed.` : `${data?.scenario?.name ?? slug} failed.`);
      await loadScenarios();
    } catch (e: any) {
      setError(e?.message ?? `Unable to run ${slug}.`);
      setBusy(false);
    }
  }

  const suiteBySlug = useMemo(() => {
    const map = new Map<string, SuiteResult["results"][number]>();
    for (const result of suite?.results ?? []) map.set(result.slug, result);
    return map;
  }, [suite]);

  return <div className="mw-feature">
    <div className="mw-feature-title">
      <div>
        <h2>Permanent Demo / Test Lab</h2>
        <p>Runs controlled Supabase fixtures without creating fake customer accounts or using live retailer prices.</p>
      </div>
      <button className="mw-primary" type="button" disabled={busy} onClick={runAll}>{busy ? "Running…" : "Run All 7 Tests"}</button>
    </div>

    <div className="mw-test-note">
      <strong>Internal only.</strong> These prices are fixed mock prices used to catch regressions in pantry subtraction, package math, diet/allergy rules, store-stop logic, locked meals, and Budget Rescue.
    </div>

    {error && <div className="mw-alert error">{error}</div>}
    {message && <div className="mw-alert success">{message}</div>}

    {suite && <div className="mw-test-summary">
      <div><span>Suite status</span><strong className={suite.passed ? "pass" : "fail"}>{suite.passed ? "PASS" : "FAIL"}</strong></div>
      <div><span>Passed</span><strong>{suite.passed_scenarios}/{suite.total_scenarios}</strong></div>
      <div><span>Failed</span><strong>{suite.failed_scenarios}</strong></div>
      <div><span>Runner</span><strong>{suite.runner_version}</strong></div>
    </div>}

    <div className="mw-test-grid">
      {scenarios.map((scenario) => {
        const suiteResult = suiteBySlug.get(scenario.slug);
        const latest = scenario.latest_run;
        const resultStatus = suiteResult?.status ?? latest?.status ?? null;
        return <article className="mw-test-card" key={scenario.id}>
          <div className="mw-test-card-head">
            <div><span className="mw-test-category">{niceCategory(scenario.category)}</span><h3>{scenario.name}</h3></div>
            <span className={`mw-test-status ${resultStatus ?? "not-run"}`}>{statusLabel(resultStatus)}</span>
          </div>
          <p>{scenario.description}</p>
          <div className="mw-test-meta">
            <span>Fixture v{scenario.scenario_version}</span>
            <span>Latest: {when(latest?.executed_at)}</span>
            {latest && <span>{latest.passed_assertions} passed · {latest.failed_assertions} failed assertions</span>}
          </div>
          <button className="mw-secondary" type="button" disabled={busy} onClick={() => runOne(scenario.slug)}>
            {busy && selectedSlug === scenario.slug ? "Running…" : "Run This Scenario"}
          </button>

          {singleResult?.scenario?.slug === scenario.slug && <div className="mw-test-detail">
            <strong>{singleResult.evaluation?.passed ? "Passed assertions" : "Assertion details"}</strong>
            <div className="mw-test-assertions">
              {Object.entries(singleResult.evaluation?.assertions ?? {}).map(([key, value]) =>
                <span key={key} className={value ? "pass" : "fail"}>{value ? "✓" : "✕"} {key.replaceAll("_", " ")}</span>
              )}
            </div>
            <details>
              <summary>View calculated result</summary>
              <pre>{JSON.stringify(singleResult.evaluation?.actual ?? {}, null, 2)}</pre>
            </details>
          </div>}
        </article>;
      })}
    </div>

    {!busy && scenarios.length === 0 && !error && <div className="mw-empty">No permanent test fixtures are available.</div>}
  </div>;
}
