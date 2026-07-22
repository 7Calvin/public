# EdgeGate - Development Progress

## Status: v1.5.2 (lançado) · v1.6.0 IPsec HA/Failover (na branch `feature/ipsec-failover`)

Sistema completo com OpenVPN (client-to-site) e StrongSwan IPsec (site-to-site, **swanctl/vici**).

---

## Changelog

### 2026-07-22 (v1.6.0 — IPsec HA/Failover · NA BRANCH `feature/ipsec-failover`, ainda não lançado)

> Detalhe completo em `docs/ipsec-ha-failover.md` §8–§12. Validado ao vivo (inclusive queda real de link pelo FortiGate). Aguardando merge na `main` + release.

#### Funcionalidades
- **Failover ativo/standby** — 2º endpoint do peer (`right_ip_backup`); `remote_addrs = primário, backup` (swanctl multi-homing). DPD rápido (~30-42s) via `dpd_delay=10s` + retransmit afinado.
- **Botões de ops** por conexão — Testar failover, Switch manual, Rollback.
- **Export de config do peer** — `⋮ → Baixar config`: FortiGate (script de CLI SD-WAN pronto, PSK real) ou Genérico (folha de parâmetros p/ pfSense/Endian/etc).
- **Ver config gerada** (👁) por conexão; **Excluir** com type-to-confirm; UI limpa com dropdown `⋮` e header enxuto.

#### Correções
- PSK cobrindo todos os ids do peer + cada IP em forma `1.2.3.4` **e** `@1.2.3.4` (FortiGate manda IP-id como string).
- `remote{}` sem `id` pinado; `PUT /connections` não retorna mais 500 (DetachedInstanceError); edit-form diff-based (não apaga Peer ID/backup); dashboard "2/3" → "1/1" (agrupa por conexão).

### 2026-07-21 (v1.5.0 / v1.5.1 / v1.5.2 — Migração para swanctl)
- **v1.5.0**: strongSwan migrado de legacy `ipsec.conf` para **swanctl/vici**; auto-migração no `update.sh` (host legacy migra sozinho ao atualizar); rollback abaixo de 1.5.0 negado.
- **v1.5.1**: `update.sh` conserta o bind-mount do traefik que derrubava no reboot.
- **v1.5.2**: backend aplica a config IPsec no startup (túneis auto-carregam após restart/migração). Prod `alphaquimica` migrada.

### 2026-02-05 (v1.2.1 - Melhorias IPsec + MFA Fix)

#### Funcionalidades
- **Múltiplas subnets por conexão IPsec** - Usa formato `also=` do StrongSwan
- **IPsec status no Dashboard** - Cards com túneis ativos e status
- **Cleanup IPsec no uninstall.sh** - Remove túneis e configs ao desinstalar
- **Let's Encrypt** - Detecta e reutiliza certificados existentes

#### Correções
- **MFA status inconsistente** - `mfa_enabled` agora retornado em todas as respostas de auth
- **SessionInfo** - Adicionado campo `mfa_required`

---

### 2026-02-05 (v1.2.0 - IPsec Site-to-Site VPN)

#### Funcionalidades Implementadas

**1. Backend - IPsec Service**
- Model `IPsecConnection` com todos os campos necessários
- Schemas Pydantic para validação
- `IPsecService` com comunicação via IPsec Agent
- Geração automática de `ipsec.conf` e `ipsec.secrets`
- Status parsing: detecta IKE SA e Child SA separadamente
- Campos novos: `tunnel_status`, `ike_status`, `has_child_sa`, `error_hint`

**2. Backend - IPsec Routes**
- CRUD completo: `/api/v1/ipsec/connections`
- Controle: `start`, `stop`, `restart` por conexão
- Status: `/status`, `/statusall`, `/logs`
- Config: `/apply`, `/config/preview`
- Server info: `/server-info` (auto-detect IPs)

**3. Frontend - IPsecPage**
- Tabela de conexões com status em tempo real
- Modal de criação/edição com validação
- Presets de ciphers separados para IKE e ESP
- Status badges: UP (verde), IKE_ONLY (amarelo), CONNECTING (azul), DOWN (cinza)
- Modal de Status (ipsec statusall)
- Modal de Logs com filtro por conexão
- Auto-refresh a cada 5 segundos

**4. IPsec Agent**
- Flask REST API rodando no host (systemd)
- Executa comandos `ipsec` com autenticação por token
- Endpoints: `/status`, `/up`, `/down`, `/reload`, `/logs`
- Escrita de configs: `/config/write`

