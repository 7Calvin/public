# Plano: Security Hardening + Claude Code Agents

## Contexto

O VPN Management System (FastAPI + React + Docker + OpenVPN + StrongSwan) possui **vulnerabilidades criticas de seguranca** identificadas: secrets hardcoded em config.py e docker-compose.yml, command injection em vpn_service.py e agents Flask, rate limiting nao implementado (placeholder), token blacklist inexistente no logout, endpoints OpenVPN sem autenticacao, CORS permissivo, e headers de seguranca ausentes. Este plano corrige todas essas vulnerabilidades e cria agents Claude Code uteis para o projeto.

---

## PARTE A: Security Hardening (Codigo)

### Fase 1: Remover Secrets Hardcoded + Validacao de Startup [P0]

**Arquivo: `backend/app/core/config.py`**
- Remover defaults inseguros de `SECRET_KEY`, `JWT_SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `NAT_AGENT_TOKEN`
- Centralizar `IPSEC_AGENT_TOKEN` e `IPSEC_AGENT_URL` no Settings (hoje estao como `os.environ.get()` direto no `ipsec_service.py`)
- Adicionar `OPENVPN_INTERNAL_SECRET` para proteger endpoints OpenVPN
- Adicionar `ALLOWED_HOSTS: list[str]`
- Adicionar `@model_validator(mode="after")` que **recusa boot** se `ENVIRONMENT != "development"` e secrets sao fracos/default
- Adicionar constante `WEAK_SECRETS` com todos os valores default conhecidos
- Adicionar configs: `MAX_LOGIN_ATTEMPTS=5`, `ACCOUNT_LOCKOUT_MINUTES=15`

**Arquivo: `docker-compose.yml`**
- Remover TODOS os fallbacks `:-changeme`, `:-Admin123!@#456`, `:-dev-secret-*` de variaveis de secrets
- Manter fallbacks apenas para valores nao-sensiveis (POSTGRES_DB, LOG_LEVEL, etc.)
- Linhas afetadas: ~16, 36, 43, 62, 65-67, 76, 79-81, 164-165

**Arquivo: `docker/ipsec-agent/app.py` (linha 16)**
- Remover default `'changeme-ipsec-token'` — crash se nao configurado

**Arquivo: `docker/nat-agent/app.py` (linha 24)**
- Remover default `'changeme-nat-token'` — crash se nao configurado

**Arquivo: `backend/app/services/ipsec_service.py` (linhas 23-24)**
- Usar `settings.IPSEC_AGENT_TOKEN` e `settings.IPSEC_AGENT_URL` em vez de `os.environ.get()` direto

**Arquivo: `backend/scripts/start.sh`**
- Remover fallback `:-changeme` na string de conexao pg
- Adicionar validacao Python antes do alembic: `python -c "from app.core.config import settings"`

**Arquivo: `.gitignore`**
- Descomentar a linha `#.env` para ignorar o .env
- Executar `git rm --cached .env` (o .env esta tracked e contem IPSEC_AGENT_TOKEN real)

---

### Fase 2: Corrigir Command Injection [P0]

**Arquivo: `backend/app/services/vpn_service.py` (~linha 682)**
- O metodo `disconnect_client` interpola `username` direto em shell: `f"echo 'kill {username}' | nc localhost 7505"`
- Fix: validar username com regex `^[a-zA-Z0-9._-]{1,50}$` + usar `shlex.quote()`

**Arquivo: `docker/ipsec-agent/app.py` (linhas 76-98)**
- `connection_name` de URL path vai direto para `subprocess.run(['ipsec', 'up', connection_name])`
- Fix: validar com regex `^[a-zA-Z0-9._-]{1,100}$` antes de cada rota

**Arquivo: `docker/nat-agent/app.py`**
- Adicionar validacao de IP (`ipaddress.ip_address`), porta (1-65535) e protocolo (tcp/udp) antes de chamar iptables

**Arquivo: `backend/app/services/firewall_service.py` (~linha 330)**
- `source_network` e `destination_network` interpolados em regras nftables
- Fix: validar com `ipaddress.ip_network()` no schema e no service

**Arquivo: `backend/app/schemas/firewall.py`**
- Adicionar `@field_validator` para `source_network`, `destination_network` usando `ipaddress.ip_network()`
- Adicionar validacao de port_range: regex `^(\d{1,5}(-\d{1,5})?,?)+$`

**Arquivo: `docker/openvpn/scripts/auth.sh` (linha 30)**
- Username/password interpolados em JSON via string bash — shell injection possivel
- Fix: usar `jq` para construcao segura do JSON (`jq -n --arg u "$USERNAME" ...`)
- Mesmo fix em `client-connect.sh` e `client-disconnect.sh`
- Adicionar `jq` ao `docker/openvpn/Dockerfile`

---

### Fase 3: Proteger Endpoints OpenVPN [P1]

