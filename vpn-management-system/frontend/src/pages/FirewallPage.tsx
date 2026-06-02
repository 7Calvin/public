import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { firewallApi } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { formatDate } from '@/lib/utils'
import { Shield, ShieldOff, Trash2, Zap, Users, Network, GripVertical, Plus, ArrowRight, Server } from 'lucide-react'
import type { FirewallRule } from '@/types'

interface QuickRuleStatus {
  exists: boolean
  is_active: boolean
  id: string | null
  description: string
}

interface QuickRulesResponse {
  [key: string]: QuickRuleStatus
}

interface NewRuleForm {
  name: string
  description: string
  action: string
  protocol: string
  source_network: string
  destination_network: string
  destination_port_range: string
  priority: number
}

interface NATRule {
  id: string
  name: string
  description?: string
  nat_type: string
  protocol: string
  external_port: number
  internal_ip: string
  internal_port: number
  source_network?: string
  is_active: boolean
  created_at: string
}

interface NewDNATForm {
  name: string
  description: string
  protocol: string
  external_port: string
  internal_ip: string
  internal_port: string
}

const QUICK_RULE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  'block-client-to-client': {
    label: 'Block Client-to-Client',
    icon: Users,
    color: 'text-red-500',
  },
  'allow-internal-network': {
    label: 'Allow Internal Communications',
    icon: Network,
    color: 'text-green-500',
  },
}

const ACTION_OPTIONS = [
  { value: 'accept', label: 'Accept - Allow traffic' },
  { value: 'drop', label: 'Drop - Silently discard' },
  { value: 'reject', label: 'Reject - Discard with response' },
  { value: 'limit', label: 'Limit - Rate limit traffic' },
]

const PROTOCOL_OPTIONS = [
  { value: 'all', label: 'All Protocols' },
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'icmp', label: 'ICMP' },
]

const DNAT_PROTOCOL_OPTIONS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
]

// Common service presets for DNAT wizard
const SERVICE_PRESETS = [
  { name: 'HTTP', port: 80, protocol: 'tcp' },
  { name: 'HTTPS', port: 443, protocol: 'tcp' },
  { name: 'SSH', port: 22, protocol: 'tcp' },
  { name: 'RDP', port: 3389, protocol: 'tcp' },
  { name: 'MySQL', port: 3306, protocol: 'tcp' },
  { name: 'PostgreSQL', port: 5432, protocol: 'tcp' },
  { name: 'Redis', port: 6379, protocol: 'tcp' },
  { name: 'MongoDB', port: 27017, protocol: 'tcp' },
]

const initialFormState: NewRuleForm = {
  name: '',
  description: '',
  action: 'accept',
  protocol: 'all',
  source_network: '',
  destination_network: '',
  destination_port_range: '',
  priority: 100,
}

const initialDNATFormState: NewDNATForm = {
  name: '',
  description: '',
  protocol: 'tcp',
  external_port: '',
  internal_ip: '',
  internal_port: '',
}

