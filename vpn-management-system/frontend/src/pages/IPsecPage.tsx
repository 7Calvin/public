import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ipsecApi } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { PageHeader } from '@/components/PageHeader'
import {
  Shield,
  ShieldOff,
  Trash2,
  Plus,
  Play,
  Square,
  RotateCcw,
  Network,
  Server,
  RefreshCw,
  Settings,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Pencil,
  FileText,
  Terminal,
} from 'lucide-react'
import type { IPsecConnection, IPsecStatus, IPsecConnectionCreate } from '@/types'

interface ConnectionForm {
  name: string
  description: string
  left_ip: string
  left_subnet: string
  left_id: string
  right_ip: string
  right_subnet: string
  right_id: string
  auth_method: string
  psk: string
  ike_version: string
  ike_cipher: string
  ike_lifetime: string
  esp_cipher: string
  key_lifetime: string
  auto_start: boolean
  dpd_action: string
  is_enabled: boolean
}

interface ServerInfo {
  private_ip: string | null
  public_ip: string | null
  local_subnet: string | null
  interface: string | null
}

const IKE_VERSION_OPTIONS = [
  { value: 'ikev2', label: 'IKEv2 (Recomendado)' },
  { value: 'ikev1', label: 'IKEv1 (Legado)' },
]

const DPD_ACTION_OPTIONS = [
  { value: 'restart', label: 'Restart - Reconectar em caso de falha' },
  { value: 'clear', label: 'Clear - Remover SA em caso de falha' },
  { value: 'hold', label: 'Hold - Continuar tentando' },
  { value: 'none', label: 'None - Desabilitar DPD' },
]

const IKE_CIPHER_PRESETS = [
  { value: 'aes256-sha256-modp2048', label: 'AES-256 SHA-256 DH-2048 (Recomendado)' },
  { value: 'aes256-sha256-modp4096', label: 'AES-256 SHA-256 DH-4096 (Forte)' },
  { value: 'aes128-sha256-modp2048', label: 'AES-128 SHA-256 DH-2048 (Rápido)' },
  { value: 'aes256-sha512-modp4096', label: 'AES-256 SHA-512 DH-4096 (Muito Forte)' },
]

const ESP_CIPHER_PRESETS = [
  { value: 'aes256-sha256', label: 'AES-256 SHA-256 (Recomendado - Sem PFS)' },
  { value: 'aes256-sha256-modp2048', label: 'AES-256 SHA-256 DH-2048 (Com PFS)' },
  { value: 'aes128-sha256', label: 'AES-128 SHA-256 (Rápido - Sem PFS)' },
  { value: 'aes256-sha1', label: 'AES-256 SHA-1 (Compatível com Legado)' },
]

const createInitialForm = (serverInfo?: ServerInfo): ConnectionForm => ({
  name: '',
  description: '',
  left_ip: serverInfo?.private_ip || '',
  left_subnet: serverInfo?.local_subnet || '',
  left_id: serverInfo?.public_ip || '',
  right_ip: '',
  right_subnet: '',
  right_id: '',
  auth_method: 'psk',
  psk: '',
  ike_version: 'ikev2',
  ike_cipher: 'aes256-sha256-modp2048',
  ike_lifetime: '8h',
  esp_cipher: 'aes256-sha256',
  key_lifetime: '1h',
  auto_start: true,
  dpd_action: 'restart',
  is_enabled: true,
})

