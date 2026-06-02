import { useQuery } from '@tanstack/react-query'
import { connectionsApi, usersApi, vpnApi, ipsecApi } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatBytes, formatCertificateExpiry } from '@/lib/utils'
import { Users, Activity, Shield, Server, ArrowUpDown, Download, Calendar, Lock } from 'lucide-react'

export default function DashboardPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.is_admin

  // Admin stats
  const { data: stats } = useQuery({
    queryKey: ['connection-stats'],
    queryFn: () => connectionsApi.stats().then((res) => res.data),
    refetchInterval: 30000,
    enabled: isAdmin,
  })

  const { data: userStats } = useQuery({
    queryKey: ['user-stats'],
    queryFn: () => usersApi.stats().then((res) => res.data),
    enabled: isAdmin,
  })

  const { data: vpnStatus } = useQuery({
    queryKey: ['vpn-status'],
    queryFn: () => vpnApi.serverStatus().then((res) => res.data),
    refetchInterval: 30000,
    enabled: isAdmin,
  })

  const { data: ipsecStatus } = useQuery({
    queryKey: ['ipsec-status'],
    queryFn: () => ipsecApi.status().then((res) => res.data),
    refetchInterval: 15000,
    enabled: isAdmin,
  })

  // User stats
  const { data: myProfile } = useQuery({
    queryKey: ['my-vpn-profile'],
    queryFn: () => vpnApi.getProfile().then((res) => res.data).catch(() => null),
    enabled: !isAdmin,
  })

  const { data: myStats } = useQuery({
    queryKey: ['my-connection-stats'],
    queryFn: () => connectionsApi.myStats().then((res) => res.data).catch(() => null),
    enabled: !isAdmin,
  })

  const { data: myActiveConnection } = useQuery({
    queryKey: ['my-active-connection'],
    queryFn: () => connectionsApi.myActive().then((res) => res.data).catch(() => null),
    refetchInterval: 30000,
    enabled: !isAdmin,
  })

  // Admin dashboard
  if (isAdmin) {
    const statCards = [
      {
        title: 'Total Users',
        value: userStats?.total_users || 0,
        description: `${userStats?.active_users || 0} active`,
        icon: Users,
        color: 'text-blue-500',
      },
      {
        title: 'Active Connections',
        value: stats?.active_connections || 0,
        description: `${stats?.total_connections || 0} total today`,
        icon: Activity,
        color: 'text-green-500',
      },
      {
        title: 'VPN Server',
        value: vpnStatus?.is_running ? 'Online' : 'Offline',
        description: `${vpnStatus?.connected_clients || 0} clients`,
        icon: Server,
        color: vpnStatus?.is_running ? 'text-green-500' : 'text-red-500',
      },
      {
        title: 'Bandwidth Today',
        value: formatBytes((stats?.total_bytes_sent || 0) + (stats?.total_bytes_received || 0)),
        description: `${formatBytes(stats?.total_bytes_sent || 0)} sent`,
        icon: ArrowUpDown,
        color: 'text-purple-500',
      },
      {
        title: 'IPsec Tunnels',
        value: `${ipsecStatus?.active_tunnels || 0} / ${ipsecStatus?.total_connections || 0}`,
        description: ipsecStatus?.strongswan_running ? 'StrongSwan running' : 'StrongSwan stopped',
        icon: Lock,
        color: ipsecStatus?.active_tunnels > 0 ? 'text-green-500' : 'text-yellow-500',
      },
    ]

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your VPN management system
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Info */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                VPN Server Status
              </CardTitle>
              <CardDescription>OpenVPN server information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className={vpnStatus?.is_running ? 'text-green-500' : 'text-red-500'}>
                  {vpnStatus?.is_running ? 'Running' : 'Stopped'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connected Clients</span>
                <span>{vpnStatus?.connected_clients || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Bytes In</span>
                <span>{formatBytes(vpnStatus?.total_bytes_in || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Bytes Out</span>
                <span>{formatBytes(vpnStatus?.total_bytes_out || 0)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                IPsec Site-to-Site
              </CardTitle>
              <CardDescription>StrongSwan tunnel status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">StrongSwan</span>
                <span className={ipsecStatus?.strongswan_running ? 'text-green-500' : 'text-red-500'}>
                  {ipsecStatus?.strongswan_running ? 'Running' : 'Stopped'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active Tunnels</span>
                <span>{ipsecStatus?.active_tunnels || 0} / {ipsecStatus?.total_connections || 0}</span>
              </div>
              {ipsecStatus?.connections && ipsecStatus.connections.length > 0 && (
                <div className="border-t pt-3 mt-3 space-y-2">
                  {ipsecStatus.connections.slice(0, 5).map((conn: any) => (
                    <div key={conn.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-full ${
                          conn.tunnel_status === 'UP' ? 'bg-green-500' :
                          conn.tunnel_status === 'CONNECTING' ? 'bg-yellow-500 animate-pulse' :
                          'bg-red-500'
                        }`} />
                        <span className="font-medium">{conn.name}</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="text-xs">{conn.uptime || '-'}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          conn.tunnel_status === 'UP' ? 'bg-green-500/10 text-green-500' :
                          conn.tunnel_status === 'CONNECTING' ? 'bg-yellow-500/10 text-yellow-500' :
                          'bg-red-500/10 text-red-500'
                        }`}>
                          {conn.tunnel_status || conn.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {(!ipsecStatus?.connections || ipsecStatus.connections.length === 0) && (
                <p className="text-muted-foreground text-sm text-center py-2">
                  No IPsec tunnels configured
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // Regular user dashboard
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">My VPN</h1>
        <p className="text-muted-foreground">
          Your VPN connection status and profile
        </p>
      </div>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {myActiveConnection ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500 animate-pulse" />
                <span className="text-green-500 font-medium">Connected</span>
              </div>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VPN IP</span>
                  <span className="font-mono">{myActiveConnection.vpn_ip}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connected Since</span>
                  <span>{new Date(myActiveConnection.connected_at).toLocaleString()}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-gray-400" />
              <span className="text-muted-foreground">Not connected</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* VPN Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            My VPN Profile
          </CardTitle>
          <CardDescription>Your VPN configuration</CardDescription>
        </CardHeader>
        <CardContent>
          {myProfile ? (
            <div className="space-y-4">
              {(() => {
                const certExpiry = formatCertificateExpiry(myProfile.certificate_expires_at)
                return (
                  <div className="grid gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Assigned IP</span>
                      <span className="font-mono">{myProfile.assigned_ip}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <span className={myProfile.is_active ? 'text-green-500' : 'text-red-500'}>
                        {myProfile.is_revoked ? 'Revoked' : myProfile.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Certificate Validity
                      </span>
                      <span className={
                        certExpiry.isExpired ? 'text-red-500' :
                        certExpiry.isExpiringSoon ? 'text-yellow-500' : 'text-green-500'
                      }>
                        {certExpiry.text}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Connections</span>
                      <span>{myProfile.total_connections}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Traffic</span>
                      <span>{formatBytes(myProfile.total_bytes_sent + myProfile.total_bytes_received)}</span>
                    </div>
                  </div>
                )
              })()}
              <Button
                className="w-full"
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
                disabled={myProfile.is_revoked}
              >
                <Download className="h-4 w-4 mr-2" />
                Download .ovpn Config
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">
              No VPN profile configured. Please contact your administrator.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Usage Stats */}
      {myStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5" />
              Usage Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Sessions</span>
                <span>{myStats.total_connections || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data Sent</span>
                <span>{formatBytes(myStats.total_bytes_sent || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Data Received</span>
                <span>{formatBytes(myStats.total_bytes_received || 0)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
