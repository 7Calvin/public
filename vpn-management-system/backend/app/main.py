"""
VPN Management System - Main Application
"""
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import time
import logging

from app.core.config import settings
from app.db.session import engine, AsyncSessionLocal
from app.db.init_db import create_initial_admin, create_default_firewall_rules
from app.api.v1.api import api_router
# Import all models to register them with SQLAlchemy
from app.models import *

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Sistema completo de gerenciamento OpenVPN com interface web",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# ==================== Middleware ====================

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trusted Host (security)
if not settings.DEBUG:
    app.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=["*"]  # Configure com seus domínios em produção
    )


# Request timing middleware
@app.middleware("http")
async def add_process_time_header(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response


# Audit middleware — records mutating actions to the audit trail.
@app.middleware("http")
async def audit_trail_middleware(request: Request, call_next):
    from app.services import audit_service
    ctx = None
    try:
        ctx = await audit_service.pre_audit(request)  # target name before delete/edit
    except Exception:  # noqa: BLE001
        ctx = None

    response = await call_next(request)

    # For creates, the new object's name/flags live in the response body (there is
    # no id in the path). Read the response — not the request — to enrich the entry.
    try:
        if audit_service.wants_response_body(request, response.status_code):
            from starlette.responses import Response as _Response
            chunks = [section async for section in response.body_iterator]
            raw = b"".join(chunks)
            response = _Response(
                content=raw, status_code=response.status_code,
                headers=dict(response.headers), media_type=response.media_type,
            )
            created = audit_service.created_ctx_from_body(request, raw)
            if created:
                ctx = {**(ctx or {}), **created}
    except Exception:  # noqa: BLE001 — never let auditing corrupt a response
        pass

    try:
        await audit_service.record_request(request, response.status_code, ctx)
    except Exception:  # noqa: BLE001 — auditing must never break a request
        pass
    return response


# ==================== Exception Handlers ====================

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    logger.error(f"HTTP error: {exc.status_code} - {exc.detail}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "message": exc.detail,
            "status_code": exc.status_code
        }
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"Validation error: {exc.errors()}")
    # Sanitize errors: Pydantic v2 may include ValueError objects
    # in ctx that are not JSON serializable
    sanitized_errors = []
    for err in exc.errors():
        clean_err = {
            "type": err.get("type", ""),
            "loc": list(err.get("loc", [])),
            "msg": str(err.get("msg", "")),
            "input": str(err.get("input", "")) if err.get("input") is not None else None,
        }
        sanitized_errors.append(clean_err)
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": True,
            "message": "Validation error",
            "details": sanitized_errors
        }
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": True,
            "message": "Internal server error" if not settings.DEBUG else str(exc)
        }
    )


# ==================== Events ====================

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    logger.info(f"Starting {settings.PROJECT_NAME} v{settings.VERSION}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Debug mode: {settings.DEBUG}")

    # Note: Database migrations are run by scripts/start.sh before app starts
    # Here we only verify the connection and create initial admin if needed
    try:
        # Create initial admin user and default firewall rules if not exists
        async with AsyncSessionLocal() as db:
            await create_initial_admin(db)
            await create_default_firewall_rules(db)

    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        # Don't raise - allow app to start even if DB is not ready
        # This is useful for health checks in container orchestration

    logger.info("Application started successfully")

    # Background audit-log retention: prune entries older than the configured
    # window once a day. (Retention days will become configurable via settings.)
    import asyncio

    async def _audit_retention_loop():
        from app.services.audit_service import prune_old
        retention_days = getattr(settings, "AUDIT_RETENTION_DAYS", 90)
        while True:
            try:
                deleted = await prune_old(retention_days)
                if deleted:
                    logger.info(f"Audit retention: pruned {deleted} old entries")
            except Exception as e:  # noqa: BLE001
                logger.warning(f"Audit retention loop error: {e}")
            await asyncio.sleep(24 * 3600)

    asyncio.create_task(_audit_retention_loop())

    # Note: Firewall rules are saved in database and applied by NAT agent
    # The backend does not directly modify iptables (requires privileged container)


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down application...")
    # Close database connections, etc
    await engine.dispose()
    logger.info("Application shut down successfully")


# ==================== Routes ====================

@app.get("/", tags=["Root"])
async def root():
    """Root endpoint"""
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "running",
        "environment": settings.ENVIRONMENT
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint for Docker/K8s"""
    return {
        "status": "healthy",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT
    }


@app.get("/ready", tags=["Health"])
async def readiness_check():
    """Readiness check - verify dependencies"""
    # TODO: Check database, redis, etc
    return {
        "status": "ready",
        "database": "ok",
        "redis": "ok"
    }


# Include API router
app.include_router(api_router, prefix=settings.API_V1_PREFIX)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.BACKEND_HOST,
        port=settings.BACKEND_PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower()
    )
