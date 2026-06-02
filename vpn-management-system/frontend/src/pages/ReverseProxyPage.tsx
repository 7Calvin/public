import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { proxyApi, acmeApi } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  Globe,
  Plus,
  Trash2,
  Pencil,
  Eye,
  Settings,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Heart,
  Shield,
  ShieldOff,
  Lock,
  RotateCcw,
  Copy,
  Loader2,
  FileKey,
} from 'lucide-react'
import type { ProxyRoute, ProxyRouteCreate, CertificateListResponse, ACMEChallenge } from '@/types'

interface RouteForm {
  name: string
  hostname: string
  backend_url: string
  path_prefix: string
  strip_prefix: boolean
  ssl_mode: string
  force_https: boolean
  health_check_type: string
  health_check_path: string
  health_check_interval: string
  pass_host_header: boolean
  custom_request_headers: string
  custom_response_headers: string
  rate_limit_average: string
  rate_limit_burst: string
  is_enabled: boolean
}

const SSL_MODE_OPTIONS = [
  { value: 'letsencrypt', label: "Let's Encrypt (HTTP-01)" },
  { value: 'letsencrypt_dns', label: "Let's Encrypt (DNS-01)" },
  { value: 'custom', label: 'Custom Certificate' },
  { value: 'none', label: 'No SSL (HTTP only)' },
]

const HEALTH_CHECK_OPTIONS = [
  { value: 'http', label: 'HTTP' },
  { value: 'tcp', label: 'TCP' },
  { value: 'none', label: 'Disabled' },
]

const createInitialForm = (): RouteForm => ({
  name: '',
  hostname: '',
  backend_url: '',
  path_prefix: '',
  strip_prefix: false,
  ssl_mode: 'letsencrypt',
  force_https: true,
  health_check_type: 'http',
  health_check_path: '/',
  health_check_interval: '30s',
  pass_host_header: true,
  custom_request_headers: '',
  custom_response_headers: '',
  rate_limit_average: '',
  rate_limit_burst: '',
  is_enabled: true,
})

