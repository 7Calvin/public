import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { Router, Save, CheckCircle2, XCircle } from 'lucide-react'

interface FormState {
  enabled: boolean
  network: string
  public_interface: string
  exclude_networks: string
}

const emptyForm: FormState = {
  enabled: false,
  network: '',
  public_interface: '',
  exclude_networks: '',
}

export default function NatGatewayCard() {
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(emptyForm)
  const [applyResult, setApplyResult] = useState<{ ok: boolean; message: string | null } | null>(null)

  const { data, refetch } = useQuery({
    queryKey: ['nat-gateway'],
    queryFn: () => adminApi.getNatGateway().then((r) => r.data),
  })

  useEffect(() => {
    if (!data) return
    setForm({
      enabled: data.enabled,
      network: data.network ?? '',
      public_interface: data.public_interface ?? '',
      exclude_networks: data.exclude_networks ?? '',
    })
  }, [data])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const saveMutation = useMutation({
    mutationFn: () =>
      adminApi.updateNatGateway({
        enabled: form.enabled,
        network: form.network || null,
        public_interface: form.public_interface || null,
        exclude_networks: form.exclude_networks || null,
      }),
    onSuccess: (res) => {
      const applied = res.data.applied
      setApplyResult({ ok: applied !== false, message: res.data.agent_message ?? null })
      toast({
        title: 'NAT gateway salvo',
        description: applied === false ? 'Salvo, mas o agente NAT não aplicou.' : 'Regras aplicadas.',
      })
      refetch()
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Falha ao salvar',
        description: error?.response?.data?.detail || error?.response?.data?.message,
      })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Router className="h-5 w-5" />
          NAT Gateway (saída à internet)
        </CardTitle>
        <CardDescription>
          Faz este host servir de gateway NAT para uma sub-rede privada alcançar a internet
          (masquerade pela interface pública). Alterar aqui reaplica no agente, sem SSH.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
          <div>
            <p className="font-medium">Habilitar NAT gateway</p>
            <p className="text-sm text-muted-foreground">
              Sem isso, este host não faz masquerade da sub-rede.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            onClick={() => set('enabled', !form.enabled)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0 transition-colors ${
              form.enabled ? 'bg-primary' : 'bg-secondary'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                form.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="nat-network">Sub-rede privada (CIDR)</Label>
            <Input
              id="nat-network"
              value={form.network}
              onChange={(e) => set('network', e.target.value)}
              placeholder="10.1.0.0/16"
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nat-iface">Interface pública</Label>
            <Input
              id="nat-iface"
              value={form.public_interface}
              onChange={(e) => set('public_interface', e.target.value)}
              placeholder="ens5"
              className="font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nat-exclude">Exceções sem masquerade (IPsec)</Label>
          <Input
            id="nat-exclude"
            value={form.exclude_networks}
            onChange={(e) => set('exclude_networks', e.target.value)}
            placeholder="192.168.3.0/24, 172.16.0.0/24"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Destinos site-to-site que mantêm o IP de origem real. CIDRs separados por vírgula.
          </p>
        </div>

        {applyResult && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
              applyResult.ok
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-destructive/40 bg-destructive/10 text-destructive'
            }`}
          >
            {applyResult.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>
              {applyResult.ok
                ? 'Configuração aplicada pelo agente NAT.'
                : `Salvo, mas o agente não aplicou: ${applyResult.message || 'indisponível'}`}
            </span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button
            onClick={() => { setApplyResult(null); saveMutation.mutate() }}
            disabled={saveMutation.isPending || (form.enabled && !form.network)}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveMutation.isPending ? 'Aplicando...' : 'Salvar e aplicar'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
