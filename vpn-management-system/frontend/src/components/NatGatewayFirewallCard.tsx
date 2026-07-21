import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Globe } from 'lucide-react'

export default function NatGatewayFirewallCard() {
  const { toast } = useToast()
  const [enabled, setEnabled] = useState(false)
  const [network, setNetwork] = useState('')

  const { data, refetch } = useQuery({
    queryKey: ['nat-gateway'],
    queryFn: () => adminApi.getNatGateway().then((r) => r.data),
  })

  useEffect(() => {
    if (!data) return
    setEnabled(data.enabled)
    setNetwork(data.network ?? '')
  }, [data])

  const save = useMutation({
    mutationFn: (payload: { enabled: boolean; network: string }) =>
      adminApi.updateNatGateway({
        enabled: payload.enabled,
        network: payload.network || null,
        public_interface: null, // auto-detected by the agent (default route)
        exclude_networks: null, // IPsec exceptions are derived automatically
      }),
    onSuccess: (res) => {
      const applied = res.data.applied
      toast({
        title: 'NAT Gateway atualizado',
        description: applied === false ? 'Salvo, mas o agente NAT não aplicou.' : 'Regras aplicadas.',
      })
      refetch()
    },
    onError: (error: any) => {
      if (data) setEnabled(data.enabled)
      toast({
        variant: 'destructive',
        title: 'Falha ao atualizar NAT Gateway',
        description: error?.response?.data?.detail || error?.response?.data?.message,
      })
    },
  })

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    save.mutate({ enabled: next, network })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          NAT Gateway (saída à internet)
        </CardTitle>
        <CardDescription>
          Faz este host servir de gateway NAT para uma sub-rede privada alcançar a internet.
          A interface de saída e as exceções de VPNs IPsec são detectadas automaticamente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`p-4 rounded-lg border transition-colors ${
            enabled ? 'bg-primary/10 border-primary' : 'bg-muted/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Globe className={`h-5 w-5 flex-shrink-0 ${enabled ? 'text-primary' : 'text-muted-foreground'}`} />
              <div className="min-w-0">
                <p className="font-medium text-sm">Masquerade da sub-rede</p>
                <p className="text-xs text-muted-foreground truncate">
                  {network ? `${network} → internet (interface auto)` : 'defina a sub-rede privada abaixo'}
                </p>
              </div>
            </div>
            <button
              onClick={toggle}
              disabled={save.isPending || (!enabled && !network)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 ml-3 items-center rounded-full transition-colors ${
                enabled ? 'bg-primary' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            <Label className="text-xs text-muted-foreground">Sub-rede privada (CIDR)</Label>
            <div className="flex gap-2">
              <Input
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                placeholder="10.1.0.0/16"
                className="h-9 flex-1 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => save.mutate({ enabled, network })}
                disabled={save.isPending || !network}
              >
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