export default function ReverseProxyPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isConfigPreviewOpen, setIsConfigPreviewOpen] = useState(false)
  const [formData, setFormData] = useState<RouteForm>(createInitialForm())
  const [editingRoute, setEditingRoute] = useState<ProxyRoute | null>(null)
  const [isDnsDialogOpen, setIsDnsDialogOpen] = useState(false)
  const [dnsChallenge, setDnsChallenge] = useState<ACMEChallenge | null>(null)
  const [dnsRouteContext, setDnsRouteContext] = useState<ProxyRoute | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; message: string } | null>(null)

  // Queries
  const { data: routesData, isLoading } = useQuery({
    queryKey: ['proxy-routes'],
    queryFn: () => proxyApi.list().then((res) => res.data),
  })

  const { data: traefikStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['traefik-status'],
    queryFn: () => proxyApi.status().then((res) => res.data),
    refetchInterval: 15000,
  })

  const { data: certsData, refetch: refetchCerts } = useQuery<CertificateListResponse>({
    queryKey: ['proxy-certificates'],
    queryFn: () => proxyApi.certificates().then((res) => res.data),
    refetchInterval: 60000,
  })

  const { data: configPreview } = useQuery({
    queryKey: ['proxy-config-preview'],
    queryFn: () => proxyApi.previewConfig().then((res) => res.data),
    enabled: isConfigPreviewOpen,
  })

  // Mutations
  const getErrorMessage = (error: Error & { response?: { data?: { detail?: unknown; message?: string; details?: Array<{ msg?: string }> } }; status?: number }) => {
    const data = error.response?.data
    if (data?.detail) {
      if (typeof data.detail === 'string') return data.detail
      if (Array.isArray(data.detail)) {
        return data.detail.map((d: { msg?: string; message?: string }) => d.msg || d.message || JSON.stringify(d)).join('; ')
      }
      return JSON.stringify(data.detail)
    }
    if (data?.details?.length) return data.details.map((d) => d.msg).join('; ')
    if (data?.message) return data.message
    return error.message || 'Unknown error'
  }

  const createMutation = useMutation({
    mutationFn: (data: ProxyRouteCreate) => proxyApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxy-routes'] })
      queryClient.invalidateQueries({ queryKey: ['proxy-config-preview'] })
      toast({ title: 'Route created successfully' })
      setIsAddModalOpen(false)
      setFormData(createInitialForm())
    },
    onError: (error: Error & { response?: { data?: { detail?: string; message?: string; details?: Array<{ msg?: string }> } } }) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create route',
        description: getErrorMessage(error),
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProxyRoute> }) =>
      proxyApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxy-routes'] })
      queryClient.invalidateQueries({ queryKey: ['proxy-config-preview'] })
      toast({ title: 'Route updated' })
      setIsEditModalOpen(false)
      setEditingRoute(null)
    },
    onError: (error: Error & { response?: { data?: { detail?: string; message?: string; details?: Array<{ msg?: string }> } } }) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update route',
        description: getErrorMessage(error),
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => proxyApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxy-routes'] })
      queryClient.invalidateQueries({ queryKey: ['proxy-config-preview'] })
      toast({ title: 'Route deleted' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete route' })
    },
  })

  const applyMutation = useMutation({
    mutationFn: () => proxyApi.apply(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxy-routes'] })
      queryClient.invalidateQueries({ queryKey: ['traefik-status'] })
      toast({ title: 'Configuration applied successfully' })
    },
    onError: (error: Error & { response?: { data?: { detail?: string; message?: string; details?: Array<{ msg?: string }> } } }) => {
      toast({
        variant: 'destructive',
        title: 'Failed to apply configuration',
        description: getErrorMessage(error),
      })
    },
  })

  const healthCheckMutation = useMutation({
    mutationFn: () => proxyApi.healthCheckAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxy-routes'] })
      toast({ title: 'Health check completed' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Health check failed' })
    },
  })

  const singleHealthCheckMutation = useMutation({
    mutationFn: (id: string) => proxyApi.healthCheck(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proxy-routes'] })
      toast({ title: 'Health check completed' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Health check failed' })
    },
  })

  const renewCertMutation = useMutation({
    mutationFn: (domain: string) => proxyApi.renewCertificate(domain),
    onSuccess: (_, domain) => {
      queryClient.invalidateQueries({ queryKey: ['proxy-certificates'] })
      toast({ title: `Certificate renewal triggered for ${domain}` })
    },
    onError: (error: Error & { response?: { data?: { detail?: string; message?: string; details?: Array<{ msg?: string }> } } }) => {
      toast({
        variant: 'destructive',
        title: 'Failed to renew certificate',
        description: getErrorMessage(error),
      })
    },
  })

  const requestDnsMutation = useMutation({
    mutationFn: (data: { domain: string; proxy_route_id?: string }) =>
      acmeApi.requestDnsChallenge(data),
    onSuccess: (res) => {
      setDnsChallenge(res.data)
      setVerifyResult(null)
    },
    onError: (error: Error & { response?: { data?: { detail?: string; message?: string; details?: Array<{ msg?: string }> } } }) => {
      toast({
        variant: 'destructive',
        title: 'Failed to request DNS challenge',
        description: getErrorMessage(error),
      })
    },
  })

  const verifyDnsMutation = useMutation({
    mutationFn: (challengeId: string) => acmeApi.verifyDnsChallenge(challengeId),
    onSuccess: (res) => {
      setVerifyResult({ success: res.data.success, message: res.data.message })
      if (res.data.success) {
        queryClient.invalidateQueries({ queryKey: ['proxy-routes'] })
        queryClient.invalidateQueries({ queryKey: ['proxy-certificates'] })
        toast({ title: 'Certificate issued successfully!' })
      }
      setIsVerifying(false)
    },
    onError: (error: Error & { response?: { data?: { detail?: string; message?: string; details?: Array<{ msg?: string }> } } }) => {
      setVerifyResult({ success: false, message: getErrorMessage(error) })
      setIsVerifying(false)
    },
  })

  const handleRequestDns = (route: ProxyRoute) => {
    setDnsRouteContext(route)
    setDnsChallenge(null)
    setVerifyResult(null)
    setIsVerifying(false)
    setIsDnsDialogOpen(true)
    requestDnsMutation.mutate({ domain: route.hostname, proxy_route_id: route.id })
  }

  const handleVerifyDns = () => {
    if (!dnsChallenge) return
    setIsVerifying(true)
    setVerifyResult(null)
    verifyDnsMutation.mutate(dnsChallenge.id)
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: `${label} copied to clipboard` })
  }

  const routes: ProxyRoute[] = routesData?.items || []

  const updateField = (field: keyof RouteForm, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const formToPayload = (form: RouteForm): ProxyRouteCreate => {
    const payload: ProxyRouteCreate = {
      name: form.name,
      hostname: form.hostname,
      backend_url: form.backend_url,
      ssl_mode: form.ssl_mode as ProxyRouteCreate['ssl_mode'],
      force_https: form.force_https,
      health_check_type: form.health_check_type as ProxyRouteCreate['health_check_type'],
      health_check_path: form.health_check_path || '/',
      health_check_interval: form.health_check_interval || '30s',
      pass_host_header: form.pass_host_header,
      strip_prefix: form.strip_prefix,
      is_enabled: form.is_enabled,
    }
    if (form.path_prefix) payload.path_prefix = form.path_prefix
    if (form.custom_request_headers) payload.custom_request_headers = form.custom_request_headers
    if (form.custom_response_headers) payload.custom_response_headers = form.custom_response_headers
    if (form.rate_limit_average) payload.rate_limit_average = parseInt(form.rate_limit_average)
    if (form.rate_limit_burst) payload.rate_limit_burst = parseInt(form.rate_limit_burst)
    return payload
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.hostname.trim() || !formData.backend_url.trim()) {
      toast({ variant: 'destructive', title: 'Name, hostname, and backend URL are required' })
      return
    }
    createMutation.mutate(formToPayload(formData))
  }

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRoute) return
    updateMutation.mutate({
      id: editingRoute.id,
      data: formToPayload(formData) as Partial<ProxyRoute>,
    })
  }

  const handleToggleEnabled = (route: ProxyRoute) => {
    updateMutation.mutate({ id: route.id, data: { is_enabled: !route.is_enabled } })
  }

  const openEditModal = (route: ProxyRoute) => {
    setEditingRoute(route)
    setFormData({
      name: route.name,
      hostname: route.hostname,
      backend_url: route.backend_url,
      path_prefix: route.path_prefix || '',
      strip_prefix: route.strip_prefix,
      ssl_mode: route.ssl_mode,
      force_https: route.force_https,
      health_check_type: route.health_check_type,
      health_check_path: route.health_check_path || '/',
      health_check_interval: route.health_check_interval || '30s',
      pass_host_header: route.pass_host_header,
      custom_request_headers: route.custom_request_headers || '',
      custom_response_headers: route.custom_response_headers || '',
      rate_limit_average: route.rate_limit_average?.toString() || '',
      rate_limit_burst: route.rate_limit_burst?.toString() || '',
      is_enabled: route.is_enabled,
    })
    setIsEditModalOpen(true)
  }

  const openAddModal = () => {
    setFormData(createInitialForm())
    setIsAddModalOpen(true)
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-500">
            <CheckCircle2 className="h-3 w-3" /> Active
          </span>
        )
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-500">
            <XCircle className="h-3 w-3" /> Error
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-500">
            <AlertCircle className="h-3 w-3" /> Pending
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-muted text-muted-foreground">
            <AlertCircle className="h-3 w-3" /> Inactive
          </span>
        )
    }
  }

  const getHealthBadge = (route: ProxyRoute) => {
    if (route.last_health_status === null || route.last_health_status === undefined) {
      return <span className="text-xs text-muted-foreground">Not checked</span>
    }
    if (route.last_health_status) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-500">
          <CheckCircle2 className="h-3 w-3" /> Healthy
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-500" title={route.last_error || ''}>
        <XCircle className="h-3 w-3" /> Unhealthy
      </span>
    )
  }

  const renderFormFields = (prefix: string) => (
    <div className="space-y-6 mt-4">
      {/* Basic Info */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Route Details</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-name`}>Route Name *</Label>
            <Input
              id={`${prefix}-name`}
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="my-app"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-hostname`}>Hostname *</Label>
            <Input
              id={`${prefix}-hostname`}
              value={formData.hostname}
              onChange={(e) => updateField('hostname', e.target.value)}
              placeholder="app.example.com"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-backend_url`}>Backend URL *</Label>
          <Input
            id={`${prefix}-backend_url`}
            value={formData.backend_url}
            onChange={(e) => updateField('backend_url', e.target.value)}
            placeholder="http://10.0.1.5:8080"
          />
          <p className="text-xs text-muted-foreground">URL of the backend service (private EC2, internal service, etc.)</p>
        </div>
      </div>

      {/* Path Routing */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Path Routing (Optional)</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-path_prefix`}>Path Prefix</Label>
            <Input
              id={`${prefix}-path_prefix`}
              value={formData.path_prefix}
              onChange={(e) => updateField('path_prefix', e.target.value)}
              placeholder="/app"
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.strip_prefix}
                onChange={(e) => updateField('strip_prefix', e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Strip prefix before forwarding</span>
            </label>
          </div>
        </div>
      </div>

      {/* SSL */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">SSL / TLS</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-ssl_mode`}>SSL Mode</Label>
            <Select
              id={`${prefix}-ssl_mode`}
              value={formData.ssl_mode}
              onChange={(e) => updateField('ssl_mode', e.target.value)}
              options={SSL_MODE_OPTIONS}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.force_https}
                onChange={(e) => updateField('force_https', e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Force HTTPS redirect</span>
            </label>
          </div>
        </div>
      </div>

      {/* Health Check */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Health Check</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-health_check_type`}>Type</Label>
            <Select
              id={`${prefix}-health_check_type`}
              value={formData.health_check_type}
              onChange={(e) => updateField('health_check_type', e.target.value)}
              options={HEALTH_CHECK_OPTIONS}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-health_check_path`}>Path</Label>
            <Input
              id={`${prefix}-health_check_path`}
              value={formData.health_check_path}
              onChange={(e) => updateField('health_check_path', e.target.value)}
              placeholder="/health"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-health_check_interval`}>Interval</Label>
            <Input
              id={`${prefix}-health_check_interval`}
              value={formData.health_check_interval}
              onChange={(e) => updateField('health_check_interval', e.target.value)}
              placeholder="30s"
            />
          </div>
        </div>
      </div>

      {/* Rate Limiting */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Rate Limiting (Optional)</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-rate_limit_average`}>Average (req/s)</Label>
            <Input
              id={`${prefix}-rate_limit_average`}
              type="number"
              value={formData.rate_limit_average}
              onChange={(e) => updateField('rate_limit_average', e.target.value)}
              placeholder="100"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-rate_limit_burst`}>Burst</Label>
            <Input
              id={`${prefix}-rate_limit_burst`}
              type="number"
              value={formData.rate_limit_burst}
              onChange={(e) => updateField('rate_limit_burst', e.target.value)}
              placeholder="200"
            />
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="space-y-4">
        <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Options</h3>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.pass_host_header}
              onChange={(e) => updateField('pass_host_header', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Pass Host header</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_enabled}
              onChange={(e) => updateField('is_enabled', e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Enabled</span>
          </label>
        </div>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Reverse Proxy</h1>
          <p className="text-muted-foreground">Manage Traefik ingress routes for external services</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsConfigPreviewOpen(true)}>
            <Eye className="h-4 w-4 mr-2" />
            Preview Config
          </Button>
          <Button
            variant="outline"
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending}
          >
            <Settings className="h-4 w-4 mr-2" />
            Apply Config
          </Button>
          <Button onClick={openAddModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Route
          </Button>
        </div>
      </div>

      {/* Traefik Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Traefik Status
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => healthCheckMutation.mutate()}
                disabled={healthCheckMutation.isPending}
              >
                <Heart className={`h-4 w-4 mr-1 ${healthCheckMutation.isPending ? 'animate-pulse' : ''}`} />
                Health Check All
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetchStatus()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Traefik</p>
              <p className={traefikStatus?.running ? 'text-green-500 font-medium' : 'text-red-500'}>
                {traefikStatus?.running ? 'Running' : 'Stopped'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">HTTP Routers</p>
              <p className="font-medium">{traefikStatus?.http?.routers?.total || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">HTTP Services</p>
              <p className="font-medium">{traefikStatus?.http?.services?.total || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Configured Routes</p>
              <p className="font-medium">{routes.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Routes Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Proxy Routes
          </CardTitle>
          <CardDescription>
            {routes.length} route{routes.length !== 1 ? 's' : ''} configured
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : routes.length === 0 ? (
            <div className="text-center py-8">
              <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">No proxy routes configured</p>
              <Button onClick={openAddModal}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Route
              </Button>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Hostname</th>
                    <th className="px-4 py-3 text-left">Backend URL</th>
                    <th className="px-4 py-3 text-left">SSL</th>
                    <th className="px-4 py-3 text-left">Health</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.map((route) => (
                    <tr key={route.id} className="border-b hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <p className="font-medium">{route.name}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{route.hostname}</td>
                      <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate" title={route.backend_url}>
                        {route.backend_url}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs capitalize">{route.ssl_mode.replace('_', ' ')}</span>
                      </td>
                      <td className="px-4 py-3">{getHealthBadge(route)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(route.status)}
                          <button
                            onClick={() => handleToggleEnabled(route)}
                            disabled={updateMutation.isPending}
                            className="p-1 rounded hover:bg-muted"
                            title={route.is_enabled ? 'Disable' : 'Enable'}
                          >
                            {route.is_enabled ? (
                              <Shield className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {route.ssl_mode === 'letsencrypt_dns' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRequestDns(route)}
                              title="Request DNS-01 Certificate"
                            >
                              <FileKey className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => singleHealthCheckMutation.mutate(route.id)}
                            disabled={singleHealthCheckMutation.isPending}
                            title="Health check"
                          >
                            <Heart className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEditModal(route)} title="Edit route">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteMutation.mutate(route.id)}
                            disabled={deleteMutation.isPending}
                            className="text-destructive hover:text-destructive"
                            title="Delete route"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SSL Certificates Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              SSL Certificates
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetchCerts()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription>
            {certsData?.acme_email && (
              <span>ACME account: {certsData.acme_email} &middot; </span>
            )}
            {certsData?.total || 0} certificate{(certsData?.total || 0) !== 1 ? 's' : ''}
            {(certsData?.valid || 0) > 0 && (
              <span className="text-green-500 ml-2">{certsData?.valid} valid</span>
            )}
            {(certsData?.expiring || 0) > 0 && (
              <span className="text-yellow-500 ml-2">{certsData?.expiring} expiring</span>
            )}
            {(certsData?.expired || 0) > 0 && (
              <span className="text-red-500 ml-2">{certsData?.expired} expired</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!certsData || certsData.total === 0 ? (
            <div className="text-center py-6">
              <Lock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">
                No certificates yet. Certificates are automatically issued when you create routes with SSL enabled and apply the configuration.
              </p>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Domain</th>
                    <th className="px-4 py-3 text-left">Issuer</th>
                    <th className="px-4 py-3 text-left">Expires</th>
                    <th className="px-4 py-3 text-left">Remaining</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {certsData.certificates.map((cert) => (
                    <tr key={cert.domain} className="border-b hover:bg-muted/50">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium font-mono text-xs">{cert.domain}</p>
                          {cert.sans && cert.sans.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              SANs: {cert.sans.join(', ')}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{cert.issuer || '-'}</td>
                      <td className="px-4 py-3 text-xs font-mono">
                        {cert.not_after ? new Date(cert.not_after).toLocaleDateString() : '-'}
                      </td>
                      <td className="px-4 py-3">
                        {cert.days_remaining !== null && cert.days_remaining !== undefined ? (
                          <span className={`text-xs font-medium ${
                            cert.days_remaining < 0
                              ? 'text-red-500'
                              : cert.days_remaining < 14
                              ? 'text-yellow-500'
                              : 'text-green-500'
                          }`}>
                            {cert.days_remaining < 0
                              ? `Expired ${Math.abs(cert.days_remaining)}d ago`
                              : `${cert.days_remaining}d`}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {cert.status === 'valid' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-500">
                            <CheckCircle2 className="h-3 w-3" /> Valid
                          </span>
                        )}
                        {cert.status === 'expiring' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-yellow-500/20 text-yellow-500">
                            <AlertCircle className="h-3 w-3" /> Expiring
                          </span>
                        )}
                        {cert.status === 'expired' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-500">
                            <XCircle className="h-3 w-3" /> Expired
                          </span>
                        )}
                        {cert.status === 'error' && (
                          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium bg-red-500/20 text-red-500">
                            <XCircle className="h-3 w-3" /> Error
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => renewCertMutation.mutate(cert.domain)}
                            disabled={renewCertMutation.isPending}
                            title={`Force renewal for ${cert.domain}`}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Route Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent onClose={() => setIsAddModalOpen(false)} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Proxy Route</DialogTitle>
            <DialogDescription>Configure a new reverse proxy route for an external service</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate}>
            {renderFormFields("add")}
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create Route'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Route Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent onClose={() => setIsEditModalOpen(false)} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Proxy Route</DialogTitle>
            <DialogDescription>Modify the proxy route configuration</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit}>
            {renderFormFields("edit")}
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DNS-01 Challenge Dialog */}
      <Dialog open={isDnsDialogOpen} onOpenChange={setIsDnsDialogOpen}>
        <DialogContent onClose={() => setIsDnsDialogOpen(false)} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileKey className="h-5 w-5" />
              DNS-01 Certificate Challenge
            </DialogTitle>
            <DialogDescription>
              {dnsRouteContext?.hostname && (
                <span>Request a Let's Encrypt certificate for <strong className="font-mono">{dnsRouteContext.hostname}</strong></span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {requestDnsMutation.isPending && (
              <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Requesting challenge from Let's Encrypt...</span>
              </div>
            )}

            {dnsChallenge && (
              <>
                <div className="rounded-lg bg-muted p-4 space-y-4">
                  <p className="text-sm font-medium">Add the following TXT record to your DNS:</p>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">TXT Record Name</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-background rounded text-sm font-mono break-all">
                        {dnsChallenge.txt_record_name}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(dnsChallenge.txt_record_name || '', 'TXT record name')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">TXT Record Value</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-background rounded text-sm font-mono break-all">
                        {dnsChallenge.txt_record_value}
                      </code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyToClipboard(dnsChallenge.txt_record_value || '', 'TXT record value')}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4 space-y-2">
                  <p className="text-sm font-medium">Steps:</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Go to your DNS provider's control panel</li>
                    <li>Add a TXT record with the name and value above</li>
                    <li>Wait for DNS propagation (may take a few minutes)</li>
                    <li>Click "Verify & Issue" below</li>
                  </ol>
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground">
                      To check propagation, run:{' '}
                      <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                        dig TXT {dnsChallenge.txt_record_name}
                      </code>
                    </p>
                  </div>
                </div>

                {verifyResult && (
                  <div className={`rounded-lg p-3 text-sm ${
                    verifyResult.success
                      ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                      : 'bg-red-500/10 text-red-500 border border-red-500/20'
                  }`}>
                    <div className="flex items-center gap-2">
                      {verifyResult.success ? (
                        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 flex-shrink-0" />
                      )}
                      <span>{verifyResult.message}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setIsDnsDialogOpen(false)}>
              {verifyResult?.success ? 'Done' : 'Cancel'}
            </Button>
            {dnsChallenge && !verifyResult?.success && (
              <Button
                onClick={handleVerifyDns}
                disabled={isVerifying}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify & Issue Certificate'
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config Preview Modal */}
      <Dialog open={isConfigPreviewOpen} onOpenChange={setIsConfigPreviewOpen}>
        <DialogContent onClose={() => setIsConfigPreviewOpen(false)} className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Configuration Preview</DialogTitle>
            <DialogDescription>Preview of generated Traefik dynamic YAML (routes.yml)</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <pre className="p-4 bg-muted rounded-lg text-xs overflow-auto max-h-[60vh] font-mono">
              {configPreview?.yaml_config || 'Loading...'}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfigPreviewOpen(false)}>Close</Button>
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? 'Applying...' : 'Apply Configuration'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
