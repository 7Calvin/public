import { useQuery, useQueryClient } from '@tanstack/react-query'
import { connectionsApi, usersApi, vpnApi, ipsecApi, proxyApi } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PageHeader, StatTile } from '@/components/PageHeader'
import { useSystemStatus } from '@/hooks/useSystemStatus'
import { ThroughputChart } from '@/components/ThroughputChart'
import { formatBytes, formatCertificateExpiry } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/tz'
import { Server as ServerIcon } from 'lucide-react'
import { Activity, Shield, ArrowUpDown, Download, Calendar, Lock, ArrowUp, ArrowDown, RefreshCw, Users } from 'lucide-react'

export default function DashboardPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.is_admin
  const queryClient = useQueryClient()
  const { info: sysInfo, update } = useSystemStatus()

  const { data: mgmtDomain } = useQuery({
    queryKey: ['management-domain'],
    queryFn: () => proxyApi.getManagementDomain().then((r) => r.data),
    enabled: isAdmin,
  })
  const { data: certInfo } = useQuery({
    queryKey: ['management-cert', mgmtDomain?.domain],
    queryFn: () => proxyApi.certificateDetails(mgmtDomain.domain).then((r: any) => r.data).catch(() => null),
    enabled: !!(isAdmin && mgmtDomain?.domain),
  })

  const { data: stats } = useQuery({ queryKey: ['connection-stats'], queryFn: () => connectionsApi.stats().then((r) => r.data), refetchInterval: 30000, enabled: isAdmin })
  const { data: userStats } = useQuery({ queryKey: ['user-stats'], queryFn: () => usersApi.stats().then((r) => r.data), enabled: isAdmin })
  const { data: vpnStatus } = useQuery({ queryKey: ['vpn-status'], queryFn: () => vpnApi.serverStatus().then((r) => r.data), refetchInterval: 30000, enabled: isAdmin })
  const { data: ipsecStatus } = useQuery({ queryKey: ['ipsec-status'], queryFn: () => ipsecApi.status().then((r) => r.data), refetchInterval: 15000, enabled: isAdmin })
  const { data: throughput } = useQuery({ queryKey: ['throughput'], queryFn: () => connectionsApi.throughput('24h').then((r) => r.data), refetchInterval: 60000, enabled: isAdmin })

  const { data: myProfile } = useQuery({ queryKey: ['my-vpn-profile'], queryFn: () => vpnApi.getProfile().then((r) => r.data).catch(() => null), enabled: !isAdmin })
  const { data: myStats } = useQuery({ queryKey: ['my-connection-stats'], queryFn: () => connectionsApi.myStats().then((r) => r.data).catch(() => null), enabled: !isAdmin })
  const { data: myActiveConnection } = useQuery({ queryKey: ['my-active-connection'], queryFn: () => connectionsApi.myActive().then((r) => r.data).catch(() => null), refetchInterval: 30000, enabled: !isAdmin })

  const refreshAll = () => queryClient.invalidateQueries()

  if (isAdmin) {
    const online = vpnStatus?.is_running
    return (
      <div className="space-y-6">
        <PageHeader
          title="Centro de Operações"
          subtitle="Visão geral do sistema"
          actions={
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
            </Button>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Sessões" value={stats?.active_connections ?? 0} sub={`${stats?.total_connections ?? 0} hoje`} icon={<Activity className="h-4 w-4" />} />
          <StatTile
            label="OpenVPN"
            value={online ? 'Online' : 'Offline'}
            valueClassName={online ? 'text-success' : 'text-destructive'}
            sub={`${vpnStatus?.connected_clients ?? 0} clientes`}
            icon={<Shield className="h-4 w-4" />}
          />
          <StatTile label="Saída" value={formatBytes(stats?.total_bytes_sent || 0)} sub="hoje" icon={<ArrowUp className="h-4 w-4" />} />
          <StatTile label="Entrada" value={formatBytes(stats?.total_bytes_received || 0)} sub="hoje" icon={<ArrowDown className="h-4 w-4" />} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Usuários" value={userStats?.total_users ?? 0} sub={`${userStats?.active_users ?? 0} ativos`} icon={<Users className="h-4 w-4" />} />
          <StatTile
            label="IPsec"
            value={`${ipsecStatus?.active_tunnels ?? 0} / ${ipsecStatus?.total_connections ?? 0}`}
            valueClassName={ipsecStatus?.active_tunnels > 0 ? 'text-success' : ''}
            sub={ipsecStatus?.strongswan_running ? 'StrongSwan ativo' : 'StrongSwan parado'}
            icon={<Lock className="h-4 w-4" />}
          />
          <StatTile label="Enviado (total)" value={formatBytes(vpnStatus?.total_bytes_out || 0)} sub="OpenVPN" icon={<ArrowUp className="h-4 w-4" />} />
          <StatTile label="Recebido (total)" value={formatBytes(vpnStatus?.total_bytes_in || 0)} sub="OpenVPN" icon={<ArrowDown className="h-4 w-4" />} />
        </div>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2"><ArrowUpDown className="h-5 w-5 text-primary" /> Throughput · últimas 24h</CardTitle>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-1 w-4 rounded-full" style={{ background: 'hsl(188 84% 53%)' }} /> saída</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1 w-4 rounded-full" style={{ background: 'hsl(255 100% 68%)' }} /> entrada</span>
            </div>
          </CardHeader>
          <CardContent>
            <ThroughputChart points={throughput?.points ?? []} />
          </CardContent>
        </Card>

        {sysInfo && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2"><ServerIcon className="h-5 w-5 text-primary" /> Servidor</CardTitle>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success eg-pulse" /> Online
                </span>
                {sysInfo.version && <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">v{sysInfo.version}</span>}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Hostname" value={sysInfo.hostname || '—'} mono />
                <Field label="Sistema" value={sysInfo.os || '—'} />
                <Field label="IP privado" value={sysInfo.private_ip || '—'} mono />
                <Field label="IP público" value={sysInfo.public_ip || '—'} mono />
                <Field
                  label="Certificado"
                  value={certInfo ? (
                    <span className={certInfo.status === 'valid' ? 'text-success' : certInfo.status === 'expiring' ? 'text-warning' : 'text-destructive'}>
                      {certInfo.status === 'valid' ? 'Válido' : certInfo.status === 'expiring' ? 'Expirando' : 'Inválido'}
                      {typeof certInfo.days_remaining === 'number' ? ` · ${certInfo.days_remaining}d` : ''}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                />
                <Field
                  label="Atualizações"
                  value={update ? (
                    update.update_available
                      ? <span className="text-warning">v{update.latest} disponível</span>
                      : <span className="text-success">Versão mais recente</span>
                  ) : <span className="text-muted-foreground">—</span>}
                />
              </div>
              <div className="space-y-4 border-t border-border pt-5">
                <Meter label="CPU" pct={sysInfo.cpu_pct} sub={`${sysInfo.cpu_cores ?? '?'} vCPU · load ${sysInfo.loadavg ?? '—'}`} />
                <Meter label="Memória" pct={sysInfo.mem_pct} sub={sysInfo.mem_total_kb ? `${formatBytes((sysInfo.mem_used_kb || 0) * 1024)} / ${formatBytes(sysInfo.mem_total_kb * 1024)}` : undefined} />
                <Meter label="Disco" pct={sysInfo.disk_pct} sub={sysInfo.disk_total_kb ? `${formatBytes((sysInfo.disk_used_kb || 0) * 1024)} / ${formatBytes(sysInfo.disk_total_kb * 1024)}` : undefined} />
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Servidor VPN</CardTitle>
              <CardDescription>Informações do OpenVPN</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Status" value={<span className={online ? 'text-success' : 'text-destructive'}>{online ? 'Rodando' : 'Parado'}</span>} />
              <Row label="Clientes conectados" value={vpnStatus?.connected_clients ?? 0} />
              <Row label="Total recebido" value={formatBytes(vpnStatus?.total_bytes_in || 0)} />
              <Row label="Total enviado" value={formatBytes(vpnStatus?.total_bytes_out || 0)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" /> IPsec Site-to-Site</CardTitle>
              <CardDescription>Status dos túneis StrongSwan</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="StrongSwan" value={<span className={ipsecStatus?.strongswan_running ? 'text-success' : 'text-destructive'}>{ipsecStatus?.strongswan_running ? 'Rodando' : 'Parado'}</span>} />
              <Row label="Túneis ativos" value={`${ipsecStatus?.active_tunnels ?? 0} / ${ipsecStatus?.total_connections ?? 0}`} />
              {ipsecStatus?.connections?.length > 0 ? (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  {ipsecStatus.connections.slice(0, 5).map((conn: any) => (
                    <div key={conn.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${conn.tunnel_status === 'UP' ? 'bg-success' : conn.tunnel_status === 'CONNECTING' ? 'bg-warning eg-pulse' : 'bg-destructive'}`} />
                        <span className="font-medium">{conn.name}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{conn.uptime || '-'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-2 text-center text-muted-foreground">Nenhum túnel IPsec configurado</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // ---- Regular user dashboard ----
  return (
    <div className="space-y-6">
      <PageHeader title="Minha VPN" subtitle="Status da sua conexão e perfil" />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /> Status da conexão</CardTitle>
        </CardHeader>
        <CardContent>
          {myActiveConnection ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-success eg-pulse" />
                <span className="font-medium text-success">Conectado</span>
              </div>
              <div className="grid gap-2 text-sm">
                <Row label="IP da VPN" value={<span className="font-mono">{myActiveConnection.vpn_ip}</span>} />
                <Row label="Conectado desde" value={formatDateTime(myActiveConnection.connected_at)} />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-muted-foreground/50" />
              <span className="text-muted-foreground">Desconectado</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Meu perfil VPN</CardTitle>
          <CardDescription>Sua configuração de VPN</CardDescription>
        </CardHeader>
        <CardContent>
          {myProfile ? (
            <div className="space-y-4">
              {(() => {
                const certExpiry = formatCertificateExpiry(myProfile.certificate_expires_at)
                return (
                  <div className="grid gap-2 text-sm">
                    <Row label="IP atribuído" value={<span className="font-mono">{myProfile.assigned_ip}</span>} />
                    <Row label="Status" value={<span className={myProfile.is_active ? 'text-success' : 'text-destructive'}>{myProfile.is_revoked ? 'Revogado' : myProfile.is_active ? 'Ativo' : 'Inativo'}</span>} />
                    <Row
                      label={<span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Validade do certificado</span>}
                      value={<span className={certExpiry.isExpired ? 'text-destructive' : certExpiry.isExpiringSoon ? 'text-warning' : 'text-success'}>{certExpiry.text}</span>}
                    />
                    <Row label="Total de conexões" value={myProfile.total_connections} />
                    <Row label="Tráfego total" value={formatBytes(myProfile.total_bytes_sent + myProfile.total_bytes_received)} />
                  </div>
                )
              })()}
              <Button
                className="w-full"
                disabled={myProfile.is_revoked}
                onClick={() => {
                  vpnApi.downloadConfig().then((response) => {
                    const blob = new Blob([response.data], { type: 'application/x-openvpn-profile' })
                    const url = window.URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${user?.username || 'client'}.ovpn`
                    a.click()
                    window.URL.revokeObjectURL(url)
                  })
                }}
              >
                <Download className="mr-2 h-4 w-4" /> Baixar config .ovpn
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">Nenhum perfil VPN configurado. Contate o administrador.</p>
          )}
        </CardContent>
      </Card>

      {myStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ArrowUpDown className="h-5 w-5 text-primary" /> Estatísticas de uso</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Total de sessões" value={myStats.total_connections || 0} />
            <Row label="Dados enviados" value={formatBytes(myStats.total_bytes_sent || 0)} />
            <Row label="Dados recebidos" value={formatBytes(myStats.total_bytes_received || 0)} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('font-medium text-foreground', mono && 'font-mono')}>{value}</p>
    </div>
  )
}

function Meter({ label, pct, sub }: { label: string; pct?: number | null; sub?: string }) {
  const v = typeof pct === 'number' ? Math.max(0, Math.min(100, Math.round(pct))) : null
  const color = v == null ? 'bg-muted-foreground/40' : v >= 90 ? 'bg-destructive' : v >= 75 ? 'bg-warning' : 'bg-primary'
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-medium', v != null && v >= 90 ? 'text-destructive' : v != null && v >= 75 ? 'text-warning' : 'text-primary')}>{v == null ? '—' : `${v}%`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${v ?? 0}%` }} />
      </div>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
