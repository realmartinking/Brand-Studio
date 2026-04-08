#!/usr/bin/env bash
set -e

# Ensure Homebrew and standard tools are on PATH
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:$PATH"

echo "=== Brand Studio Setup ==="

# ── 1. Redis ──────────────────────────────────────────────────────────────────

echo ""
echo "→ Checking Redis..."

if ! command -v redis-server &>/dev/null; then
  echo "  Installing Redis via Homebrew..."
  brew install redis
else
  echo "  Redis already installed: $(redis-server --version)"
fi

# Start Redis service (idempotent)
if brew services list | grep -q "^redis.*started"; then
  echo "  Redis service is already running."
else
  echo "  Starting Redis service..."
  brew services start redis
fi

# Wait for Redis to be ready
echo -n "  Waiting for Redis on :6379 "
for i in $(seq 1 10); do
  if redis-cli ping &>/dev/null; then
    echo " OK"
    break
  fi
  echo -n "."
  sleep 1
  if [ "$i" -eq 10 ]; then
    echo ""
    echo "  ERROR: Redis did not start in time." >&2
    exit 1
  fi
done

# ── 2. PostgreSQL role & database ────────────────────────────────────────────

echo ""
echo "→ Checking PostgreSQL..."

if ! command -v psql &>/dev/null; then
  echo "  ERROR: psql not found. Install PostgreSQL first:" >&2
  echo "         brew install postgresql@17 && brew services start postgresql@17" >&2
  exit 1
fi

# Ensure the PostgreSQL server is running
if ! pg_isready -q; then
  echo "  PostgreSQL is not running. Starting via Homebrew services..."
  # Try common service names
  brew services start postgresql@17 2>/dev/null || \
  brew services start postgresql@16 2>/dev/null || \
  brew services start postgresql 2>/dev/null || true

  echo -n "  Waiting for PostgreSQL "
  for i in $(seq 1 15); do
    if pg_isready -q; then
      echo " OK"
      break
    fi
    echo -n "."
    sleep 1
    if [ "$i" -eq 15 ]; then
      echo ""
      echo "  ERROR: PostgreSQL did not start in time." >&2
      exit 1
    fi
  done
else
  echo "  PostgreSQL is running."
fi

# Create role brand_studio if it doesn't exist
echo "  Creating role 'brand_studio' (if missing)..."
psql -U "$(whoami)" -d postgres -tc \
  "SELECT 1 FROM pg_roles WHERE rolname = 'brand_studio'" \
  | grep -q 1 || \
  psql -U "$(whoami)" -d postgres -c \
  "CREATE ROLE brand_studio WITH LOGIN PASSWORD 'brand_studio';"

echo "  Role 'brand_studio': OK"

# Create database brand_studio if it doesn't exist
echo "  Creating database 'brand_studio' (if missing)..."
psql -U "$(whoami)" -d postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname = 'brand_studio'" \
  | grep -q 1 || \
  psql -U "$(whoami)" -d postgres -c \
  "CREATE DATABASE brand_studio OWNER brand_studio;"

echo "  Database 'brand_studio': OK"

# Grant privileges (in case DB existed but without proper ownership)
psql -U "$(whoami)" -d postgres -c \
  "GRANT ALL PRIVILEGES ON DATABASE brand_studio TO brand_studio;" &>/dev/null

# ── 3. Drizzle push ──────────────────────────────────────────────────────────

echo ""
echo "→ Running npm run db:push..."
npm run db:push

echo ""
echo "=== Setup complete ==="
echo "  Redis  → redis://localhost:6379"
echo "  Postgres → postgresql://brand_studio:***@localhost:5432/brand_studio"
echo ""
echo "Start the bot with:  npm run dev"
