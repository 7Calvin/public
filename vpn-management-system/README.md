# VPN Management System

Sistema completo de gerenciamento OpenVPN com interface web moderna, controle granular de firewall, port forwarding (DNAT) e suporte para usuários humanos e service accounts.

---

## Funcionalidades

### Gerenciamento de Usuários

| Feature | Descrição |
|---------|-----------|
| **Usuários Humanos** | Contas para pessoas com suporte a MFA opcional |
| **Service Accounts** | Contas para servidores/VMs com autenticação automática |
| **Criação com VPN Profile** | Ao criar usuário, o perfil VPN é gerado automaticamente |
| **Reset de Senha** | Admin pode resetar senha com modal de cópia |
| **Proteção Self-Service** | Admin não pode deletar ou desabilitar a si mesmo |
| **Status Toggle** | Ativar/desativar usuários com um clique |
| **Delete com Confirmação** | Modal que exige digitar o username para confirmar |

### OpenVPN

| Feature | Descrição |
|---------|-----------|
| **Perfil VPN Automático** | Criado junto com o usuário |
| **Download .ovpn** | Todos os usuários podem baixar sua configuração |
| **Certificados X.509** | Geração automática via EasyRSA |
| **IP Fixo por Usuário** | Cada usuário recebe um IP dedicado na VPN |
| **Regenerar Certificado** | Admin pode regenerar certificados comprometidos |
| **Revogação** | Revogar acesso instantaneamente |
| **Configuração do Servidor** | Admin configura host, porta, protocolo, DNS, rotas |

### Firewall

| Feature | Descrição |
|---------|-----------|
| **Quick Rules** | Toggles rápidos para regras comuns (Block Client-to-Client, Allow Internal) |
| **Regras Customizadas** | Modal para criar regras com protocolo, portas, IPs |
| **Drag-and-Drop** | Reordenar prioridade das regras arrastando |
| **Status Toggle** | Habilitar/desabilitar regras individuais |
| **Engine iptables** | Regras NAT aplicadas via NAT agent privilegiado |
| **Status em Tempo Real** | Mostra se firewall está Active/Inactive |
| **Regras Padrão** | Criadas automaticamente no startup (ICMP, DNS, HTTP/HTTPS) |

### Port Forwarding (DNAT)

| Feature | Descrição |
|---------|-----------|
| **Wizard Intuitivo** | Interface guiada para criar redirecionamentos |
| **Service Presets** | HTTP, HTTPS, SSH, RDP, MySQL, PostgreSQL, etc. |
| **Auto Firewall Rule** | Cria regra de firewall correspondente automaticamente |
| **Protocolo Flexível** | TCP, UDP ou ambos |
| **NAT Agent** | Aplica regras iptables DNAT/MASQUERADE no host via container privilegiado |
| **Source Filter** | Opcional: restringir acesso por rede de origem |

### IPsec Site-to-Site VPN (StrongSwan)

| Feature | Descrição |
|---------|-----------|
| **Gerenciamento Completo** | Criar, editar, remover conexões IPsec via UI |
| **Status em Tempo Real** | Mostra IKE SA + Child SA separadamente |
| **Detecção de Túnel** | UP, DOWN, IKE_ONLY (Phase 2 falhou), CONNECTING |
| **Logs por Conexão** | Filtrar logs por túnel específico |
| **Auto-detect IPs** | Detecta IP público/privado automaticamente (AWS IMDSv2) |
| **Ciphers Compatíveis** | IKE: aes256-sha256-modp2048, ESP: aes256-sha256 |
| **PSK Authentication** | Pre-shared key com geração de ipsec.secrets |
| **IKEv1/IKEv2** | Suporte a ambas versões |
| **DPD (Dead Peer Detection)** | Restart, Clear, Hold, None |
| **IPsec Agent** | Serviço no host para executar comandos ipsec |

### Monitoramento

