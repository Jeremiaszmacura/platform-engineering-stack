"""End-to-end tests of alerting: rules in Prometheus -> Alertmanager -> its UI and Grafana."""

from datetime import UTC, datetime, timedelta

import requests

from cluster import (
    JsonObject,
    ALERT_DELIVERY_TIMEOUT_SECONDS,
    ALERTMANAGER_URL,
    GRAFANA_CREDENTIALS,
    GRAFANA_URL,
    REQUEST_TIMEOUT_SECONDS,
    wait_until,
)

SILENCE_DURATION = timedelta(minutes=5)


def fetch_alerts(alertname: str) -> list[JsonObject]:
    """Return Alertmanager's alerts named alertname."""
    response = requests.get(
        f"{ALERTMANAGER_URL}/api/v2/alerts",
        params={"filter": f'alertname="{alertname}"'},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def create_silence(alertname: str) -> str:
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


def expire_silence(silence_id: str) -> None:
    """Expire the silence silence_id."""
    response = requests.delete(f"{ALERTMANAGER_URL}/api/v2/silence/{silence_id}", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()


def is_silenced_by(alertname: str, silence_id: str) -> bool:
    """Return True if every alertname alert is suppressed by silence_id."""
    alerts = fetch_alerts(alertname)
    return bool(alerts) and all(silence_id in alert["status"]["silencedBy"] for alert in alerts)


def test_prometheus_sends_alerts_to_alertmanager() -> None:
    """The always-firing Watchdog arrives in Alertmanager."""
    wait_until(
        lambda: fetch_alerts("Watchdog"),
        ALERT_DELIVERY_TIMEOUT_SECONDS,
        description="the Watchdog alert in Alertmanager",
    )


def test_silence_suppresses_matching_alert() -> None:
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


def watchdog_in_grafana() -> bool:
    """Return True if Grafana's Alert groups, read through the Alertmanager datasource, list the Watchdog."""
    response = requests.get(
        f"{GRAFANA_URL}/api/alertmanager/alertmanager/api/v2/alerts/groups",
        auth=GRAFANA_CREDENTIALS,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    alerts = [alert for group in response.json() for alert in group["alerts"]]
    return any(alert["labels"]["alertname"] == "Watchdog" for alert in alerts)


def test_grafana_shows_alertmanager_alerts() -> None:
    """Grafana reaches Alertmanager through its datasource and shows the Watchdog."""
    wait_until(watchdog_in_grafana, ALERT_DELIVERY_TIMEOUT_SECONDS, description="the Watchdog alert in Grafana")
