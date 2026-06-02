import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { connectionsApi } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatBytes, formatDuration, formatDate } from '@/lib/utils'
import { Activity, RefreshCw, XCircle, Loader2 } from 'lucide-react'
import type { Connection } from '@/types'

export default function ConnectionsPage() {
  const { user } = useAuthStore()
  const { toast } = useToast()

  const isAdmin = !!user?.is_admin

  // Active connections - direct fetch (bypasses React Query issue)
  const [activeConnections, setActiveConnections] = useState<Connection[]>([])
  const [activeLoading, setActiveLoading] = useState(false)
  const [activeError, setActiveError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Disconnect confirmation dialog
  const [disconnectTarget, setDisconnectTarget] = useState<Connection | null>(null)

  const fetchActive = useCallback(async () => {
    if (!isAdmin) return
    try {
      setActiveLoading(true)
      setActiveError(false)
      const res = await connectionsApi.active()
      setActiveConnections(Array.isArray(res.data) ? res.data : res.data?.items || [])
    } catch (err) {
      console.error('Failed to fetch active connections:', err)
      setActiveError(true)
    } finally {
      setActiveLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    fetchActive()
    if (!isAdmin) return
    const interval = setInterval(fetchActive, 10000)
    return () => clearInterval(interval)
  }, [fetchActive, isAdmin])

  // Connection history: admin sees all users, regular user sees only their own
  const { data: myConnections, isLoading: myLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['connections-history', isAdmin],
    queryFn: () =>
      isAdmin
        ? connectionsApi.list().then((res) => res.data)
        : connectionsApi.my().then((res) => res.data),
  })

  // Stats
  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['connection-stats', isAdmin],
    queryFn: () => connectionsApi.stats().then((res) => res.data),
    enabled: isAdmin,
    refetchInterval: isAdmin ? 30000 : false,
  })

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([
        fetchActive(),
        refetchHistory(),
        isAdmin ? refetchStats() : Promise.resolve(),
      ])
    } finally {
      setRefreshing(false)
    }
  }

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => connectionsApi.disconnect(id),
    onSuccess: () => {
      setDisconnectTarget(null)
      fetchActive()
      refetchHistory()
      if (isAdmin) refetchStats()
      toast({ title: 'Connection terminated' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to disconnect' })
    },
  })

  const cleanupMutation = useMutation({
    mutationFn: () => connectionsApi.cleanup(),
    onSuccess: () => {
      fetchActive()
      refetchHistory()
      if (isAdmin) refetchStats()
      toast({ title: 'Stale connections cleaned up' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to cleanup' })
    },
  })

  const myList = Array.isArray(myConnections) ? myConnections : myConnections?.items || []

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-500'
      case 'disconnected':
        return 'bg-muted text-muted-foreground'
      case 'banned':
        return 'bg-red-500/20 text-red-500'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Connections</h1>
          <p className="text-muted-foreground">Monitor VPN connections</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
            <Button variant="outline" onClick={() => cleanupMutation.mutate()} disabled={cleanupMutation.isPending}>
              {cleanupMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Cleanup Stale
            </Button>
          </div>
        )}
      </div>

      {/* Stats (Admin) */}
      {isAdmin && stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Connections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.active_connections}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Users
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.active_users}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Data Sent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatBytes(stats.total_bytes_sent)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Data Received
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatBytes(stats.total_bytes_received)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Active Connections (Admin) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              Active Connections
            </CardTitle>
            <CardDescription>{activeConnections.length} connections currently active</CardDescription>
          </CardHeader>
          <CardContent>
            {activeError ? (
              <div className="text-center py-8">
                <p className="text-red-500">Failed to load active connections</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => fetchActive()}>
                  Retry
                </Button>
              </div>
            ) : activeLoading && activeConnections.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : activeConnections.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No active connections</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-muted-foreground border-b">
                    <tr>
                      <th className="px-4 py-3 text-left">User</th>
                      <th className="px-4 py-3 text-left">VPN IP</th>
                      <th className="px-4 py-3 text-left">Source IP</th>
                      <th className="px-4 py-3 text-left">Connected</th>
                      <th className="px-4 py-3 text-left">Duration</th>
                      <th className="px-4 py-3 text-left">Traffic</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeConnections.map((conn: Connection) => (
                      <tr key={conn.id} className="border-b">
                        <td className="px-4 py-3">{conn.username || conn.user_id}</td>
                        <td className="px-4 py-3 font-mono">{conn.vpn_ip}</td>
                        <td className="px-4 py-3 font-mono">{conn.source_ip}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(conn.connected_at)}
                        </td>
                        <td className="px-4 py-3">{formatDuration(conn.duration_seconds)}</td>
                        <td className="px-4 py-3">
                          <span className="text-green-500">{formatBytes(conn.bytes_sent)}</span>
                          {' / '}
                          <span className="text-blue-500">{formatBytes(conn.bytes_received)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDisconnectTarget(conn)}
                            disabled={disconnectMutation.isPending}
                          >
                            {disconnectMutation.isPending && disconnectMutation.variables === conn.id ? (
                              <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connection History */}
      <Card>
        <CardHeader>
          <CardTitle>Connection History</CardTitle>
          <CardDescription>Recent VPN connection logs</CardDescription>
        </CardHeader>
        <CardContent>
          {myLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : myList.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No connection history</p>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">VPN IP</th>
                    <th className="px-4 py-3 text-left">Source IP</th>
                    <th className="px-4 py-3 text-left">Connected</th>
                    <th className="px-4 py-3 text-left">Duration</th>
                    <th className="px-4 py-3 text-left">Traffic (Out / In)</th>
                  </tr>
                </thead>
                <tbody>
                  {myList.slice(0, 10).map((conn: Connection) => (
                    <tr key={conn.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{conn.username || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs capitalize ${getStatusColor(conn.status)}`}>
                          {conn.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono">{conn.vpn_ip}</td>
                      <td className="px-4 py-3 font-mono">{conn.source_ip}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(conn.connected_at)}
                      </td>
                      <td className="px-4 py-3">{formatDuration(conn.duration_seconds)}</td>
                      <td className="px-4 py-3">
                        <span className="text-green-500">{formatBytes(conn.bytes_sent)}</span>
                        {' / '}
                        <span className="text-blue-500">{formatBytes(conn.bytes_received)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disconnect Confirmation Dialog */}
      <Dialog open={!!disconnectTarget} onOpenChange={(open) => !open && setDisconnectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Client</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect <strong>{disconnectTarget?.username || disconnectTarget?.user_id}</strong> ({disconnectTarget?.vpn_ip})?
              This will immediately terminate their VPN session.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDisconnectTarget(null)}
              disabled={disconnectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => disconnectTarget && disconnectMutation.mutate(disconnectTarget.id)}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
