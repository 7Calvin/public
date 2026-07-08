import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { vpnApi } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { formatBytes } from '@/lib/utils'
import { Download, RefreshCw, Shield, ShieldOff, Server, Settings, Save, Plus, X } from 'lucide-react'
import type { VPNServerConfig } from '@/types'

export default function VPNPage() {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Server config state
  const [configForm, setConfigForm] = useState<Partial<VPNServerConfig>>({})
  const [newDns, setNewDns] = useState('')
  const [newSplitDomain, setNewSplitDomain] = useState('')
  const [newRoute, setNewRoute] = useState('')

  // Server status
  const { data: serverStatus } = useQuery({
    queryKey: ['vpn-status'],
    queryFn: () => vpnApi.serverStatus().then((res) => res.data),
    enabled: user?.is_admin,
    refetchInterval: 30000,
  })

  // Server config (fetch when modal opens or when admin has profile)
  const { data: serverConfig, isLoading: configLoading } = useQuery({
    queryKey: ['vpn-server-config'],
    queryFn: () => vpnApi.getServerConfig().then((res) => res.data),
    enabled: user?.is_admin,
  })

  // Update form when config loads
  useEffect(() => {
    if (serverConfig) {
      setConfigForm(serverConfig)
    }
  }, [serverConfig])

  const updateConfigMutation = useMutation({
    mutationFn: (data: Partial<VPNServerConfig>) => vpnApi.updateServerConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-server-config'] })
      toast({ title: 'Configuration saved', description: 'Some changes may require server restart' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to save configuration' })
    },
  })

  const downloadServerConfigMutation = useMutation({
    mutationFn: () => vpnApi.downloadServerConfig(),
    onSuccess: (response) => {
      const blob = new Blob([response.data], { type: 'application/x-openvpn-profile' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const serverHost = serverConfig?.server_host || 'vpn'
      const filename = serverHost.replace(/\./g, '-').replace(/:/g, '-')
      a.download = `${filename}.ovpn`
      a.click()
      window.URL.revokeObjectURL(url)
      toast({ title: 'Server config downloaded', description: 'Users authenticate with username and password' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to download server config' })
    },
  })

  const startServerMutation = useMutation({
    mutationFn: () => vpnApi.startServer(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-status'] })
      toast({ title: 'Server started', description: 'OpenVPN server started successfully' })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to start server', description: error.response?.data?.detail })
    },
  })

  const stopServerMutation = useMutation({
    mutationFn: () => vpnApi.stopServer(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-status'] })
      toast({ title: 'Server stopped', description: 'OpenVPN server stopped successfully' })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to stop server', description: error.response?.data?.detail })
    },
  })

  const restartServerMutation = useMutation({
    mutationFn: () => vpnApi.restartServer(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vpn-status'] })
      toast({ title: 'Server restarted', description: 'OpenVPN server restarted successfully' })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to restart server', description: error.response?.data?.detail })
    },
  })

  const handleSaveConfig = () => {
    // Exclude network fields if not editable
    const dataToSave = { ...configForm }
    if (!serverConfig?.network_editable) {
      delete dataToSave.vpn_network
      delete dataToSave.vpn_netmask
    }
    // Remove metadata field that shouldn't be sent
    delete dataToSave.network_editable
    updateConfigMutation.mutate(dataToSave)
  }

  const addDnsServer = () => {
    if (newDns && !configForm.dns_servers?.includes(newDns)) {
      setConfigForm({
        ...configForm,
        dns_servers: [...(configForm.dns_servers || []), newDns],
      })
      setNewDns('')
    }
  }

  const removeDnsServer = (dns: string) => {
    setConfigForm({
      ...configForm,
      dns_servers: configForm.dns_servers?.filter((d) => d !== dns) || [],
    })
  }

  const addSplitDomain = () => {
    const domain = newSplitDomain.trim().replace(/^\.+/, '')
    if (domain && !configForm.split_dns_domains?.includes(domain)) {
      setConfigForm({
        ...configForm,
        split_dns_domains: [...(configForm.split_dns_domains || []), domain],
      })
      setNewSplitDomain('')
    }
  }

  const removeSplitDomain = (domain: string) => {
    setConfigForm({
      ...configForm,
      split_dns_domains: configForm.split_dns_domains?.filter((d) => d !== domain) || [],
    })
  }

  const addRoute = () => {
    if (newRoute && !configForm.push_routes?.includes(newRoute)) {
      setConfigForm({
        ...configForm,
        push_routes: [...(configForm.push_routes || []), newRoute],
      })
      setNewRoute('')
    }
  }

  const removeRoute = (route: string) => {
    setConfigForm({
      ...configForm,
      push_routes: configForm.push_routes?.filter((r) => r !== route) || [],
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">OpenVPN</h1>
        <p className="text-muted-foreground">
          {user?.is_admin
            ? 'Manage VPN server configuration and download client files'
            : 'Download VPN configuration file and connect using your username and password'}
        </p>
      </div>

      {/* Quick Start - Download .ovpn for non-admin users */}
      {!user?.is_admin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Connect to VPN
            </CardTitle>
            <CardDescription>Download the VPN configuration file and connect using your credentials</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              <h4 className="font-medium mb-2">How to connect:</h4>
              <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                <li>Contact your administrator to download the .ovpn configuration file</li>
                <li>Import the .ovpn file into your OpenVPN client</li>
                <li>Connect using your username: <code className="bg-background px-1 rounded">{user?.username}</code></li>
                <li>Enter your account password when prompted</li>
              </ol>
            </div>
            <p className="text-sm text-muted-foreground">
              Note: You don't need an individual VPN profile. Use your regular account credentials to connect.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Server Status (Admin) */}
      {user?.is_admin && serverStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              VPN Server Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className={serverStatus.is_running ? 'text-green-500' : 'text-red-500'}>
                  {serverStatus.is_running ? 'Running' : 'Stopped'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Connected Clients</p>
                <p>{serverStatus.connected_clients}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Traffic In</p>
                <p>{formatBytes(serverStatus.total_bytes_in)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Traffic Out</p>
                <p>{formatBytes(serverStatus.total_bytes_out)}</p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              {!serverStatus.is_running ? (
                <Button
                  onClick={() => startServerMutation.mutate()}
                  disabled={startServerMutation.isPending}
                  className="flex-1"
                >
                  {startServerMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  Start Server
                </Button>
              ) : (
                <Button
                  onClick={() => stopServerMutation.mutate()}
                  disabled={stopServerMutation.isPending}
                  variant="destructive"
                  className="flex-1"
                >
                  {stopServerMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldOff className="h-4 w-4 mr-2" />
                  )}
                  Stop Server
                </Button>
              )}
              <Button
                onClick={() => restartServerMutation.mutate()}
                disabled={restartServerMutation.isPending || !serverStatus.is_running}
                variant="outline"
                className="flex-1"
              >
                {restartServerMutation.isPending ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Restart Server
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Server Configuration (Admin) */}
      {user?.is_admin && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Server Configuration
                </CardTitle>
                <CardDescription>OpenVPN server settings (changes may require restart)</CardDescription>
              </div>
              <Button
                onClick={() => downloadServerConfigMutation.mutate()}
                disabled={downloadServerConfigMutation.isPending}
              >
                <Download className="h-4 w-4 mr-2" />
                Download .ovpn
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {configLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Basic Settings */}
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="server_host">Server Host</Label>
                    <Input
                      id="server_host"
                      value={configForm.server_host || ''}
                      onChange={(e) => setConfigForm({ ...configForm, server_host: e.target.value })}
                      placeholder="vpn.example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="server_port">Port</Label>
                    <Input
                      id="server_port"
                      type="number"
                      value={configForm.server_port || 1194}
                      onChange={(e) => setConfigForm({ ...configForm, server_port: parseInt(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="protocol">Protocol</Label>
                    <select
                      id="protocol"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                      value={configForm.protocol || 'udp'}
                      onChange={(e) => setConfigForm({ ...configForm, protocol: e.target.value })}
                    >
                      <option value="udp">UDP</option>
                      <option value="tcp">TCP</option>
                    </select>
                  </div>
                </div>

                {/* Network Settings */}
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="vpn_network">VPN Network</Label>
                    <Input
                      id="vpn_network"
                      value={configForm.vpn_network || ''}
                      onChange={(e) => setConfigForm({ ...configForm, vpn_network: e.target.value })}
                      disabled={!serverConfig?.network_editable}
                      className={!serverConfig?.network_editable ? 'bg-muted' : ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="vpn_netmask">Netmask</Label>
                    <Input
                      id="vpn_netmask"
                      value={configForm.vpn_netmask || ''}
                      onChange={(e) => setConfigForm({ ...configForm, vpn_netmask: e.target.value })}
                      disabled={!serverConfig?.network_editable}
                      className={!serverConfig?.network_editable ? 'bg-muted' : ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max_clients">Max Clients</Label>
                    <Input
                      id="max_clients"
                      type="number"
                      value={configForm.max_clients || 100}
                      onChange={(e) => setConfigForm({ ...configForm, max_clients: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
                {!serverConfig?.network_editable && (
                  <p className="text-xs text-yellow-500">Network settings are locked after creating VPN profiles</p>
                )}

                {/* Redirect Gateway Toggle */}
                <div className="flex items-center justify-between p-4 bg-secondary/50 rounded-lg">
                  <div>
                    <Label className="text-base font-medium">Redirect Gateway</Label>
                    <p className="text-sm text-muted-foreground">
                      Force all client traffic through VPN tunnel (full tunnel mode)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfigForm({ ...configForm, redirect_gateway: !configForm.redirect_gateway })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      configForm.redirect_gateway ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        configForm.redirect_gateway ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* DNS Servers */}
                <div className="space-y-3">
                  <Label>DNS Servers</Label>
                  <div className="flex flex-wrap gap-2">
                    {configForm.dns_servers?.map((dns) => (
                      <span
                        key={dns}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-secondary rounded-md text-sm"
                      >
                        {dns}
                        <button
                          type="button"
                          onClick={() => removeDnsServer(dns)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="8.8.8.8"
                      value={newDns}
                      onChange={(e) => setNewDns(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addDnsServer}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Split DNS (internal domain resolution through the tunnel) */}
                <div className="space-y-3 p-4 border border-border rounded-lg">
                  <div>
                    <Label className="text-base font-medium">Split DNS (domínio interno)</Label>
                    <p className="text-sm text-muted-foreground">
                      Resolve apenas os domínios abaixo por um DNS interno através do túnel; o
                      resto continua usando o DNS do cliente. Ideal para split-tunnel (Redirect
                      Gateway desligado). Em split-tunnel, o DNS público NÃO é empurrado.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>DNS interno</Label>
                    <Input
                      placeholder="10.48.0.10"
                      value={configForm.internal_dns_server ?? ''}
                      onChange={(e) =>
                        setConfigForm({ ...configForm, internal_dns_server: e.target.value })
                      }
                      className="max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      IP do servidor DNS que resolve o domínio (precisa ser alcançável pelo túnel,
                      ex. dentro da rede NAT). Deixe vazio para desabilitar.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Domínios</Label>
                    <div className="flex flex-wrap gap-2">
                      {configForm.split_dns_domains?.map((domain) => (
                        <span
                          key={domain}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-secondary rounded-md text-sm font-mono"
                        >
                          {domain}
                          <button
                            type="button"
                            onClick={() => removeSplitDomain(domain)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="numerama.local"
                        value={newSplitDomain}
                        onChange={(e) => setNewSplitDomain(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addSplitDomain()
                          }
                        }}
                        className="max-w-xs"
                      />
                      <Button type="button" variant="outline" size="sm" onClick={addSplitDomain}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Push Routes */}
                <div className="space-y-3">
                  <Label>Push Routes (CIDR)</Label>
                  <div className="flex flex-wrap gap-2">
                    {configForm.push_routes?.map((route) => (
                      <span
                        key={route}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-secondary rounded-md text-sm font-mono"
                      >
                        {route}
                        <button
                          type="button"
                          onClick={() => removeRoute(route)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {(!configForm.push_routes || configForm.push_routes.length === 0) && (
                      <span className="text-sm text-muted-foreground">No routes configured</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="192.168.1.0/24"
                      value={newRoute}
                      onChange={(e) => setNewRoute(e.target.value)}
                      className="max-w-xs font-mono"
                    />
                    <Button type="button" variant="outline" size="sm" onClick={addRoute}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end pt-4 border-t">
                  <Button onClick={handleSaveConfig} disabled={updateConfigMutation.isPending}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Configuration
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  )
}