export default function IPsecPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isConfigPreviewOpen, setIsConfigPreviewOpen] = useState(false)
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false)
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false)
  const [logsConnectionName, setLogsConnectionName] = useState<string | null>(null)
  const [formData, setFormData] = useState<ConnectionForm>(createInitialForm())
  const [editingConnection, setEditingConnection] = useState<IPsecConnection | null>(null)

  // Queries
  const { data: connectionsData, isLoading } = useQuery({
    queryKey: ['ipsec-connections'],
    queryFn: () => ipsecApi.list().then((res) => res.data),
  })

  const { data: status, refetch: refetchStatus } = useQuery<IPsecStatus>({
    queryKey: ['ipsec-status'],
    queryFn: () => ipsecApi.status().then((res) => res.data),
    refetchInterval: 10000,
  })

  const { data: configPreview } = useQuery({
    queryKey: ['ipsec-config-preview'],
    queryFn: () => ipsecApi.previewConfig().then((res) => res.data),
    enabled: isConfigPreviewOpen,
  })

  const { data: versionInfo } = useQuery({
    queryKey: ['ipsec-version'],
    queryFn: () => ipsecApi.version().then((res) => res.data),
  })

  const { data: serverInfo } = useQuery<ServerInfo>({
    queryKey: ['ipsec-server-info'],
    queryFn: () => ipsecApi.serverInfo().then((res) => res.data),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const { data: detailedStatus, refetch: refetchDetailedStatus, isFetching: isFetchingDetailedStatus } = useQuery({
    queryKey: ['ipsec-statusall'],
    queryFn: () => ipsecApi.statusAll().then((res) => res.data),
    enabled: isStatusModalOpen,
    refetchInterval: isStatusModalOpen ? 5000 : false,
  })

  const { data: logsData, refetch: refetchLogs, isFetching: isFetchingLogs } = useQuery({
    queryKey: ['ipsec-logs', logsConnectionName],
    queryFn: () => ipsecApi.logs(200, logsConnectionName || undefined).then((res) => res.data),
    enabled: isLogsModalOpen,
    refetchInterval: isLogsModalOpen ? 3000 : false,
  })

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: IPsecConnectionCreate) => ipsecApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-config-preview'] })
      toast({ title: 'Conexão criada com sucesso' })
      setIsAddModalOpen(false)
      setFormData(createInitialForm(serverInfo || undefined))
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      toast({
        variant: 'destructive',
        title: 'Falha ao criar conexão',
        description: error.response?.data?.detail || 'Erro desconhecido',
      })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<IPsecConnection> }) =>
      ipsecApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-config-preview'] })
      toast({ title: 'Conexão atualizada' })
      setIsEditModalOpen(false)
      setEditingConnection(null)
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      toast({
        variant: 'destructive',
        title: 'Falha ao atualizar conexão',
        description: error.response?.data?.detail || 'Erro desconhecido',
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => ipsecApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-config-preview'] })
      toast({ title: 'Conexão excluída' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Falha ao excluir conexão' })
    },
  })

  const startMutation = useMutation({
    mutationFn: (id: string) => ipsecApi.start(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-status'] })
      toast({ title: 'Túnel iniciado' })
    },
    onError: (error: Error & { response?: { data?: { detail?: string | { error?: string; suggestion?: string; error_type?: string } } } }) => {
      const detail = error.response?.data?.detail
      let errorMsg = 'Erro desconhecido'
      let suggestion = ''

      if (typeof detail === 'string') {
        errorMsg = detail
      } else if (detail && typeof detail === 'object') {
        errorMsg = detail.error || 'Erro desconhecido'
        suggestion = detail.suggestion || ''
      }

      toast({
        variant: 'destructive',
        title: 'Falha ao iniciar túnel',
        description: (
          <div className="space-y-1">
            <p>{errorMsg}</p>
            {suggestion && <p className="text-xs opacity-80">{suggestion}</p>}
          </div>
        ),
      })
    },
  })

  const stopMutation = useMutation({
    mutationFn: (id: string) => ipsecApi.stop(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-status'] })
      toast({ title: 'Túnel parado' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Falha ao parar túnel' })
    },
  })

  const restartMutation = useMutation({
    mutationFn: (id: string) => ipsecApi.restart(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-status'] })
      toast({ title: 'Túnel reiniciado' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Falha ao reiniciar túnel' })
    },
  })

  const applyMutation = useMutation({
    mutationFn: () => ipsecApi.apply(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-status'] })
      toast({ title: 'Configuração aplicada com sucesso' })
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      toast({
        variant: 'destructive',
        title: 'Falha ao aplicar configuração',
        description: error.response?.data?.detail || 'Erro desconhecido',
      })
    },
  })

  const syncStatusMutation = useMutation({
    mutationFn: () => ipsecApi.syncStatus(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipsec-connections'] })
      queryClient.invalidateQueries({ queryKey: ['ipsec-status'] })
      toast({ title: 'Status sincronizado' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Falha ao sincronizar status' })
    },
  })

  const connections: IPsecConnection[] = connectionsData?.items || []

  const getStatusIcon = (connectionStatus: string) => {
    switch (connectionStatus) {
      case 'active':
        return <CheckCircle2 className="h-4 w-4 text-success" />
      case 'connecting':
        return <Loader2 className="h-4 w-4 text-warning animate-spin" />
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getStatusColor = (connectionStatus: string) => {
    switch (connectionStatus) {
      case 'active':
        return 'bg-success/20 text-success'
      case 'connecting':
        return 'bg-warning/20 text-warning'
      case 'error':
        return 'bg-destructive/20 text-destructive'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const handleCreateConnection = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      toast({ variant: 'destructive', title: 'O nome da conexão é obrigatório' })
      return
    }
    if (!formData.psk.trim()) {
      toast({ variant: 'destructive', title: 'A chave pré-compartilhada é obrigatória' })
      return
    }
    createMutation.mutate(formData as unknown as IPsecConnectionCreate)
  }

  const handleEditConnection = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingConnection) return

    if (!formData.name.trim()) {
      toast({ variant: 'destructive', title: 'O nome da conexão é obrigatório' })
      return
    }

    const updateData: Partial<ConnectionForm> = {
      name: formData.name,
      description: formData.description,
      left_ip: formData.left_ip,
      left_subnet: formData.left_subnet,
      left_id: formData.left_id,
      right_ip: formData.right_ip,
      right_subnet: formData.right_subnet,
      right_id: formData.right_id,
      auth_method: formData.auth_method,
      ike_version: formData.ike_version,
      ike_cipher: formData.ike_cipher,
      ike_lifetime: formData.ike_lifetime,
      esp_cipher: formData.esp_cipher,
      key_lifetime: formData.key_lifetime,
      auto_start: formData.auto_start,
      dpd_action: formData.dpd_action,
      is_enabled: formData.is_enabled,
    }

    if (formData.psk && formData.psk !== '********') {
      updateData.psk = formData.psk
    }

    updateMutation.mutate({
      id: editingConnection.id,
      data: updateData as Partial<IPsecConnection>,
    })
  }

  const handleToggleEnabled = (conn: IPsecConnection) => {
    updateMutation.mutate({ id: conn.id, data: { is_enabled: !conn.is_enabled } })
  }

  const openEditModal = (conn: IPsecConnection) => {
    setEditingConnection(conn)
    setFormData({
      name: conn.name,
      description: conn.description || '',
      left_ip: conn.left_ip,
      left_subnet: conn.left_subnet,
      left_id: conn.left_id,
      right_ip: conn.right_ip,
      right_subnet: conn.right_subnet,
      right_id: conn.right_id,
      auth_method: conn.auth_method || 'psk',
      psk: '********',
      ike_version: conn.ike_version || 'ikev2',
      ike_cipher: conn.ike_cipher || 'aes256-sha256-modp2048',
      ike_lifetime: conn.ike_lifetime || '8h',
      esp_cipher: conn.esp_cipher || 'aes256-sha256',
      key_lifetime: conn.key_lifetime || '1h',
      auto_start: conn.auto_start ?? true,
      dpd_action: conn.dpd_action || 'restart',
      is_enabled: conn.is_enabled ?? true,
    })
    setIsEditModalOpen(true)
  }

  const openAddModal = () => {
    setFormData(createInitialForm(serverInfo || undefined))
    setIsAddModalOpen(true)
  }

  const getLiveStatus = (name: string) => {
    return status?.connections?.find((c) => c.name === name)
  }

  const openLogsForConnection = (connectionName: string) => {
    setLogsConnectionName(connectionName)
    setIsLogsModalOpen(true)
  }

  const openAllLogs = () => {
    setLogsConnectionName(null)
    setIsLogsModalOpen(true)
  }

  // Form field change handler
  const updateField = (field: keyof ConnectionForm, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="IPsec"
        subtitle="Túneis site-to-site (StrongSwan)"
        actions={
          <>
            <Button variant="outline" onClick={() => setIsConfigPreviewOpen(true)}>
              <Eye className="h-4 w-4 mr-2" />
              Visualizar Configuração
            </Button>
            <Button
              variant="outline"
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
            >
              <Settings className="h-4 w-4 mr-2" />
              Aplicar Configuração
            </Button>
            <Button onClick={openAddModal}>
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Conexão
            </Button>
          </>
        }
      />

      {/* Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Status do StrongSwan
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsStatusModalOpen(true)}
              >
                <Terminal className="h-4 w-4 mr-1" />
                Status
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={openAllLogs}
              >
                <FileText className="h-4 w-4 mr-1" />
                Todos os Logs
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => syncStatusMutation.mutate()}
                disabled={syncStatusMutation.isPending}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${syncStatusMutation.isPending ? 'animate-spin' : ''}`} />
                Sincronizar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetchStatus()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-5">
            <div>
              <p className="text-sm text-muted-foreground">StrongSwan</p>
              <p className={status?.strongswan_running ? 'text-success font-medium' : 'text-destructive'}>
                {status?.strongswan_running ? 'Em execução' : 'Parado'}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Versão</p>
              <p className="font-medium">{versionInfo?.version || 'Desconhecida'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Conexões</p>
              <p className="font-medium">{status?.total_connections || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Túneis Ativos</p>
              <p className="font-medium text-success">{status?.active_tunnels || 0}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Configurados</p>
              <p className="font-medium">{connections.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connections Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Conexões IPsec
          </CardTitle>
          <CardDescription>
            {connections.length} conex{connections.length !== 1 ? 'ões' : 'ão'} configurada{connections.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : connections.length === 0 ? (
            <div className="text-center py-8">
              <Network className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">Nenhuma conexão IPsec configurada</p>
              <Button onClick={openAddModal}>
                <Plus className="h-4 w-4 mr-2" />
                Adicionar sua Primeira Conexão
              </Button>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Nome</th>
                    <th className="px-4 py-3 text-left">Peer Remoto</th>
                    <th className="px-4 py-3 text-left">Sub-redes</th>
                    <th className="px-4 py-3 text-left">IKE</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Status ao Vivo</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((conn) => {
                    const liveStatus = getLiveStatus(conn.name)
                    return (
                      <tr key={conn.id} className="border-b hover:bg-muted/50">
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium">{conn.name}</p>
                            {conn.description && (
                              <p className="text-xs text-muted-foreground">{conn.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <div>
                            <p>{conn.right_ip}</p>
                            <p className="text-muted-foreground">ID: {conn.right_id}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <div>
                            <p className="text-muted-foreground">Local: {conn.left_subnet}</p>
                            <p className="text-muted-foreground">Remota: {conn.right_subnet}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 uppercase text-xs">{conn.ike_version}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleToggleEnabled(conn)}
                            disabled={updateMutation.isPending}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                              conn.is_enabled
                                ? 'bg-success/20 text-success hover:bg-success/30'
                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}
                          >
                            {conn.is_enabled ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                            {conn.is_enabled ? 'Habilitada' : 'Desabilitada'}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {liveStatus ? (
                            <div>
                              {/* Tunnel Status Badge */}
                              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${
                                liveStatus.tunnel_status === 'UP'
                                  ? 'bg-success/20 text-success'
                                  : liveStatus.tunnel_status === 'IKE_ONLY'
                                  ? 'bg-warning/20 text-warning'
                                  : liveStatus.tunnel_status === 'CONNECTING'
                                  ? 'bg-primary/20 text-primary'
                                  : 'bg-muted text-muted-foreground'
                              }`}>
                                {liveStatus.tunnel_status === 'UP' ? (
                                  <CheckCircle2 className="h-3 w-3" />
                                ) : liveStatus.tunnel_status === 'IKE_ONLY' ? (
                                  <AlertCircle className="h-3 w-3" />
                                ) : liveStatus.tunnel_status === 'CONNECTING' ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <XCircle className="h-3 w-3" />
                                )}
                                <span>
                                  {liveStatus.tunnel_status === 'UP' ? 'Túnel ATIVO'
                                    : liveStatus.tunnel_status === 'IKE_ONLY' ? 'Apenas IKE'
                                    : liveStatus.tunnel_status === 'CONNECTING' ? 'Conectando'
                                    : 'Inativo'}
                                </span>
                              </div>
                              {/* Uptime */}
                              {liveStatus.uptime && liveStatus.tunnel_status === 'UP' && (
                                <p className="text-xs text-muted-foreground mt-1">Ativo há: {liveStatus.uptime}</p>
                              )}
                              {/* Traffic stats */}
                              {liveStatus.tunnel_status === 'UP' && (liveStatus.bytes_in !== undefined || liveStatus.bytes_out !== undefined) && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {liveStatus.bytes_in || 0} B entrada / {liveStatus.bytes_out || 0} B saída
                                </p>
                              )}
                              {/* Error hint for IKE_ONLY */}
                              {liveStatus.tunnel_status === 'IKE_ONLY' && liveStatus.error_hint && (
                                <p className="text-xs text-warning mt-1 max-w-[200px]" title={liveStatus.error_hint}>
                                  {liveStatus.error_hint}
                                </p>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${getStatusColor(conn.status)}`}>
                                {getStatusIcon(conn.status)}
                                <span className="capitalize">{conn.status}</span>
                              </div>
                              {conn.last_error && conn.status === 'error' && (
                                <p className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={conn.last_error}>
                                  {conn.last_error}
                                </p>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openLogsForConnection(conn.name)}
                              title="Ver logs desta conexão"
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => openEditModal(conn)} title="Editar conexão">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {conn.status === 'active' ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => restartMutation.mutate(conn.id)}
                                  disabled={restartMutation.isPending}
                                  title="Reiniciar túnel"
                                >
                                  <RotateCcw className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => stopMutation.mutate(conn.id)}
                                  disabled={stopMutation.isPending}
                                  title="Parar túnel"
                                >
                                  <Square className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => startMutation.mutate(conn.id)}
                                disabled={startMutation.isPending || !conn.is_enabled}
                                title="Iniciar túnel"
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteMutation.mutate(conn.id)}
                              disabled={deleteMutation.isPending}
                              className="text-destructive hover:text-destructive"
                              title="Excluir conexão"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Connection Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent onClose={() => setIsAddModalOpen(false)} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Adicionar Conexão IPsec</DialogTitle>
            <DialogDescription>Configure um novo túnel VPN IPsec site-to-site</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateConnection}>
            <div className="space-y-6 mt-4">
              {/* Connection Details */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Detalhes da Conexão</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="add-name">Nome da Conexão *</Label>
                    <Input
                      id="add-name"
                      value={formData.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder="IPSECtoOffice"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-description">Descrição</Label>
                    <Input
                      id="add-description"
                      value={formData.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      placeholder="VPN para o escritório principal"
                    />
                  </div>
                </div>
              </div>

              {/* Local Gateway */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Gateway Local (Este Servidor)</h3>
                  {serverInfo?.private_ip && (
                    <span className="text-xs text-success bg-success/10 px-2 py-1 rounded">Detectado automaticamente</span>
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="add-left_ip">IP Privado</Label>
                    <Input
                      id="add-left_ip"
                      value={formData.left_ip}
                      onChange={(e) => updateField('left_ip', e.target.value)}
                      placeholder="10.30.1.254"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-left_subnet">Sub-rede Local</Label>
                    <Input
                      id="add-left_subnet"
                      value={formData.left_subnet}
                      onChange={(e) => updateField('left_subnet', e.target.value)}
                      placeholder="10.30.0.0/16"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-left_id">IP Público / ID</Label>
                    <Input
                      id="add-left_id"
                      value={formData.left_id}
                      onChange={(e) => updateField('left_id', e.target.value)}
                      placeholder="54.94.19.176"
                      className="bg-background"
                    />
                  </div>
                </div>
              </div>

              {/* Remote Gateway */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Gateway Remoto (Peer)</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="add-right_ip">IP Público *</Label>
                    <Input
                      id="add-right_ip"
                      value={formData.right_ip}
                      onChange={(e) => updateField('right_ip', e.target.value)}
                      placeholder="187.92.78.242"
                    />
                    <p className="text-xs text-muted-foreground">IP público do peer remoto</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-right_subnet">Sub-rede(s) Remota(s) *</Label>
                    <Input
                      id="add-right_subnet"
                      value={formData.right_subnet}
                      onChange={(e) => updateField('right_subnet', e.target.value)}
                      placeholder="10.0.0.0/24, 192.168.1.0/24"
                    />
                    <p className="text-xs text-muted-foreground">Use vírgula para separar múltiplas sub-redes</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-right_id">ID do Peer</Label>
                    <Input
                      id="add-right_id"
                      value={formData.right_id}
                      onChange={(e) => updateField('right_id', e.target.value)}
                      placeholder="187.92.78.242"
                    />
                    <p className="text-xs text-muted-foreground">Geralmente igual ao IP público</p>
                  </div>
                </div>
              </div>

              {/* Authentication */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Autenticação</h3>
                <div className="space-y-2">
                  <Label htmlFor="add-psk">Chave Pré-Compartilhada (PSK) *</Label>
                  <Input
                    id="add-psk"
                    type="password"
                    value={formData.psk}
                    onChange={(e) => updateField('psk', e.target.value)}
                    placeholder="Digite um segredo compartilhado forte"
                  />
                  <p className="text-xs text-muted-foreground">Mínimo de 8 caracteres. Deve corresponder em ambos os lados.</p>
                </div>
              </div>

              {/* Encryption Settings */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Configurações de Criptografia</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="add-ike_version">Versão IKE</Label>
                    <Select
                      id="add-ike_version"
                      value={formData.ike_version}
                      onChange={(e) => updateField('ike_version', e.target.value)}
                      options={IKE_VERSION_OPTIONS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-dpd_action">Ação DPD</Label>
                    <Select
                      id="add-dpd_action"
                      value={formData.dpd_action}
                      onChange={(e) => updateField('dpd_action', e.target.value)}
                      options={DPD_ACTION_OPTIONS}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="add-ike_cipher">Cifra IKE (Fase 1)</Label>
                    <Select
                      id="add-ike_cipher"
                      value={formData.ike_cipher}
                      onChange={(e) => updateField('ike_cipher', e.target.value)}
                      options={IKE_CIPHER_PRESETS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-esp_cipher">Cifra ESP (Fase 2)</Label>
                    <Select
                      id="add-esp_cipher"
                      value={formData.esp_cipher}
                      onChange={(e) => updateField('esp_cipher', e.target.value)}
                      options={ESP_CIPHER_PRESETS}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="add-ike_lifetime">Tempo de Vida IKE</Label>
                    <Input
                      id="add-ike_lifetime"
                      value={formData.ike_lifetime}
                      onChange={(e) => updateField('ike_lifetime', e.target.value)}
                      placeholder="8h"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="add-key_lifetime">Tempo de Vida da Chave</Label>
                    <Input
                      id="add-key_lifetime"
                      value={formData.key_lifetime}
                      onChange={(e) => updateField('key_lifetime', e.target.value)}
                      placeholder="1h"
                    />
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Opções</h3>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.auto_start}
                      onChange={(e) => updateField('auto_start', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Iniciar automaticamente no boot</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_enabled}
                      onChange={(e) => updateField('is_enabled', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Habilitado</span>
                  </label>
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Criando...' : 'Criar Conexão'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Connection Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent onClose={() => setIsEditModalOpen(false)} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Conexão IPsec</DialogTitle>
            <DialogDescription>Modifique a configuração da conexão IPsec</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditConnection}>
            <div className="space-y-6 mt-4">
              {/* Connection Details */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Detalhes da Conexão</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-name">Nome da Conexão *</Label>
                    <Input
                      id="edit-name"
                      value={formData.name}
                      onChange={(e) => updateField('name', e.target.value)}
                      placeholder="IPSECtoOffice"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-description">Descrição</Label>
                    <Input
                      id="edit-description"
                      value={formData.description}
                      onChange={(e) => updateField('description', e.target.value)}
                      placeholder="VPN para o escritório principal"
                    />
                  </div>
                </div>
              </div>

              {/* Local Gateway */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Gateway Local (Este Servidor)</h3>
                  {serverInfo?.private_ip && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (serverInfo) {
                          updateField('left_ip', serverInfo.private_ip || '')
                          updateField('left_subnet', serverInfo.local_subnet || '')
                          updateField('left_id', serverInfo.public_ip || '')
                        }
                      }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Detectar automaticamente
                    </Button>
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-left_ip">IP Privado</Label>
                    <Input
                      id="edit-left_ip"
                      value={formData.left_ip}
                      onChange={(e) => updateField('left_ip', e.target.value)}
                      placeholder="10.30.1.254"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-left_subnet">Sub-rede Local</Label>
                    <Input
                      id="edit-left_subnet"
                      value={formData.left_subnet}
                      onChange={(e) => updateField('left_subnet', e.target.value)}
                      placeholder="10.30.0.0/16"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-left_id">IP Público / ID</Label>
                    <Input
                      id="edit-left_id"
                      value={formData.left_id}
                      onChange={(e) => updateField('left_id', e.target.value)}
                      placeholder="54.94.19.176"
                      className="bg-background"
                    />
                  </div>
                </div>
              </div>

              {/* Remote Gateway */}
              <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Gateway Remoto (Peer)</h3>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="edit-right_ip">IP Público *</Label>
                    <Input
                      id="edit-right_ip"
                      value={formData.right_ip}
                      onChange={(e) => updateField('right_ip', e.target.value)}
                      placeholder="187.92.78.242"
                    />
                    <p className="text-xs text-muted-foreground">IP público do peer remoto</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-right_subnet">Sub-rede(s) Remota(s) *</Label>
                    <Input
                      id="edit-right_subnet"
                      value={formData.right_subnet}
                      onChange={(e) => updateField('right_subnet', e.target.value)}
                      placeholder="10.0.0.0/24, 192.168.1.0/24"
                    />
                    <p className="text-xs text-muted-foreground">Use vírgula para separar múltiplas sub-redes</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-right_id">ID do Peer</Label>
                    <Input
                      id="edit-right_id"
                      value={formData.right_id}
                      onChange={(e) => updateField('right_id', e.target.value)}
                      placeholder="187.92.78.242"
                    />
                    <p className="text-xs text-muted-foreground">Geralmente igual ao IP público</p>
                  </div>
                </div>
              </div>

              {/* Authentication */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Autenticação</h3>
                <div className="space-y-2">
                  <Label htmlFor="edit-psk">Chave Pré-Compartilhada (PSK)</Label>
                  <Input
                    id="edit-psk"
                    type="password"
                    value={formData.psk}
                    onChange={(e) => updateField('psk', e.target.value)}
                    placeholder="Deixe inalterado ou digite uma nova chave"
                  />
                  <p className="text-xs text-muted-foreground">Deixe como ******** para manter a chave atual, ou digite uma nova</p>
                </div>
              </div>

              {/* Encryption Settings */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Configurações de Criptografia</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-ike_version">Versão IKE</Label>
                    <Select
                      id="edit-ike_version"
                      value={formData.ike_version}
                      onChange={(e) => updateField('ike_version', e.target.value)}
                      options={IKE_VERSION_OPTIONS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-dpd_action">Ação DPD</Label>
                    <Select
                      id="edit-dpd_action"
                      value={formData.dpd_action}
                      onChange={(e) => updateField('dpd_action', e.target.value)}
                      options={DPD_ACTION_OPTIONS}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-ike_cipher">Cifra IKE (Fase 1)</Label>
                    <Select
                      id="edit-ike_cipher"
                      value={formData.ike_cipher}
                      onChange={(e) => updateField('ike_cipher', e.target.value)}
                      options={IKE_CIPHER_PRESETS}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-esp_cipher">Cifra ESP (Fase 2)</Label>
                    <Select
                      id="edit-esp_cipher"
                      value={formData.esp_cipher}
                      onChange={(e) => updateField('esp_cipher', e.target.value)}
                      options={ESP_CIPHER_PRESETS}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="edit-ike_lifetime">Tempo de Vida IKE</Label>
                    <Input
                      id="edit-ike_lifetime"
                      value={formData.ike_lifetime}
                      onChange={(e) => updateField('ike_lifetime', e.target.value)}
                      placeholder="8h"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-key_lifetime">Tempo de Vida da Chave</Label>
                    <Input
                      id="edit-key_lifetime"
                      value={formData.key_lifetime}
                      onChange={(e) => updateField('key_lifetime', e.target.value)}
                      placeholder="1h"
                    />
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">Opções</h3>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.auto_start}
                      onChange={(e) => updateField('auto_start', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Iniciar automaticamente no boot</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_enabled}
                      onChange={(e) => updateField('is_enabled', e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm">Habilitado</span>
                  </label>
                </div>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Config Preview Modal */}
      <Dialog open={isConfigPreviewOpen} onOpenChange={setIsConfigPreviewOpen}>
        <DialogContent onClose={() => setIsConfigPreviewOpen(false)} className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Visualização da Configuração</DialogTitle>
            <DialogDescription>Prévia dos arquivos ipsec.conf e ipsec.secrets gerados</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <h3 className="font-medium mb-2">ipsec.conf</h3>
              <pre className="p-4 bg-muted rounded-lg text-xs overflow-auto max-h-60 font-mono">
                {configPreview?.ipsec_conf || 'Carregando...'}
              </pre>
            </div>
            <div>
              <h3 className="font-medium mb-2">ipsec.secrets</h3>
              <pre className="p-4 bg-muted rounded-lg text-xs overflow-auto max-h-40 font-mono">
                {configPreview?.ipsec_secrets || 'Carregando...'}
              </pre>
              <p className="text-xs text-muted-foreground mt-1">Aviso: Contém valores sensíveis de PSK</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConfigPreviewOpen(false)}>Fechar</Button>
            <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? 'Aplicando...' : 'Aplicar Configuração'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IPsec Status Modal */}
      <Dialog open={isStatusModalOpen} onOpenChange={setIsStatusModalOpen}>
        <DialogContent onClose={() => setIsStatusModalOpen(false)} className="max-w-4xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Status do IPsec
            </DialogTitle>
            <DialogDescription>
              Saída detalhada do status do StrongSwan (ipsec statusall)
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isFetchingDetailedStatus && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Atualizando...</span>
                  </>
                )}
                {!isFetchingDetailedStatus && (
                  <span>Atualização automática a cada 5s</span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => refetchDetailedStatus()}>
                <RefreshCw className={`h-4 w-4 ${isFetchingDetailedStatus ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <pre className="p-4 bg-black text-success rounded-lg text-xs overflow-auto max-h-[60vh] font-mono whitespace-pre-wrap">
              {detailedStatus?.success === false
                ? `Erro: ${detailedStatus?.output || 'Erro desconhecido'}`
                : detailedStatus?.output || detailedStatus?.stdout || 'Carregando...'}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsStatusModalOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IPsec Logs Modal */}
      <Dialog open={isLogsModalOpen} onOpenChange={(open) => { setIsLogsModalOpen(open); if (!open) setLogsConnectionName(null); }}>
        <DialogContent onClose={() => { setIsLogsModalOpen(false); setLogsConnectionName(null); }} className="max-w-4xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {logsConnectionName ? `Logs: ${logsConnectionName}` : 'Todos os Logs do StrongSwan'}
            </DialogTitle>
            <DialogDescription>
              {logsConnectionName
                ? `Entradas de log da conexão "${logsConnectionName}"`
                : 'Todas as entradas recentes de log do IPsec/StrongSwan'}
              {logsData?.source && <span className="ml-1">({logsData.source})</span>}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isFetchingLogs && (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Atualizando...</span>
                  </>
                )}
                {!isFetchingLogs && (
                  <span>Atualização automática a cada 3s (Ao Vivo)</span>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={() => refetchLogs()}>
                <RefreshCw className={`h-4 w-4 ${isFetchingLogs ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <pre className="p-4 bg-black text-gray-300 rounded-lg text-xs overflow-auto max-h-[60vh] font-mono whitespace-pre-wrap">
              {logsData?.success === false
                ? `Erro: ${logsData?.logs || 'Não foi possível obter os logs'}`
                : logsData?.logs || 'Carregando logs...'}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLogsModalOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
