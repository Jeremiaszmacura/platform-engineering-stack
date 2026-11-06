import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

// Backends under test, called cross-origin on their ingress hosts (CORS enabled at the ingress)
const BACKENDS = {
  'python-app': { label: '🐍 Python App (FastAPI)', baseUrl: 'http://python.localhost' },
  'go-app': { label: '🔧 Go App (Gin)', baseUrl: 'http://go.localhost' },
};

// Both backends share the same endpoint contract
const ENDPOINTS = [
  { path: '/', name: 'Home', method: 'GET', description: 'Get welcome message' },
  { path: '/health', name: 'Health Check', method: 'GET', description: 'Check app health' },
  { path: '/error', name: 'Error', method: 'GET', description: 'Simulate error (500)' },
  { path: '/redirect', name: 'Redirect', method: 'GET', description: 'Redirect to health' },
  { path: '/metrics', name: 'Metrics', method: 'GET', description: 'Prometheus metrics' },
];

function App() {
  const [selectedApp, setSelectedApp] = useState('python-app');
  const [selectedEndpoint, setSelectedEndpoint] = useState('Home');
  const [requestCount, setRequestCount] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    successful: 0,
    failed: 0,
    avgResponseTime: 0
  });

  const getSelectedEndpointMeta = () => {
    return ENDPOINTS.find((e) => e.name === selectedEndpoint);
  };

  const makeRequest = async (url) => {
    const startTime = Date.now();
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        validateStatus: (status) => status < 600
      });
      const endTime = Date.now();
      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        data: response.data,
        responseTime: endTime - startTime,
        timestamp: new Date().toLocaleTimeString()
      };
    } catch (error) {
      const endTime = Date.now();
      return {
        success: false,
        status: error.response?.status || 'ERROR',
        statusText: error.response?.statusText || error.message,
        data: error.response?.data || error.message,
        responseTime: endTime - startTime,
        timestamp: new Date().toLocaleTimeString()
      };
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setResults([]);

    const meta = getSelectedEndpointMeta();
    const baseUrl = BACKENDS[selectedApp].baseUrl;
    const fullUrl = `${baseUrl}${meta ? meta.path : '/'}`;

    const requests = [];
    const newResults = [];

    // Make all requests concurrently for better performance
    for (let i = 0; i < requestCount; i++) {
      requests.push(makeRequest(fullUrl));
    }

    try {
      const responses = await Promise.all(requests);
      newResults.push(...responses);

      // Calculate statistics
      const successful = responses.filter(r => r.success && r.status >= 200 && r.status < 400).length;
      const failed = responses.length - successful;
      const avgResponseTime = responses.reduce((sum, r) => sum + r.responseTime, 0) / responses.length;

      setStats({
        total: responses.length,
        successful,
        failed,
        avgResponseTime: Math.round(avgResponseTime)
      });

      setResults(newResults);
    } catch (error) {
      console.error('Error making requests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearResults = () => {
    setResults([]);
    setStats({ total: 0, successful: 0, failed: 0, avgResponseTime: 0 });
  };

  const getStatusColor = (status) => {
    if (typeof status === 'number') {
      if (status >= 200 && status < 300) return 'success';
      if (status >= 300 && status < 400) return 'redirect';
      if (status >= 400 && status < 500) return 'client-error';
      if (status >= 500) return 'server-error';
    }
    return 'error';
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>🚀 Kubernetes Cluster API Tester</h1>
        <p>Test your Python and Go applications deployed in Kubernetes</p>
      </header>

      <main className="App-main">
        <form onSubmit={handleSubmit} className="request-form">
          <div className="form-group">
            <label htmlFor="app-select">Select Application:</label>
            <select
              id="app-select"
              value={selectedApp}
              onChange={(e) => {
                setSelectedApp(e.target.value);
              }}
              className="form-control"
            >
              {Object.entries(BACKENDS).map(([name, backend]) => (
                <option key={name} value={name}>{backend.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="endpoint-select">Select Endpoint:</label>
            <select
              id="endpoint-select"
              value={selectedEndpoint}
              onChange={(e) => setSelectedEndpoint(e.target.value)}
              className="form-control"
            >
              {ENDPOINTS.map((endpoint) => (
                <option key={endpoint.name} value={endpoint.name}>
                  [{endpoint.method}] {endpoint.name} ({endpoint.path}) - {endpoint.description}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="request-count">Number of Requests:</label>
            <input
              type="number"
              id="request-count"
              value={requestCount}
              onChange={(e) => setRequestCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              className="form-control"
              min="1"
              max="100"
            />
            <small className="form-text">Between 1 and 100 requests</small>
          </div>

          <div className="form-actions">
            <button
              type="submit"
              disabled={isLoading}
              className="btn btn-primary"
            >
              {isLoading ? '🔄 Sending Requests...' : `🚀 Send ${requestCount} Request${requestCount > 1 ? 's' : ''}`}
            </button>

            {results.length > 0 && (
              <button
                type="button"
                onClick={clearResults}
                className="btn btn-secondary"
              >
                🗑️ Clear Results
              </button>
            )}
          </div>
        </form>

        {stats.total > 0 && (
          <div className="stats-section">
            <h3>📊 Request Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-label">Total Requests:</span>
                <span className="stat-value">{stats.total}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Successful:</span>
                <span className="stat-value success">{stats.successful}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Failed:</span>
                <span className="stat-value error">{stats.failed}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Avg Response Time:</span>
                <span className="stat-value">{stats.avgResponseTime}ms</span>
              </div>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="results-section">
            <h3>📋 Request Results</h3>
            <div className="results-container">
              {results.map((result, index) => (
                <div key={index} className={`result-item ${getStatusColor(result.status)}`}>
                  <div className="result-header">
                    <span className="result-index">#{index + 1}</span>
                    <span className="result-status">
                      {result.status} {result.statusText}
                    </span>
                    <span className="result-time">{result.responseTime}ms</span>
                    <span className="result-timestamp">{result.timestamp}</span>
                  </div>
                  <div className="result-body">
                    <pre>{JSON.stringify(result.data, null, 2)}</pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <footer className="App-footer">
        <p>
          🎯 Target: <strong>{selectedApp}</strong> |
          🌐 Endpoint: <strong>{getSelectedEndpointMeta()?.path || '/'}</strong> |
          📦 Requests: <strong>{requestCount}</strong>
        </p>
      </footer>
    </div>
  );
}

export default App;
