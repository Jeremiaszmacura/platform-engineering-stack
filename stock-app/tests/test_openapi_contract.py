"""Tests that openapi.yaml and the routes describe the same API, and that the service publishes it."""

import unittest

from fastapi.openapi.utils import get_openapi
from fastapi.testclient import TestClient
from openapi_spec_validator import validate

from src.adapters.inbound.http.params import MAX_RANGE_DAYS, SECRET_KEY_PATTERN, SYMBOL_PATTERN
from src.adapters.inbound.http.spec import CONTRACT_PATH, YAML_MEDIA_TYPE, load_contract
from src.main import app


def operations(document: dict) -> set[tuple[str, str, str]]:
    """Return (path, method, operationId) for every operation in an OpenAPI document."""
    return {
        (path, method, operation["operationId"])
        for path, path_item in document["paths"].items()
        for method, operation in path_item.items()
    }


def routed_operations() -> set[tuple[str, str, str]]:
    """Return the operations the routes implement, via FastAPI's own generator."""
    return operations(get_openapi(title=app.title, version=app.version, routes=app.routes))


def declared_operations() -> set[tuple[str, str, str]]:
    """Return the operations openapi.yaml declares."""
    return operations(load_contract())


class TestContractIsWellFormed(unittest.TestCase):
    """Tests that openapi.yaml is a valid OpenAPI document (model generation alone wouldn't catch a bad $ref)."""

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
    """Tests that limits enforced in code match what the contract describes in prose."""

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
