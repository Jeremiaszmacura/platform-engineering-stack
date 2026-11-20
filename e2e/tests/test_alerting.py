"""End-to-end tests of alerting: rules in Prometheus -> Alertmanager -> its UI and Grafana."""

from datetime import UTC, datetime, timedelta

import requests

from cluster import (
    ALERT_DELIVERY_TIMEOUT_SECONDS,
    ALERTMANAGER_URL,
    GRAFANA_CREDENTIALS,
    GRAFANA_URL,
    REQUEST_TIMEOUT_SECONDS,
    wait_until,
)

SILENCE_DURATION = timedelta(minutes=5)


def fetch_alerts(alertname):
    """Return Alertmanager's alerts named alertname."""
    response = requests.get(
        f"{ALERTMANAGER_URL}/api/v2/alerts",
        params={"filter": f'alertname="{alertname}"'},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def create_silence(alertname):
    """Silence alertname for SILENCE_DURATION and return the silence's ID."""
    now = datetime.now(UTC)
    response = requests.post(
        f"{ALERTMANAGER_URL}/api/v2/silences",
        json={
            "matchers": [{"name": "alertname", "value": alertname, "isRegex": False, "isEqual": True}],
            "startsAt": now.isoformat(),
            "endsAt": (now + SILENCE_DURATION).isoformat(),
            "createdBy": "e2e",
            "comment": "e2e test of silences",
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()["silenceID"]


def expire_silence(silence_id):
    """Expire the silence silence_id."""
    response = requests.delete(f"{ALERTMANAGER_URL}/api/v2/silence/{silence_id}", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()


def is_silenced_by(alertname, silence_id):
    """Return True if every alertname alert is suppressed by silence_id."""
    alerts = fetch_alerts(alertname)
    return bool(alerts) and all(silence_id in alert["status"]["silencedBy"] for alert in alerts)


def test_prometheus_sends_alerts_to_alertmanager():
    """The always-firing Watchdog arrives in Alertmanager."""
    wait_until(
        lambda: fetch_alerts("Watchdog"),
        ALERT_DELIVERY_TIMEOUT_SECONDS,
        description="the Watchdog alert in Alertmanager",
    )


def test_silence_suppresses_matching_alert():
    """A silence on Watchdog marks it suppressed until the silence expires."""
    wait_until(lambda: fetch_alerts("Watchdog"), ALERT_DELIVERY_TIMEOUT_SECONDS, description="the Watchdog alert")
    silence_id = create_silence("Watchdog")
    try:
        wait_until(
            lambda: is_silenced_by("Watchdog", silence_id),
            REQUEST_TIMEOUT_SECONDS,
            description="Watchdog to be silenced",
        )
    finally:
        expire_silence(silence_id)
    wait_until(
        lambda: not is_silenced_by("Watchdog", silence_id),
        REQUEST_TIMEOUT_SECONDS,
        description="Watchdog to be active again",
    )


def test_grafana_has_alertmanager_datasource():
    """Grafana is provisioned with an Alertmanager datasource."""
    response = requests.get(f"{GRAFANA_URL}/api/datasources", auth=GRAFANA_CREDENTIALS, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert "alertmanager" in {datasource["type"] for datasource in response.json()}