| Feature | Descrição |
|---------|-----------|
| **Conexões em Tempo Real** | Dashboard com conexões ativas |
| **Estatísticas de Tráfego** | Bytes enviados/recebidos por usuário |
| **Histórico de Conexões** | Log completo de conexões |
| **Desconexão Forçada** | Admin pode desconectar usuários |

### Segurança

| Feature | Descrição |
|---------|-----------|
| **JWT + Refresh Tokens** | Autenticação stateless moderna |
| **MFA/2FA Opcional** | Google Authenticator, Authy (controlado por admin) |
| **API Keys** | Para service accounts |
| **Audit Logs** | Trilha de auditoria completa |
| **TLS 1.3** | Criptografia moderna |

---

## Arquitetura

### Ambiente Homologado
- **Plataforma**: AWS EC2
- **Sistema Operacional**: Ubuntu 24.04 LTS
- **Rede**: Single NIC em subnet pública
- **NAT**: Para subnet privada dentro da mesma VPC

```
┌─────────────────────────────────────────────────────────────┐
│                    INTERNET (Rede Pública)                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────────┐
                │   AWS VPC (e.g. 10.0.0.0/16)
                │                           │
                │   ┌───────────────────────┼───────────┐
                │   │  Subnet Pública       │           │
                │   │  (10.0.1.0/24)        │           │
                │   │                       │           │
                │   │  ┌─────────────────┐  │           │
                │   │  │  EC2 Instance   │  │           │
                │   │  │  (Single NIC)   │  │           │
                │   │  │  IP: 10.0.1.50  │  │           │
                │   │  │  Public IP      │  │           │
                │   │  │                 │  │           │
                │   │  │ ┌─────────────┐ │  │           │
                │   │  │ │ Nginx       │ │  │ ← HTTPS :443
                │   │  │ │ Frontend    │ │  │
                │   │  │ │ Backend     │ │  │ ← API :8000
                │   │  │ │ PostgreSQL  │ │  │
                │   │  │ │ Redis       │ │  │
                │   │  │ │ OpenVPN     │ │  │ ← VPN :1194/udp
                │   │  │ │ NAT Agent   │ │  │ ← NAT :8100
                │   │  │ └─────────────┘ │  │
                │   │  │                 │  │
                │   │  │ iptables NAT    │  │ ← Port Forwarding
                │   │  └────────┬────────┘  │
                │   └───────────┼───────────┘
                │               │
                │   ┌───────────▼───────────┐
                │   │  Subnet Privada       │
                │   │  (10.0.2.0/24)        │
                │   │                       │
                │   │  ┌───────────────┐    │
                │   │  │ EC2 Web       │    │
                │   │  │ 10.0.2.10:80  │    │ ← DNAT 8080->80
                │   │  └───────────────┘    │
                │   │                       │
                │   │  ┌───────────────┐    │
                │   │  │ RDS Database  │    │
                │   │  │ 10.0.2.20     │    │ ← VPN Access
                │   │  └───────────────┘    │
                │   └───────────────────────┘
                └───────────────────────────┘

VPN Clients (10.8.0.0/24) → OpenVPN Server → NAT → Private Subnet
```

### Componentes Docker

| Serviço | Descrição | Porta |
|---------|-----------|-------|
| **nginx** | Reverse proxy + SSL | 80, 443 |
| **frontend** | React App | - |
| **backend** | FastAPI | 8000 |
| **postgres** | Banco de dados | 5432 |
| **redis** | Cache + Sessions | 6379 |
| **openvpn** | Servidor VPN | 1194/udp |
| **nat-agent** | Aplica regras iptables NAT no host | 8100 |

### Serviços no Host (systemd)

| Serviço | Descrição | Porta |
|---------|-----------|-------|
| **strongswan** | IPsec VPN (StrongSwan) | 500/udp, 4500/udp |
| **ipsec-agent** | API para controle do StrongSwan | 8101 |

---

## Stack Tecnológico

