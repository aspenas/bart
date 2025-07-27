from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import time
from prometheus_client import Counter, Histogram, generate_latest
from starlette.responses import Response
import os
import sys

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.posthog_service import PostHogService, PostHogMiddleware

from .config import settings
from .config_enhanced import enhanced_settings
from .routers import (
    auth, workbooks, formulas, calculations, rag, health, citations,
    transform, audit, docs, scenarios
)
from . import files
from .database import engine, Base
from .middleware import RateLimitMiddleware, LoggingMiddleware
from .exceptions import BARTException

# Try to import bid tool routes if available
try:
    from ..bid_tool.api import projects as bid_tool_projects
    HAS_BID_TOOL = True
except ImportError:
    HAS_BID_TOOL = False


# BART Pricing Engine Integration
try:
    from bart_pricing.api.routes import router as pricing_router
    HAS_PRICING = True
except ImportError:
    HAS_PRICING = False
    print('Warning: BART Pricing Engine not installed. Run: pip install -e ./bart_pricing')

# Configure logging
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

# Prometheus metrics
try:
    REQUEST_COUNT = Counter(
        'bart_http_requests_total',
        'Total HTTP requests',
        ['method', 'endpoint', 'status']
    )
except ValueError:
    # Metric already registered
    from prometheus_client import REGISTRY
    REQUEST_COUNT = REGISTRY._names_to_collectors['bart_http_requests_total']

try:
    REQUEST_LATENCY = Histogram(
        'bart_http_request_duration_seconds',
        'HTTP request latency',
        ['method', 'endpoint']
    )
except ValueError:
    # Metric already registered
    from prometheus_client import REGISTRY
    REQUEST_LATENCY = REGISTRY._names_to_collectors['bart_http_request_duration_seconds']

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting BART RAG Platform API")
    
    # Track server startup
    PostHogService.track_anonymous('server.started', {
        'environment': os.getenv('ENVIRONMENT', 'development'),
        'version': '0.1.0',
        'features': {
            'pricing': HAS_PRICING,
            'bid_tool': HAS_BID_TOOL
        }
    })
    
    # Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    logger.info("Database initialized")
    
    # Initialize integrated features
    try:
        from ..core.integrated_features import IntegratedFeatures
        features = IntegratedFeatures(engine)
        await features.initialize()
        app.state.features = features
        logger.info("Integrated features initialized")
    except Exception as e:
        logger.warning(f"Could not initialize integrated features: {e}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down BART RAG Platform API")
    
    # Track server shutdown
    PostHogService.track_anonymous('server.stopped', {
        'environment': os.getenv('ENVIRONMENT', 'development')
    })
    
    # Flush PostHog events
    PostHogService.flush()

# Create FastAPI app
app = FastAPI(
    title="BART RAG Platform",
    description="Advanced Excel processing with RAG capabilities",
    version="0.1.0",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add trusted host middleware
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]  # Allow all hosts in development
)

# Add custom middleware
app.add_middleware(LoggingMiddleware)
app.add_middleware(RateLimitMiddleware, calls=100, period=60)
app.add_middleware(PostHogMiddleware)

# Request tracking middleware
@app.middleware("http")
async def track_requests(request: Request, call_next):
    start_time = time.time()
    
    response = await call_next(request)
    
    # Track metrics
    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=request.url.path,
        status=response.status_code
    ).inc()
    
    REQUEST_LATENCY.labels(
        method=request.method,
        endpoint=request.url.path
    ).observe(time.time() - start_time)
    
    return response

# Exception handlers
@app.exception_handler(BARTException)
async def bart_exception_handler(request: Request, exc: BARTException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.error_code,
            "message": exc.message,
            "details": exc.details
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_SERVER_ERROR",
            "message": "An unexpected error occurred"
        }
    )

# Metrics endpoint
@app.get("/metrics", include_in_schema=False)
async def metrics():
    return Response(generate_latest(), media_type="text/plain")

# Include routers
app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(workbooks.router, prefix="/api/v1/workbooks", tags=["workbooks"])
app.include_router(formulas.router, prefix="/api/v1/formulas", tags=["formulas"])
app.include_router(calculations.router, prefix="/api/v1/calculations", tags=["calculations"])
app.include_router(rag.router, prefix="/api/v1/rag", tags=["rag"])
app.include_router(citations.router, prefix="/api/v1/citations", tags=["citations"])
app.include_router(health.router, prefix="/api/v1/health", tags=["health"])

# Excel Tools routers
app.include_router(transform.router, prefix="/api/v1/tools", tags=["transformation"])
app.include_router(audit.router, prefix="/api/v1/tools", tags=["audit"])
app.include_router(docs.router, prefix="/api/v1/tools", tags=["documentation"])
app.include_router(scenarios.router, prefix="/api/v1/tools", tags=["scenarios"])

# File browser router
app.include_router(files.router)

# Bid Tool routers (if available)
if HAS_BID_TOOL:
    app.include_router(bid_tool_projects.router)
    logger.info("Bid Tool routes loaded")


# BART Pricing Engine routes
if HAS_PRICING:
    app.include_router(
        pricing_router,
        prefix="/api/pricing",
        tags=["pricing"],
        responses={404: {"description": "Not found"}}
    )
    logger.info("BART Pricing Engine routes loaded")

# Root endpoint
@app.get("/")
async def root():
    return {
        "name": "BART RAG Platform API",
        "version": "0.1.0",
        "status": "operational",
        "docs": "/docs",
        "redoc": "/redoc",
        "features": {
            "excel_tools": True,
            "rag": True,
            "citations": True,
            "bid_tool": HAS_BID_TOOL,
            "pricing": HAS_PRICING}
    }

# Info endpoint
@app.get("/api/v1/info")
async def info():
    return {
        "platform": "BART RAG Platform",
        "version": "0.1.0",
        "excel_tools": {
            "transformation": True,
            "audit": True,
            "documentation": True,
            "scenarios": True
        },
        "rag_features": {
            "embeddings": enhanced_settings.EMBEDDINGS_ENABLED,
            "reranking": enhanced_settings.RERANKING_ENABLED,
            "citations": enhanced_settings.CITATIONS_ENABLED
        },
        "bid_tool": {
            "available": HAS_BID_TOOL,
            "mobile_ready": HAS_BID_TOOL
        }
    }