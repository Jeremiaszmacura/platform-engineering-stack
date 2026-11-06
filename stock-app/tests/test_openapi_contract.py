"""Tests that the contract and the service it describes cannot drift apart.

``openapi.yaml`` is the source of truth for the HTTP surface, which is only
worth anything if publishing it and implementing it are checked against each
other. These tests fail on a route that no operation declares, an operation
that no route implements, and on the two constants the contract has to repeat
in prose because JSON Schema cannot express them.
"""

import unittest

from fastapi.openapi.utils import get_openapi
from fastapi.testclient import TestClient
from openapi_spec_validator import validate

from src.adapters.inbound.http.params import MAX_RANGE_DAYS, SECRET_KEY_PATTERN, SYMBOL_PATTERN
from src.adapters.inbound.http.spec import CONTRACT_PATH, YAML_MEDIA_TYPE, load_contract
from src.main import app


def operations(document: dict) -> set[tuple[str, str, str]]:
    """Return the identity of every operation in an OpenAPI document.

    Args:
        document: A parsed OpenAPI document.

    Returns:
        One ``(path, method, operationId)`` triple per operation.
    """
    return {
        (path, method, operation["operationId"])
        for path, path_item in document["paths"].items()
        for method, operation in path_item.items()
    }


def routed_operations() -> set[tuple[str, str, str]]:
    """Return the operations the registered routes implement.

    Uses FastAPI's own code-to-document generator, so the comparison below is
    between two OpenAPI documents rather than between a document and a private
    routing structure.

    Returns:
        The operations of the document FastAPI derives from the code.
    """
    return operations(get_openapi(title=app.title, version=app.version, routes=app.routes))


def declared_operations() -> set[tuple[str, str, str]]:
    """Return the operations the authored contract declares.

    Returns:
        The operations of ``openapi.yaml``.
    """
    return operations(load_contract())


class TestContractIsWellFormed(unittest.TestCase):
    """Tests that what the service publishes is a valid OpenAPI document.

    Generating the models only reads ``components/schemas``, so a broken
    ``$ref`` to a response or a parameter would otherwise ship unnoticed and
    surface as a blank Swagger UI.
    """

    def test_contract_validates_against_the_openapi_schema(self):
        validate(load_contract())


class TestContractCoverage(unittest.TestCase):
    """Tests that every operation is declared exactly once on both sides."""

    def test_every_declared_operation_is_served(self):
        self.assertEqual(set(), declared_operations() - routed_operations())

    def test_every_served_operation_is_declared(self):
        self.assertEqual(set(), routed_operations() - declared_operations())


class TestContractIsPublished(unittest.TestCase):
    """Tests that clients are handed the authored contract, not a derived one."""

    def test_contract_endpoint_serves_the_yaml_file_unchanged(self):
        served = TestClient(app).get("/openapi.yaml")

        self.assertEqual(served.status_code, 200)
        self.assertEqual(served.headers["content-type"].split(";")[0], YAML_MEDIA_TYPE)
        self.assertEqual(served.text, CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_no_document_derived_from_the_code_is_served(self):
        self.assertEqual(TestClient(app).get("/openapi.json").status_code, 404)

    def test_swagger_ui_loads_the_yaml_contract(self):
        page = TestClient(app).get("/docs")

        self.assertEqual(page.status_code, 200)
        self.assertIn("/openapi.yaml", page.text)


class TestRulesStatedInProse(unittest.TestCase):
    """Tests the two rules the contract can only describe, not declare.

    A cross-parameter rule has no JSON Schema equivalent, so the range cap is
    enforced in code and described in the contract. These assertions stop the
    description from quietly becoming a lie.
    """

    def test_symbol_pattern_matches_the_contract(self):
        declared = load_contract()["components"]["parameters"]["Symbol"]["schema"]["pattern"]

        self.assertEqual(declared, SYMBOL_PATTERN)

    def test_secret_key_pattern_matches_the_contract(self):
        declared = load_contract()["components"]["parameters"]["SecretKey"]["schema"]["pattern"]

        self.assertEqual(declared, SECRET_KEY_PATTERN)

    def test_range_cap_is_the_one_the_contract_documents(self):
        described = load_contract()["components"]["parameters"]["End"]["description"]

        self.assertIn(str(MAX_RANGE_DAYS), described)


if __name__ == "__main__":
    unittest.main()