### Backend
- **Python 3.11+** com **FastAPI**
- **PostgreSQL 17** - Banco de dados principal
- **SQLAlchemy 2.0** - ORM async
- **Alembic** - Migrations
- **Redis 7** - Cache e sessions
- **Pydantic v2** - Validação de dados
- **PyOTP** - Autenticação 2FA

### Frontend
- **React 18** com **TypeScript**
- **Vite** - Build tool
- **TailwindCSS** - Estilos
- **shadcn/ui** - Componentes UI
- **TanStack Query** - Data fetching
- **Zustand** - Estado global
- **React Router DOM** - Navegação

### Infraestrutura
- **Docker** + **Docker Compose**
- **Nginx** - Reverse proxy
- **OpenVPN 2.6+** - Servidor VPN (client-to-site)
- **StrongSwan 5.9+** - IPsec VPN (site-to-site)
- **iptables** - Firewall e NAT (com NAT agent privilegiado)
- **Certbot** - SSL Let's Encrypt
- **AWS EC2** - Ubuntu 24.04 LTS (homologado)

---

## Instalação

### Instalação em uma linha

Em um **Ubuntu 24.04** limpo. Escolha um dos dois modos:

**1) Instalação guiada (interativa) — recomendada**

Baixa e roda o instalador com o assistente (whiptail). Use a forma *baixar-e-rodar*
(o `curl | bash` puro deixa o stdin ocupado pelo pipe e o menu não funciona direito):

```bash
curl -fsSL https://raw.githubusercontent.com/7Calvin/public/main/vpn-management-system/bootstrap.sh -o vpn-install.sh
sudo bash vpn-install.sh
```

**2) Instalação desatendida (sem perguntas) — one-liner puro**

Faz tudo com defaults sensatos (banco local, senha admin gerada, SSL self-signed);
você só informa o domínio:

```bash
curl -fsSL https://raw.githubusercontent.com/7Calvin/public/main/vpn-management-system/bootstrap.sh \
  | sudo NONINTERACTIVE=1 DOMAIN=vpn.exemplo.com bash
```

Opções extras para o modo desatendido (todas via variáveis de ambiente):

| Variável | Default | Descrição |
|---|---|---|
| `DOMAIN` | *(obrigatório)* | Domínio/host do painel |
| `DB_TYPE` | `local` | `local` (Postgres no compose) ou `external` |
| `ADMIN_PW_MODE` | `generate` | `generate` (senha aleatória, mostrada no fim) ou defina `ADMIN_PASSWORD` |
| `VPN_NETWORK` / `VPN_PORT` | `10.8.0.0` / `1194` | Rede/porta do OpenVPN |
| `NAT_GATEWAY_NETWORK` | *(vazio)* | CIDR de uma subnet que usa este host como gateway NAT (opcional) |
| `USE_LETSENCRYPT` | `false` | `true` para Let's Encrypt (requer `ACME_EMAIL` e portas 80/443 públicas) |
| `INSTALL_ACTION` | `upgrade` (se já instalado) | Numa máquina já instalada, o padrão é **upgrade** (preserva dados/certs). Passe `INSTALL_ACTION=fresh` para reinstalar do zero (**apaga volumes**). |
| `VPN_REPO_REF` | `main` | Fixa uma versão específica, ex.: `v1.1.4` |

> Segurança: o comando executa um script remoto como root. Para auditar antes,
> baixe e leia o `bootstrap.sh` (opção 1 já faz isso).

O bootstrap clona o repositório em `/opt/vpn-management-src` e chama o `install.sh`.

### Pré-requisitos

- **Ubuntu 24.04 LTS** (homologado e testado)
- **AWS EC2** ou servidor similar com:
  - Single NIC em subnet pública
  - IP Público (Elastic IP recomendado)
  - **IMPORTANTE**: Source/Dest Check **desabilitado** (para NAT funcionar)
  - Security Group permitindo:
    - `80/tcp` - HTTP (redirect para HTTPS)
    - `443/tcp` - HTTPS (web interface)
    - `1194/udp` - OpenVPN
    - `8100/tcp` - NAT agent (apenas localhost, não expor publicamente)
