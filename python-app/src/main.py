"""FastAPI application entry point: wires logging, metrics middleware and routes."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from endpoints import router
from logger import configure_logging, logger
from prometheus_config import PrometheusMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Configure logging when the application starts.

    Args:
        app: The FastAPI application being started.
    """
    configure_logging()
    logger.info("python-app started")
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(PrometheusMiddleware)
app.include_router(router)
