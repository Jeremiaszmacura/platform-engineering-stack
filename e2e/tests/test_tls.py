"""HTTPS through the shared Gateway, with a certificate cert-manager signs with the cluster's own CA."""

import base64

import pytest
import requests

from cluster import REQUEST_TIMEOUT_SECONDS, SERVICE_URLS, https, kubectl


@pytest.fixture(scope="module")
def cluster_ca(tmp_path_factory):
    """Return the path of a file holding the cluster CA's certificate, read from its Secret."""
    encoded = kubectl("get", "secret", "sample-cluster-ca", "-n", "cert-manager", "-o", r"jsonpath={.data.ca\.crt}")
    path = tmp_path_factory.mktemp("tls") / "sample-cluster-ca.crt"
    path.write_bytes(base64.b64decode(encoded))
    return str(path)


@pytest.mark.parametrize("service_name", sorted(SERVICE_URLS))
def test_service_answers_https(service_name, cluster_ca):
    """The service answers over HTTPS with a certificate valid for its hostname and signed by the cluster CA."""
    response = requests.get(https(SERVICE_URLS[service_name]), verify=cluster_ca, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200


def test_certificate_is_untrusted_without_the_cluster_ca():
    """A client that trusts only public CAs rejects the certificate."""
    with pytest.raises(requests.exceptions.SSLError):
        requests.get(https(SERVICE_URLS["documentation"]), timeout=REQUEST_TIMEOUT_SECONDS)