- **Docker** e **Docker Compose**
- **Git**
- **Domínio** configurado apontando para o IP público (para SSL)

#### AWS EC2 - Configuração de Rede

Para que o NAT funcione corretamente, você DEVE:

1. **Desabilitar Source/Dest Check** na EC2:
   ```bash
   # Via AWS CLI
   aws ec2 modify-instance-attribute \
     --instance-id i-xxxxxxxxx \
     --no-source-dest-check

   # Ou via console: EC2 > Actions > Networking > Change Source/Dest Check
   ```

2. **Adicionar rota na Route Table** da subnet privada:
   ```
   Destination: 10.8.0.0/24 (rede VPN)
   Target: eni-xxxxxxxxx (ENI da EC2 VPN)
   ```

3. **Security Group da EC2 VPN**:
   - Inbound: 80, 443, 1194/udp de 0.0.0.0/0
   - Outbound: All traffic (para alcançar subnet privada)

4. **Security Groups da subnet privada**:
   - Permitir tráfego da rede VPN (10.8.0.0/24) nas portas desejadas

### Quick Start

```bash
# Clone o repositório
git clone <repo-url>
cd vpn-management-system

# Configure variáveis de ambiente
cp .env.example .env
nano .env  # Edite as configurações

# Inicie os containers
docker-compose up -d

# Verifique os logs
docker-compose logs -f backend

# Acesse
# http://localhost (desenvolvimento)
# https://seu-dominio.com (produção)
```

### Variáveis de Ambiente Importantes

```env
# Admin inicial
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=SuaSenhaForte123!
INITIAL_ADMIN_EMAIL=admin@example.com

# Banco de dados
POSTGRES_USER=vpn_admin
POSTGRES_PASSWORD=senha_segura
POSTGRES_DB=vpn_management

# JWT
JWT_SECRET_KEY=sua_chave_secreta_muito_longa

# OpenVPN
OPENVPN_HOST=vpn.seudominio.com
OPENVPN_PORT=1194
OPENVPN_NETWORK=10.8.0.0
OPENVPN_NETMASK=255.255.255.0
```

### Instalação em Produção

```bash
# Clone o repositório
git clone https://github.com/7Calvin/vpn-management-system.git
cd vpn-management-system

# Execute o instalador interativo
sudo ./install.sh
```

O instalador:
- **Detecta automaticamente** se é instalação fresh ou upgrade
- **Instalação fresh**: Pergunta domínio, credenciais, configurações
- **Upgrade**: Preserva configurações, faz backup, atualiza código