**Arquivo: `backend/app/api/v1/routes/vpn.py` (~linhas 599, 637, 684)**
- Endpoints `/api/v1/vpn/auth`, `/connections/connect`, `/connections/disconnect` nao tem auth
- Fix: criar dependency `require_openvpn_secret` que valida header `X-OpenVPN-Secret`
- Adicionar como `dependencies=[Depends(require_openvpn_secret)]` nas 3 rotas

**Arquivo: `backend/app/dependencies/auth.py`**
- Criar funcao `require_openvpn_secret(request: Request)` que compara `X-OpenVPN-Secret` com `settings.OPENVPN_INTERNAL_SECRET`

**Arquivos: `docker/openvpn/scripts/auth.sh`, `client-connect.sh`, `client-disconnect.sh`**
- Garantir que todos enviam header `-H "X-OpenVPN-Secret: ${OPENVPN_SECRET}"` nos curls

---

### Fase 4: Implementar Rate Limiting com Redis [P1]

**Arquivo: `backend/app/dependencies/auth.py` (linhas 188-205)**
- Substituir placeholder `RateLimiter` por implementacao real com Redis sliding window
- Usar `redis.asyncio` (ja disponivel via `aioredis`)
- Key pattern: `rate_limit:{client_ip}:{path}`
- Retornar HTTP 429 com header `Retry-After`

**Aplicar nos endpoints:**
- `/auth/login` e `/auth/mfa/verify-login`: `rate_limit_auth` (5/min por IP)
- `/auth/password/change`, `/auth/mfa/*`: `rate_limit_strict` (10/min)
- Todos os outros: `rate_limit_default` (60/min)

---

### Fase 5: Account Lockout [P1]

**Arquivo: `backend/app/services/auth_service.py`**
- Adicionar metodos: `_check_lockout()`, `_record_failed_attempt()`, `_clear_failed_attempts()`
- Usar Redis com key `login_attempts:{username}` e TTL de `ACCOUNT_LOCKOUT_MINUTES`
- Integrar no fluxo `authenticate_user()`:
  - Antes de verificar senha: checar lockout
  - Falha: incrementar contador
  - Sucesso: limpar contador

---

### Fase 6: Token Blacklist no Logout [P1]

**Arquivo: `backend/app/core/security.py`**
- Adicionar `blacklist_token(token)`: salva no Redis com TTL = tempo restante do token
- Adicionar `is_token_blacklisted(token)`: consulta Redis

**Arquivo: `backend/app/api/v1/routes/auth.py` (logout, ~linha 102)**
- Extrair token do header Authorization e chamar `blacklist_token()`

**Arquivo: `backend/app/dependencies/auth.py`**
- Em `get_current_user()`: apos decode do JWT, verificar `is_token_blacklisted()`

---

### Fase 7: Security Headers + CORS [P2]

**Arquivo: `backend/app/main.py`**
- CORS: trocar `allow_methods=["*"]` por lista explicita `["GET","POST","PUT","PATCH","DELETE","OPTIONS"]`
- CORS: trocar `allow_headers=["*"]` por `["Authorization","Content-Type","X-OpenVPN-Secret","X-Api-Token"]`
- TrustedHost: trocar `allowed_hosts=["*"]` por `settings.ALLOWED_HOSTS`
- Adicionar middleware `add_security_headers` com: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (prod), `Content-Security-Policy` (prod)
- Desabilitar docs em producao: `docs_url=None`, `redoc_url=None`, `openapi_url=None` se `not DEBUG`

**Arquivo: `docker/nginx/conf.d/default.conf`**
- Adicionar `Strict-Transport-Security`, `Content-Security-Policy`, `Permissions-Policy`
- Adicionar `client_max_body_size 10m`

---

### Fase 8: Encriptar IPsec PSK em Repouso [P2]

**Novo arquivo: `backend/app/core/encryption.py`**
- Funcoes `encrypt_value()` e `decrypt_value()` usando Fernet (derivando chave do SECRET_KEY via SHA256)

**Arquivo: `backend/app/services/ipsec_service.py`**
- Encriptar PSK ao criar/atualizar conexao
- Decriptar ao gerar `ipsec.secrets`

---

## PARTE B: Claude Code Agents (7 agents)

Todos criados em `.claude/agents/`. O agent `security-reviewer.md` ja existe e sera mantido.