**5. Instalação**
- `install.sh` instala StrongSwan automaticamente
- Cria e configura `ipsec-agent.service`
- Adiciona regras UFW para IPsec (UDP 500/4500)
- Adiciona regras UFW para routing entre subnets

#### Correções Importantes

**PSK Lookup Fix**
- Problema: `ipsec.secrets` usava `left_ip` em vez de `left_id`
- Solução: Alterado `to_ipsec_secret()` para usar `left_id`/`right_id`
- Gera PSK em ambas direções para compatibilidade

**Cipher Compatibility**
- Problema: ESP com `modp4096` causava "NO_PROPOSAL_CHOSEN"
- Solução: Default agora é `aes256-sha256` (sem PFS)
- IKE: `aes256-sha256-modp2048`

**Tunnel Status Detection**
- Problema: Mostrava "ESTABLISHED" mesmo sem Child SA
- Solução: Detecta IKE SA e Child SA separadamente
- `tunnel_status: UP` só quando Child SA está INSTALLED

---

### 2026-02-03 (Correções Críticas - Admin OVPN + Firewall)

#### Problemas Identificados
1. **Admin OVPN incompleto**: Download de .ovpn do admin vinha sem certificados
2. **Firewall permitia private networks**: Por default permitia acesso a redes privadas
3. **Allow Internal Communications**: Não usava as rotas configuradas

#### Soluções Implementadas
- Admin VPN Profile com certificados completos
- Quick rule "Block Private Networks" (10.x, 172.16.x, 192.168.x)
- Quick rule "Allow Internal Communications" usa push_routes

---

### 2026-01-30 (Release Inicial)
- Frontend React completo
- Backend FastAPI com 80+ endpoints
- OpenVPN integration
- Firewall + NAT
- Docker Compose deployment

---

## Estatísticas

| Categoria | Quantidade |
|-----------|------------|
| Endpoints API | 100+ |
| Modelos de Dados | 9 (incluindo IPsecConnection) |
| Páginas Frontend | 8 (incluindo IPsecPage) |
| Migrations | 3 |
| Services Backend | 6 (incluindo IPsecService) |

---

## Arquivos IPsec Criados/Modificados

```
backend/
├── app/api/v1/routes/ipsec.py    # 543 linhas - Rotas IPsec
├── app/models/ipsec.py           # 140 linhas - Model SQLAlchemy
├── app/schemas/ipsec.py          # 262 linhas - Schemas Pydantic
├── app/services/ipsec_service.py # 811 linhas - Lógica de negócio

frontend/src/
├── pages/IPsecPage.tsx           # 1323 linhas - Página completa
├── api/client.ts                 # +88 linhas - API client IPsec
├── types/index.ts                # +68 linhas - Types IPsec

docker/ipsec-agent/
├── app.py                        # 288 linhas - Flask API
├── install.sh                    # 155 linhas - Instalação
├── ipsec-agent.service           # 18 linhas - Systemd service
└── requirements.txt              # Dependencies

install.sh                        # +115 linhas - StrongSwan install
```

---

## Configuração IPsec

### Exemplo de Conexão
```
conn exemplo
    left="10.10.22.91"       # IP privado do servidor
    leftsubnet="10.10.0.0/16" # Subnet local
    leftid="3.95.183.228"     # IP público (usado no PSK)
    right="170.231.45.197"    # IP do peer remoto
    rightsubnet="10.7.0.0/16" # Subnet remota
    rightid="170.231.45.197"  # ID do peer (usado no PSK)
    ike=aes256-sha256-modp2048!
    esp=aes256-sha256!
    keyexchange=ikev2
    auto=start
```

### Requisitos no Peer Remoto
1. Configurar subnets espelhadas (left/right invertidos)
2. Mesmo PSK em ambos os lados
3. **Importante**: Adicionar exceção de NAT para tráfego IPsec:
   ```bash
   iptables -t nat -I POSTROUTING 1 -s <local_subnet> -d <remote_subnet> -j ACCEPT
   ```

---

## Próximas Ações

### Concluído
- [x] IPsec CRUD completo
- [x] Status em tempo real
- [x] Logs por conexão
- [x] Auto-detect IPs
- [x] Ciphers compatíveis
- [x] Documentação

### Pendente
- [ ] Suporte a certificados (além de PSK)
- [x] Múltiplas subnets por conexão (v1.2.1)
- [ ] Gráficos de tráfego IPsec
- [ ] Backup/restore de configuração IPsec

---

**Última atualização**: 2026-02-05 (v1.2.1)
