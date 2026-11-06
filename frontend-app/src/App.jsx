/**
 * The application shell: navigation bar, the request being built, and what
 * came back from it.
 *
 * There is one screen here, so the state of a run lives in this component and
 * everything below it is presentational. Results are replaced by each run
 * rather than appended: the statistics describe the burst that was just sent,
 * not a session's worth of history.
 */

import React, { useCallback, useMemo, useState } from 'react';

import { APPS, DEFAULT_RANGE, ENDPOINTS, appById, buildUrl } from './lib/endpoints';
import { NavBar } from './components/NavBar';
import { RequestForm } from './components/RequestForm';
import { ResultList } from './components/ResultList';
import { RunStats } from './components/RunStats';
import { sendBurst } from './api/backends';
import { summarize } from './lib/run';
import { useTheme } from './hooks/useTheme';

/** Where a session starts: one request to the first endpoint of the first backend. */
const INITIAL_APP_ID = APPS[0].id;
const INITIAL_ENDPOINT_NAME = ENDPOINTS[INITIAL_APP_ID][0].name;

/**
 * Render the application.
 *
 * @returns {JSX.Element} The app.
 */
export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [appId, setAppId] = useState(INITIAL_APP_ID);
  const [endpointName, setEndpointName] = useState(INITIAL_ENDPOINT_NAME);
  const [params, setParams] = useState({ symbol: 'AAPL', ...DEFAULT_RANGE, count: 1 });
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState([]);

  const app = appById(appId);
  const endpoints = ENDPOINTS[appId];
  const endpoint = endpoints.find((candidate) => candidate.name === endpointName) ?? endpoints[0];
  const targetUrl = buildUrl(app, endpoint, params);
  const summary = useMemo(() => summarize(results), [results]);

  // The two backends share no endpoints, so the selection cannot survive a
  // change of target and falls back to the first one offered.
  const selectApp = useCallback((chosen) => {
    setAppId(chosen);
    setEndpointName(ENDPOINTS[chosen][0].name);
  }, []);

  const changeParam = useCallback((name, value) => {
    setParams((current) => ({ ...current, [name]: value }));
  }, []);

  const run = useCallback(async () => {
    setIsRunning(true);
    setResults([]);
    try {
      setResults(await sendBurst(targetUrl, params.count));
    } finally {
      setIsRunning(false);
    }
  }, [targetUrl, params.count]);

  const clear = useCallback(() => setResults([]), []);

  return (
    <div className="shell">
      <NavBar
        apps={APPS}
        activeAppId={appId}
        onSelectApp={selectApp}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="page">
        <div className="page__intro">
          <h1 className="page__title">
            Send traffic,
            <br />
            watch it land.
          </h1>
          <p className="page__lede">
            Pick a backend and one of its endpoints, fire up to a hundred concurrent requests at it, and read
            every response. The same traffic arrives on the Grafana dashboards a moment later.
          </p>
        </div>

        <div className="console-grid">
          <RequestForm
            app={app}
            endpoints={endpoints}
            endpoint={endpoint}
            onSelectEndpoint={setEndpointName}
            params={params}
            onChangeParam={changeParam}
            targetUrl={targetUrl}
            isRunning={isRunning}
            hasResults={results.length > 0}
            onRun={run}
            onClear={clear}
          />

          <section className="console-output" aria-label="Results">
            {summary.total > 0 && <RunStats summary={summary} />}
            <ResultList results={results} isRunning={isRunning} />
          </section>
        </div>
      </main>

      <p className="footnote">
        Requests go straight to {app.baseUrl} from the browser, cross-origin, the same path curl and the e2e
        suite take. Market data charts live in Stock App at http://stock-ui.localhost.
      </p>
    </div>
  );
}
