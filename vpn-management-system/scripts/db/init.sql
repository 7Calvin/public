-- ============================================
-- VPN Management System - Database Initialization
-- PostgreSQL 17
-- ============================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy search

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE vpn_management TO vpn_admin;

-- Set timezone
SET timezone = 'UTC';

-- Performance optimizations for PostgreSQL 17
ALTER DATABASE vpn_management SET random_page_cost = 1.1;
ALTER DATABASE vpn_management SET effective_cache_size = '4GB';
ALTER DATABASE vpn_management SET shared_buffers = '1GB';
ALTER DATABASE vpn_management SET work_mem = '50MB';

-- Success message
SELECT 'Database initialized successfully!' AS status;