### 1. `security-hardening.md`
- **Proposito**: Encontrar e corrigir vulnerabilidades (OWASP Top 10, injection, secrets, auth bypass)
- **Tools**: Read, Grep, Glob, Bash
- **Foco**: config.py, security.py, services/*, dependencies/auth.py, docker agents, docker-compose.yml
- **Validacao**: Padroes regex para username, connection_name, IP, porta, network

### 2. `deploy-validator.md`
- **Proposito**: Validar se o deploy esta seguro antes de ir para producao
- **Tools**: Read, Grep, Glob, Bash
- **Checks**: .env completo, secrets fortes, .env fora do git, portas internas nao expostas, TLS ok, Docker seguro
- **Output**: Relatorio PASS/FAIL/WARN com status final READY/NOT READY

### 3. `api-tester.md`
- **Proposito**: Testar endpoints por auth bypass, injection, input validation, rate limiting, IDOR
- **Tools**: Read, Grep, Glob, Bash
- **Testes**: curl contra todos endpoints, payloads maliciosos, brute force, acesso cross-user

### 4. `docker-security.md`
- **Proposito**: Auditar Dockerfiles, compose, privilegios, rede, volumes
- **Tools**: Read, Grep, Glob, Bash
- **Checks**: non-root, imagens pinadas, portas, privileged, socket mount, resource limits

### 5. `code-quality.md`
- **Proposito**: Revisar qualidade de codigo, error handling, logging, async, tipos
- **Tools**: Read, Grep, Glob, Bash
- **Foco**: subprocess com timeout, async blocking calls, N+1 queries, secrets em logs

### 6. `backup-recovery.md`
- **Proposito**: Validar backups (DB, certificados, configs) e procedimentos de recovery
- **Tools**: Read, Grep, Glob, Bash
- **Checks**: pg_dump, PKI backup, volume backup, RTO/RPO estimado

### 7. `vpn-network-auditor.md`
- **Proposito**: Auditar configs OpenVPN, IPsec/StrongSwan, firewall, NAT
- **Tools**: Read, Grep, Glob, Bash
- **Checks**: cipher strength, TLS version, DH groups, default policy DROP, isolamento VPN

---

## PARTE C: Validacao de Startup

**Mecanismo integrado na Fase 1:**
1. `config.py` com `@model_validator` que recusa boot com secrets fracos em producao
2. `start.sh` valida config Python antes de rodar alembic/uvicorn
3. Agents Flask (nat-agent, ipsec-agent) crasham se token nao configurado

---

## Ordem de Implementacao

| # | Fase | Prioridade | Impacto |
|---|------|-----------|---------|
| 1 | Fase 1: Secrets + Startup Validation | P0 | Fundacional |
| 2 | Fase 2: Command Injection | P0 | Critico |
| 3 | Fase 3: Endpoints OpenVPN | P1 | Superficie de ataque |
| 4 | Fase 4: Rate Limiting | P1 | Brute force |
| 5 | Fase 5: Account Lockout | P1 | Complementa rate limit |
| 6 | Fase 6: Token Blacklist | P1 | Ciclo auth completo |
| 7 | Fase 7: Headers + CORS | P2 | Defense in depth |
| 8 | Fase 8: PSK Encryption | P2 | Dados em repouso |
| 9 | Agents Claude Code | Paralelo | Independente |

---

## Verificacao

Apos implementacao, validar:
1. `docker compose config --quiet` — YAML valido
2. Backend importa sem erro: `python -c "from app.core.config import settings"`
3. Backend recusa boot sem secrets em `ENVIRONMENT=production`
4. Endpoints OpenVPN retornam 403 sem header X-OpenVPN-Secret
5. Login com 6+ tentativas erradas retorna lockout
6. Logout invalida o token (retry da 401)
7. Headers de seguranca presentes nas respostas HTTP
8. `grep -rn "changeme\|change-me\|Admin123" backend/ docker-compose.yml` retorna zero
9. Agents Claude Code funcionam via `claude agents list`

---

## Arquivos Criticos

| Arquivo | Mudancas |
|---------|----------|
| `backend/app/core/config.py` | Remover defaults, adicionar validator, novos campos |
| `backend/app/main.py` | CORS, headers, TrustedHost, docs em prod |
| `backend/app/dependencies/auth.py` | Rate limiter real, token blacklist check, OpenVPN auth |
| `backend/app/services/auth_service.py` | Account lockout |
| `backend/app/services/vpn_service.py` | Fix command injection |
| `backend/app/services/firewall_service.py` | Validacao input |
| `backend/app/services/ipsec_service.py` | Usar settings, encriptar PSK |
| `backend/app/core/security.py` | Token blacklist functions |
| `backend/app/core/encryption.py` | **Novo** — Fernet encrypt/decrypt |
| `backend/app/schemas/firewall.py` | Validators network/port |
| `backend/app/api/v1/routes/auth.py` | Logout com blacklist |
| `backend/app/api/v1/routes/vpn.py` | Proteger endpoints OpenVPN |
| `backend/scripts/start.sh` | Validacao pre-boot |
| `docker-compose.yml` | Remover fallbacks de secrets |
| `docker/ipsec-agent/app.py` | Validacao input, sem default token |
| `docker/nat-agent/app.py` | Validacao input, sem default token |
| `docker/openvpn/scripts/auth.sh` | jq para JSON seguro |
| `docker/openvpn/scripts/client-connect.sh` | jq para JSON seguro |
| `docker/openvpn/scripts/client-disconnect.sh` | jq para JSON seguro |
| `docker/openvpn/Dockerfile` | Instalar jq |
| `docker/nginx/conf.d/default.conf` | Headers seguranca |
| `.gitignore` | Descomentar .env |
| `.claude/agents/*.md` | 7 novos agents |
