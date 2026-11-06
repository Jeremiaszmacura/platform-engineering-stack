"""Domain errors, mapped to HTTP status codes by the inbound HTTP adapter."""


class StockDataError(Exception):
    """Base class for every error this service raises deliberately."""


class SymbolNotFoundError(StockDataError):
    """Raised when the provider does not know the requested symbol."""


class ProviderError(StockDataError):
    """Raised when the market data provider is unreachable or returns garbage."""


class RepositoryError(StockDataError):
    """Raised when the price bar store is unreachable or rejects a statement."""


class SecretNotFoundError(StockDataError):
    """Raised when no secret is stored under the requested key."""


class SecretStoreError(StockDataError):
    """Raised when the secret store is unreachable or rejects a request."""