#### Instalação Fresh
O script pergunta:
- Nome de domínio
- Banco local ou externo
- Credenciais de admin
- Configurações de VPN (rede, porta, DNS)
- SSL (Let's Encrypt ou self-signed)

#### Upgrade (após instalação)
```bash
cd /opt/vpn-management  # ou onde está sua instalação
git pull origin main
sudo ./install.sh

# Vai perguntar:
# [I] Install fresh ou [U] Upgrade
# Escolha U para upgrade
```

Veja [docs/UPGRADE.md](docs/UPGRADE.md) para detalhes sobre o processo de upgrade.

---

## Uso

### Primeiro Acesso

1. Acesse `https://seu-dominio.com`
2. Login com credenciais do admin
3. O admin já possui perfil VPN criado automaticamente

### Criar Usuários

1. Vá em **Users** > **Add User**
2. Escolha o tipo:
   - **Human User**: Para pessoas (suporta MFA)
   - **Service Account**: Para servidores (sem MFA)
3. Preencha username, senha e descrição
4. O perfil VPN é criado automaticamente

### Download do .ovpn

1. Usuário faz login
2. Acessa **OpenVPN** no menu
3. Clica em **Download .ovpn**
4. Importa no cliente OpenVPN

### Configurar Firewall

1. Acesse **Firewall**
2. Use **Quick Rules** para regras comuns:
   - Block Client-to-Client
   - Allow Internal Network
3. Ou clique em **Add Rule** para regras customizadas
4. Arraste para reordenar prioridades
5. Mudanças são aplicadas automaticamente

### Port Forwarding (DNAT)

1. Acesse **Firewall** > **Port Forwarding Rules**
2. Clique em **Add Forwarding**
3. Selecione um preset ou configure manualmente:
   - Porta externa (ex: 8080)
   - IP interno (ex: 10.0.0.50)
   - Porta interna (ex: 80)
4. A regra de firewall é criada automaticamente

---

## API

A API completa está documentada em `/docs` (Swagger) ou `/redoc`.

### Principais Endpoints

#### Autenticação
```
POST /api/v1/auth/login          # Login
POST /api/v1/auth/refresh        # Refresh token
POST /api/v1/auth/mfa/setup      # Configurar MFA
```

#### Usuários (Admin)
```
GET  /api/v1/users               # Listar usuários
POST /api/v1/users               # Criar usuário (+ VPN profile)
DELETE /api/v1/users/{id}        # Deletar usuário
POST /api/v1/users/{id}/reset-password  # Reset senha
```

#### VPN
```
GET  /api/v1/vpn/profile         # Meu perfil VPN
GET  /api/v1/vpn/config          # Download .ovpn
GET  /api/v1/vpn/profiles        # Listar todos (admin)
```

#### Firewall (Admin)
```
GET  /api/v1/firewall/rules      # Listar regras
POST /api/v1/firewall/rules      # Criar regra
PUT  /api/v1/firewall/rules/reorder  # Reordenar
POST /api/v1/firewall/apply      # Aplicar ao nftables
GET  /api/v1/firewall/nat        # Listar NAT rules
POST /api/v1/firewall/nat        # Criar port forwarding
```

#### Conexões (Admin)
```
GET  /api/v1/connections/active  # Conexões ativas
POST /api/v1/connections/{id}/disconnect  # Desconectar
GET  /api/v1/connections/stats/bandwidth  # Estatísticas
```

#### IPsec Site-to-Site (Admin)
```
GET  /api/v1/ipsec/connections           # Listar conexões
POST /api/v1/ipsec/connections           # Criar conexão
GET  /api/v1/ipsec/connections/{id}      # Obter conexão
PUT  /api/v1/ipsec/connections/{id}      # Atualizar conexão
DELETE /api/v1/ipsec/connections/{id}    # Remover conexão
POST /api/v1/ipsec/connections/{id}/start   # Iniciar túnel
POST /api/v1/ipsec/connections/{id}/stop    # Parar túnel
GET  /api/v1/ipsec/status                # Status global (IKE + Child SAs)
GET  /api/v1/ipsec/statusall             # Output detalhado do ipsec statusall
GET  /api/v1/ipsec/logs                  # Logs do StrongSwan
POST /api/v1/ipsec/apply                 # Aplicar configuração
GET  /api/v1/ipsec/config/preview        # Preview de ipsec.conf/secrets
GET  /api/v1/ipsec/server-info           # Auto-detect IPs do servidor
```

---

## Estrutura do Projeto

```
vpn-management-system/
├── backend/
│   ├── app/
│   │   ├── api/v1/routes/      # Endpoints da API
│   │   │   ├── auth.py         # Autenticação
│   │   │   ├── users.py        # Usuários
│   │   │   ├── vpn.py          # VPN profiles (OpenVPN)
│   │   │   ├── ipsec.py        # IPsec site-to-site
│   │   │   ├── firewall.py     # Firewall + NAT
│   │   │   ├── connections.py  # Conexões
│   │   │   └── admin.py        # Administração
│   │   ├── core/
│   │   │   ├── config.py       # Configurações
│   │   │   └── security.py     # JWT, hash, MFA
│   │   ├── models/             # SQLAlchemy models
│   │   │   ├── ipsec.py        # IPsecConnection model
│   │   │   └── ...
│   │   ├── schemas/            # Pydantic schemas
│   │   ├── services/           # Lógica de negócio
│   │   │   ├── ipsec_service.py # Gerenciamento StrongSwan
│   │   │   └── ...
│   │   └── db/                 # Database
│   ├── alembic/                # Migrations
│   └── scripts/                # Scripts auxiliares
│
├── frontend/
│   └── src/
│       ├── pages/              # Páginas React
│       │   ├── LoginPage.tsx
│       │   ├── DashboardPage.tsx
│       │   ├── UsersPage.tsx
│       │   ├── VPNPage.tsx
│       │   ├── IPsecPage.tsx   # Gerenciamento IPsec
│       │   ├── FirewallPage.tsx
│       │   ├── ConnectionsPage.tsx
│       │   └── SettingsPage.tsx
│       ├── components/         # Componentes
│       ├── api/                # Cliente API
│       ├── stores/             # Zustand stores
│       └── types/              # TypeScript types
│
├── docker/
│   ├── openvpn/               # Config OpenVPN
│   ├── ipsec-agent/           # IPsec Agent (StrongSwan control)
│   └── nginx/                 # Config Nginx
│
├── docker-compose.yml
├── install.sh                 # Instalação interativa (inclui StrongSwan)
└── scripts/vpnctl             # CLI de gerenciamento
```

---

## Comandos Úteis

```bash
# Gerenciamento Docker
docker-compose up -d              # Iniciar
docker-compose down               # Parar
docker-compose logs -f backend    # Logs do backend
docker-compose restart backend    # Reiniciar backend

# Database
docker-compose exec backend alembic upgrade head     # Migrations
docker-compose exec postgres psql -U vpn_admin vpn_management  # SQL

# Backup
./scripts/vpnctl backup           # Criar backup
./scripts/vpnctl restore <file>   # Restaurar backup

# Logs
./scripts/vpnctl logs             # Ver logs
./scripts/vpnctl status           # Status dos serviços
```

---

## Testes — Smoke Test

O `scripts/smoke_test.py` valida os fluxos principais da API **de ponta a ponta**
antes/depois de um deploy: login, troca de senha, ativar/desativar MFA, CRUD de
usuário, conexão IPsec, rota de proxy e regra de firewall, e round-trip de
configuração. Tudo que ele cria é prefixado com `smoketest` e **removido no final**
(mesmo se algum passo falhar). Serve como checklist rápido de "está tudo funcional?".

### Como rodar

Roda **dentro do container do backend** — ele gera um token de admin pela própria
app, então funciona mesmo com admin exigindo MFA:

```bash
# no servidor (via SSH)
docker exec -w /app vpn-backend python /app/scripts/smoke_test.py
```

Ou apontando para qualquer base URL com um token JWT já pronto:

```bash
SMOKE_BASE=https://seu-dominio.com/api/v1 SMOKE_TOKEN=<jwt> \
  python scripts/smoke_test.py
```

**Saída:** cada passo imprime `PASS`/`FAIL`; exit code `0` = tudo passou, `1` =
algo falhou. Uma execução típica cobre ~32 checagens.

### Verificar a auditoria depois

Como o smoke test exerce criações e remoções reais (e depois limpa), ele é ótimo
para conferir a **trilha de auditoria**: rode-o e abra **Auditoria** no painel —
você verá entradas como `Usuário criado: smoketest_1234 (usuário)`,
`Conexão IPsec criada: smoketest-...` e as respectivas remoções, atribuídas ao
admin. (Os nomes nos rótulos exigem backend ≥ 1.2.3.)

> Nota: o smoke test autentica gerando o token direto pela app (não via
> `/auth/login`), então ele **não** gera um evento "Login no painel" — só as ações
> de CRUD/config.

---

## Releases & Deploy

O deploy é feito pelo **update-agent** (roda no host), que faz `git pull` da
**última tag** e roda o `update.sh` (builda antes de trocar, health-check e
rollback automático, preservando certificados/PKI). Ou seja: para publicar uma
nova versão, basta **criar uma tag** e disparar a atualização pelo painel.

### 1. Cortar uma release (bump + commit + tag + push)

Um único comando cuida de tudo — inclusive empurrar a **tag** junto (sem isso o
painel não enxerga a atualização):

```powershell
# Windows / PowerShell
.\scripts\release.ps1 patch      # 1.2.0 -> 1.2.1
.\scripts\release.ps1 minor      # 1.2.0 -> 1.3.0
.\scripts\release.ps1 major      # 1.2.0 -> 2.0.0
.\scripts\release.ps1 1.4.0      # versão explícita
.\scripts\release.ps1 patch -DryRun   # simula, não altera nada
```

```bash
# Linux / macOS / git-bash
./scripts/release.sh patch|minor|major|X.Y.Z
DRY_RUN=1 ./scripts/release.sh patch  # simula
```

O script: valida (branch `main`, working tree limpo, tag inédita), escreve o
`VERSION`, commita `chore: release vX.Y.Z`, cria a tag anotada e faz
`git push origin main <tag>`.

> Semver: correções → `patch`; features novas → `minor`; mudanças grandes /
> rebrand → `major`.

### 2. Deployar

Painel → **Configurações → Sistema** → **verificar atualizações** → a nova
versão aparece → **atualizar**. O update-agent builda e troca com health-check.

---

## Segurança

- Nunca commite o arquivo `.env`
- Use senhas fortes (mínimo 12 caracteres)
- Ative MFA para admins
- Faça backup das chaves CA regularmente
- Rotacione API keys periodicamente
- Mantenha logs de auditoria
- Atualize dependências regularmente
- Use HTTPS em produção

---

## Troubleshooting

### Backend não inicia
```bash
docker-compose logs backend
# Verifique conexão com postgres e redis
```

### Usuário não consegue baixar .ovpn
- Verifique se o perfil VPN foi criado
- Verifique se o perfil não está revogado
- Verifique logs do backend

### Regras de firewall não aplicam
```bash
docker-compose exec backend python -c "from app.services.firewall_service import FirewallService; print('OK')"
# Verifique se nftables está instalado no container
```

### VPN não conecta
- Verifique se a porta 1194/udp está liberada
- Verifique credenciais no cliente
- Verifique logs do OpenVPN: `docker-compose logs openvpn`

---

## Licença

MIT License

---

## Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Add nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

---

## Changelog

### v1.2.0 (2026-02-05)
- ✅ **IPsec Site-to-Site VPN** - Gerenciamento completo via StrongSwan
  - CRUD de conexões IPsec com validação
  - Status em tempo real (IKE SA + Child SA)
  - Detecção de túnel: UP, DOWN, IKE_ONLY, CONNECTING
  - Logs filtrados por conexão
  - Auto-detect de IPs (AWS IMDSv2)
  - IPsec Agent para controle do StrongSwan
- ✅ Ciphers compatíveis por padrão (ESP sem PFS)
- ✅ Instalação automática do StrongSwan via install.sh
- ✅ UFW rules para IPsec (UDP 500/4500) e routing

### v1.1.0 (2026-02-03)
- ✅ Fix firewall status detection (NAT agent /status endpoint)
- ✅ Sistema de upgrade automático via install.sh
- ✅ Documentação completa de upgrade (UPGRADE.md)
- ✅ Suporte a single NIC + NAT para subnet privada
- ✅ Homologado em AWS EC2 Ubuntu 24.04 LTS

### v1.0.0 (2026-01-30)
- 🎉 Release inicial

---

**Versão**: 1.2.0
**Última atualização**: 2026-02-05