export default function FirewallPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isDNATModalOpen, setIsDNATModalOpen] = useState(false)
  const [newRule, setNewRule] = useState<NewRuleForm>(initialFormState)
  const [newDNAT, setNewDNAT] = useState<NewDNATForm>(initialDNATFormState)

  const { data: rules, isLoading } = useQuery({
    queryKey: ['firewall-rules'],
    queryFn: () => firewallApi.listRules().then((res) => res.data),
  })

  const { data: status } = useQuery({
    queryKey: ['firewall-status'],
    queryFn: () => firewallApi.getStatus().then((res) => res.data),
  })

  const { data: quickRules } = useQuery<QuickRulesResponse>({
    queryKey: ['firewall-quick-rules'],
    queryFn: () => firewallApi.getQuickRules().then((res) => res.data),
  })

  const { data: natRules, isLoading: isLoadingNAT } = useQuery<NATRule[]>({
    queryKey: ['nat-rules'],
    queryFn: () => firewallApi.listNatRules().then((res) => res.data),
  })

  // Helper to apply rules after changes
  const applyRulesAfterChange = async () => {
    try {
      await firewallApi.apply()
      queryClient.invalidateQueries({ queryKey: ['firewall-status'] })
    } catch {
      // Silent fail - rules are saved, just not applied to nftables
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => firewallApi.deleteRule(id),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      queryClient.invalidateQueries({ queryKey: ['firewall-quick-rules'] })
      toast({ title: 'Rule deleted' })
      await applyRulesAfterChange()
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete rule' })
    },
  })

  const toggleRuleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      firewallApi.updateRule(id, { is_active: isActive }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      queryClient.invalidateQueries({ queryKey: ['firewall-quick-rules'] })
      toast({ title: 'Rule status updated' })
      await applyRulesAfterChange()
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update rule' })
    },
  })

  const updatePriorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: number }) =>
      firewallApi.updateRule(id, { priority }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      toast({ title: 'Rule order updated' })
      await applyRulesAfterChange()
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update order' })
    },
  })

  const quickRuleToggleMutation = useMutation({
    mutationFn: (ruleKey: string) => firewallApi.toggleQuickRule(ruleKey),
    onSuccess: async (_, ruleKey) => {
      queryClient.invalidateQueries({ queryKey: ['firewall-quick-rules'] })
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      const config = QUICK_RULE_CONFIG[ruleKey]
      toast({ title: `${config?.label || ruleKey} toggled` })
      await applyRulesAfterChange()
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to toggle rule' })
    },
  })

  const createRuleMutation = useMutation({
    mutationFn: (data: NewRuleForm) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        description: data.description || undefined,
        action: data.action,
        protocol: data.protocol,
        priority: data.priority,
      }
      if (data.source_network) payload.source_network = data.source_network
      if (data.destination_network) payload.destination_network = data.destination_network
      if (data.destination_port_range) payload.destination_port_range = data.destination_port_range
      return firewallApi.createRule(payload as Parameters<typeof firewallApi.createRule>[0])
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      toast({ title: 'Rule created successfully' })
      setIsAddModalOpen(false)
      setNewRule(initialFormState)
      await applyRulesAfterChange()
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create rule',
        description: error.response?.data?.detail || 'Unknown error',
      })
    },
  })

  const createDNATMutation = useMutation({
    mutationFn: (data: NewDNATForm) => {
      return firewallApi.createNatRule({
        name: data.name,
        description: data.description || undefined,
        protocol: data.protocol,
        external_port: parseInt(data.external_port),
        internal_ip: data.internal_ip,
        internal_port: parseInt(data.internal_port),
      })
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['nat-rules'] })
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      toast({ title: 'Port forwarding rule created' })
      setIsDNATModalOpen(false)
      setNewDNAT(initialDNATFormState)
      await applyRulesAfterChange()
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create rule',
        description: error.response?.data?.detail || 'Unknown error',
      })
    },
  })

  const toggleNATMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      firewallApi.updateNatRule(id, { is_active: isActive }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['nat-rules'] })
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      toast({ title: 'NAT rule status updated' })
      await applyRulesAfterChange()
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to update rule' })
    },
  })

  const deleteNATMutation = useMutation({
    mutationFn: (id: string) => firewallApi.deleteNatRule(id),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ['nat-rules'] })
      queryClient.invalidateQueries({ queryKey: ['firewall-rules'] })
      toast({ title: 'NAT rule deleted' })
      await applyRulesAfterChange()
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Failed to delete rule' })
    },
  })

  const ruleList: FirewallRule[] = Array.isArray(rules) ? rules : rules?.items || []
  const sortedRules = [...ruleList].sort((a, b) => a.priority - b.priority)
  const natRuleList: NATRule[] = natRules || []

  const getActionColor = (action: string) => {
    switch (action) {
      case 'accept':
        return 'bg-green-500/20 text-green-500'
      case 'drop':
        return 'bg-red-500/20 text-red-500'
      case 'reject':
        return 'bg-orange-500/20 text-orange-500'
      case 'limit':
        return 'bg-yellow-500/20 text-yellow-500'
      default:
        return 'bg-muted text-muted-foreground'
    }
  }

  const handleDragStart = (e: React.DragEvent, ruleId: string) => {
    setDraggedId(ruleId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = (e: React.DragEvent, targetRule: FirewallRule) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetRule.id) {
      setDraggedId(null)
      return
    }

    const draggedRule = sortedRules.find((r) => r.id === draggedId)
    if (!draggedRule) {
      setDraggedId(null)
      return
    }

    const targetIndex = sortedRules.findIndex((r) => r.id === targetRule.id)
    const draggedIndex = sortedRules.findIndex((r) => r.id === draggedId)

    let newPriority: number
    if (targetIndex === 0) {
      newPriority = Math.max(1, targetRule.priority - 1)
    } else if (targetIndex === sortedRules.length - 1) {
      newPriority = targetRule.priority + 1
    } else {
      if (draggedIndex < targetIndex) {
        const nextRule = sortedRules[targetIndex + 1]
        newPriority = Math.floor((targetRule.priority + (nextRule?.priority || targetRule.priority + 2)) / 2)
      } else {
        const prevRule = sortedRules[targetIndex - 1]
        newPriority = Math.floor(((prevRule?.priority || 0) + targetRule.priority) / 2)
      }
    }

    if (newPriority === targetRule.priority) {
      newPriority = draggedIndex < targetIndex ? targetRule.priority + 1 : targetRule.priority
    }

    updatePriorityMutation.mutate({ id: draggedId, priority: newPriority })
    setDraggedId(null)
  }

  const handleDragEnd = () => {
    setDraggedId(null)
  }

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newRule.name.trim()) {
      toast({ variant: 'destructive', title: 'Rule name is required' })
      return
    }
    createRuleMutation.mutate(newRule)
  }

  const handleCreateDNAT = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDNAT.name.trim()) {
      toast({ variant: 'destructive', title: 'Rule name is required' })
      return
    }
    if (!newDNAT.external_port || !newDNAT.internal_ip || !newDNAT.internal_port) {
      toast({ variant: 'destructive', title: 'All port and IP fields are required' })
      return
    }
    createDNATMutation.mutate(newDNAT)
  }

  const applyServicePreset = (preset: typeof SERVICE_PRESETS[0]) => {
    setNewDNAT({
      ...newDNAT,
      name: `forward-${preset.name.toLowerCase()}`,
      description: `Forward ${preset.name} to internal server`,
      protocol: preset.protocol,
      external_port: String(preset.port),
      internal_port: String(preset.port),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Firewall</h1>
          <p className="text-muted-foreground">Manage firewall rules and port forwarding</p>
        </div>
      </div>

      {/* Status */}
      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Firewall Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">Engine</p>
                <p className="font-medium">{status.engine || 'nftables'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className={status.is_active ? 'text-green-500' : 'text-red-500'}>
                  {status.is_active ? 'Active' : 'Inactive'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Rules</p>
                <p>{status.active_rules || 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Last Applied</p>
                <p className="text-muted-foreground">
                  {status.last_applied ? formatDate(status.last_applied) : 'Never'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Rules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Quick Rules
          </CardTitle>
          <CardDescription>Toggle common firewall rules with one click</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {Object.entries(QUICK_RULE_CONFIG).map(([key, config]) => {
              const ruleStatus = quickRules?.[key]
              const isEnabled = ruleStatus?.exists || false
              const Icon = config.icon

              return (
                <div
                  key={key}
                  className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                    isEnabled ? 'bg-primary/10 border-primary' : 'bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Icon className={`h-5 w-5 flex-shrink-0 ${isEnabled ? config.color : 'text-muted-foreground'}`} />
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{config.label}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {ruleStatus?.description || 'Loading...'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => quickRuleToggleMutation.mutate(key)}
                    disabled={quickRuleToggleMutation.isPending}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 ml-3 items-center rounded-full transition-colors ${
                      isEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Note: Click "Apply Rules" to activate changes on the firewall.
          </p>
        </CardContent>
      </Card>

      {/* Port Forwarding (DNAT) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Port Forwarding (DNAT)
            </CardTitle>
            <CardDescription>Forward external ports to internal servers on the private network</CardDescription>
          </div>
          <Button onClick={() => setIsDNATModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Forwarding
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingNAT ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : natRuleList.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">No port forwarding rules configured</p>
              <Button variant="outline" onClick={() => setIsDNATModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Forwarding Rule
              </Button>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">External Port</th>
                    <th className="px-4 py-3 text-left"></th>
                    <th className="px-4 py-3 text-left">Internal Destination</th>
                    <th className="px-4 py-3 text-left">Protocol</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {natRuleList.map((rule) => (
                    <tr key={rule.id} className="border-b hover:bg-muted/50">
                      <td className="px-4 py-3 font-medium">{rule.name}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {rule.description || '-'}
                      </td>
                      <td className="px-4 py-3 font-mono">{rule.external_port}</td>
                      <td className="px-4 py-3">
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {rule.internal_ip}:{rule.internal_port}
                      </td>
                      <td className="px-4 py-3 uppercase">{rule.protocol}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleNATMutation.mutate({ id: rule.id, isActive: !rule.is_active })}
                          disabled={toggleNATMutation.isPending}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                            rule.is_active
                              ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          {rule.is_active ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                          {rule.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteNATMutation.mutate(rule.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Rules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Firewall Rules</CardTitle>
            <CardDescription>{ruleList.length} rules total - drag rows to reorder</CardDescription>
          </div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : ruleList.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No firewall rules configured</p>
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="px-2 py-3 text-left w-10"></th>
                    <th className="px-4 py-3 text-left">Priority</th>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-left">Description</th>
                    <th className="px-4 py-3 text-left">Action</th>
                    <th className="px-4 py-3 text-left">Protocol</th>
                    <th className="px-4 py-3 text-left">Destination</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRules.map((rule: FirewallRule) => (
                    <tr
                      key={rule.id}
                      className={`border-b transition-colors ${
                        draggedId === rule.id ? 'opacity-50 bg-muted' : 'hover:bg-muted/50'
                      }`}
                      draggable={!rule.is_system_rule}
                      onDragStart={(e) => handleDragStart(e, rule.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, rule)}
                      onDragEnd={handleDragEnd}
                    >
                      <td className="px-2 py-3">
                        {!rule.is_system_rule && (
                          <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono">{rule.priority}</td>
                      <td className="px-4 py-3 font-medium">{rule.name}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">
                        {rule.description || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs uppercase ${getActionColor(rule.action)}`}>
                          {rule.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 uppercase">{rule.protocol}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {rule.destination_network || 'any'}
                        {rule.destination_port_range && `:${rule.destination_port_range}`}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleRuleMutation.mutate({ id: rule.id, isActive: !rule.is_active })}
                          disabled={toggleRuleMutation.isPending}
                          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                            rule.is_active
                              ? 'bg-green-500/20 text-green-500 hover:bg-green-500/30'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          {rule.is_active ? <Shield className="h-3 w-3" /> : <ShieldOff className="h-3 w-3" />}
                          {rule.is_active ? 'Active' : 'Inactive'}
                        </button>
                        {rule.is_system_rule && (
                          <span className="ml-2 text-xs text-muted-foreground">(System)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(rule.id)}
                          disabled={rule.is_system_rule}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
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

      {/* Add Rule Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent onClose={() => setIsAddModalOpen(false)} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Firewall Rule</DialogTitle>
            <DialogDescription>
              Create a custom firewall rule. All fields except name are optional.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRule} className="space-y-4 mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Rule Name *</Label>
                <Input
                  id="name"
                  value={newRule.name}
                  onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                  placeholder="my-custom-rule"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Input
                  id="priority"
                  type="number"
                  min={1}
                  max={10000}
                  value={newRule.priority}
                  onChange={(e) => setNewRule({ ...newRule, priority: parseInt(e.target.value) || 100 })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={newRule.description}
                onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
                placeholder="What does this rule do?"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="action">Action</Label>
                <Select
                  id="action"
                  value={newRule.action}
                  onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
                  options={ACTION_OPTIONS}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="protocol">Protocol</Label>
                <Select
                  id="protocol"
                  value={newRule.protocol}
                  onChange={(e) => setNewRule({ ...newRule, protocol: e.target.value })}
                  options={PROTOCOL_OPTIONS}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="source_network">Source Network</Label>
                <Input
                  id="source_network"
                  value={newRule.source_network}
                  onChange={(e) => setNewRule({ ...newRule, source_network: e.target.value })}
                  placeholder="10.8.0.0/24 or leave empty for any"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="destination_network">Destination Network</Label>
                <Input
                  id="destination_network"
                  value={newRule.destination_network}
                  onChange={(e) => setNewRule({ ...newRule, destination_network: e.target.value })}
                  placeholder="192.168.1.0/24 or leave empty for any"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination_port_range">Destination Port(s)</Label>
              <Input
                id="destination_port_range"
                value={newRule.destination_port_range}
                onChange={(e) => setNewRule({ ...newRule, destination_port_range: e.target.value })}
                placeholder="80 or 80,443 or 8000-9000"
              />
              <p className="text-xs text-muted-foreground">
                Single port, comma-separated, or range (e.g., 80, 80,443, 8000-9000)
              </p>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createRuleMutation.isPending}>
                {createRuleMutation.isPending ? 'Creating...' : 'Create Rule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DNAT Wizard Modal */}
      <Dialog open={isDNATModalOpen} onOpenChange={setIsDNATModalOpen}>
        <DialogContent onClose={() => setIsDNATModalOpen(false)} className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Port Forwarding Wizard</DialogTitle>
            <DialogDescription>
              Forward traffic from an external port to an internal server on your private network.
            </DialogDescription>
          </DialogHeader>

          {/* Service Presets */}
          <div className="mt-4">
            <Label className="text-sm font-medium">Quick Presets</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {SERVICE_PRESETS.map((preset) => (
                <Button
                  key={preset.name}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyServicePreset(preset)}
                  className="text-xs"
                >
                  {preset.name} ({preset.port})
                </Button>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateDNAT} className="space-y-4 mt-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dnat-name">Rule Name *</Label>
                <Input
                  id="dnat-name"
                  value={newDNAT.name}
                  onChange={(e) => setNewDNAT({ ...newDNAT, name: e.target.value })}
                  placeholder="forward-web-server"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dnat-protocol">Protocol</Label>
                <Select
                  id="dnat-protocol"
                  value={newDNAT.protocol}
                  onChange={(e) => setNewDNAT({ ...newDNAT, protocol: e.target.value })}
                  options={DNAT_PROTOCOL_OPTIONS}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dnat-description">Description</Label>
              <Input
                id="dnat-description"
                value={newDNAT.description}
                onChange={(e) => setNewDNAT({ ...newDNAT, description: e.target.value })}
                placeholder="Forward to internal web server"
              />
            </div>

            <div className="p-4 bg-muted/50 rounded-lg space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 space-y-2">
                  <Label htmlFor="external-port">External Port *</Label>
                  <Input
                    id="external-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={newDNAT.external_port}
                    onChange={(e) => setNewDNAT({ ...newDNAT, external_port: e.target.value })}
                    placeholder="8080"
                  />
                  <p className="text-xs text-muted-foreground">Port exposed on VPN server</p>
                </div>

                <ArrowRight className="h-6 w-6 text-muted-foreground mt-2" />

                <div className="flex-1 space-y-2">
                  <Label htmlFor="internal-ip">Internal IP *</Label>
                  <Input
                    id="internal-ip"
                    value={newDNAT.internal_ip}
                    onChange={(e) => setNewDNAT({ ...newDNAT, internal_ip: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                  <p className="text-xs text-muted-foreground">Private server IP</p>
                </div>

                <div className="w-24 space-y-2">
                  <Label htmlFor="internal-port">Port *</Label>
                  <Input
                    id="internal-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={newDNAT.internal_port}
                    onChange={(e) => setNewDNAT({ ...newDNAT, internal_port: e.target.value })}
                    placeholder="80"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-sm text-blue-500">
                <strong>Example:</strong> To expose an internal web server at 192.168.1.100:80
                on external port 8080, set External Port = 8080, Internal IP = 192.168.1.100, Port = 80.
              </p>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsDNATModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createDNATMutation.isPending}>
                {createDNATMutation.isPending ? 'Creating...' : 'Create Forwarding Rule'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
