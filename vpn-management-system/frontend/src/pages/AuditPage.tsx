import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'
import { Search, Download, LogIn, LogOut, Shield, Settings2, Server, UserPlus, RefreshCw, AlertTriangle, KeyRound } from 'lucide-react'

type Severity = 'info' | 'success' | 'warning' | 'error'
type Category = 'auth' | 'vpn' | 'config' | 'system' | 'users'

interface AuditRow {
  id: number
  ts: string
  actor: string
  ip: string
  category: Category
  action: string
  severity: Severity
}

// --- MOCK DATA (preview only) ---
const MOCK: AuditRow[] = [
  { id: 1, ts: '2026-07-08 20:41:03', actor: 'admin', ip: '170.231.45.197', category: 'auth', action: 'Login no painel', severity: 'success' },
  { id: 2, ts: '2026-07-08 20:39:17', actor: 'sistema', ip: '—', category: 'config', action: 'Certificado LetsEncrypt reemitido (vpn-aws.numerama.com.br)', severity: 'info' },
  { id: 3, ts: '2026-07-08 20:22:58', actor: 'eduardo', ip: '201.130.94.249', category: 'vpn', action: 'OpenVPN conectado (10.8.0.3)', severity: 'success' },
  { id: 4, ts: '2026-07-08 20:08:23', actor: 'sistema', ip: '—', category: 'system', action: 'Atualização concluída — v1.1.12', severity: 'info' },
  { id: 5, ts: '2026-07-08 19:54:10', actor: 'admin', ip: '170.231.45.197', category: 'config', action: 'Firewall: regra "allow-internal-network" ativada', severity: 'warning' },
  { id: 6, ts: '2026-07-08 19:31:44', actor: 'guilherme', ip: '189.6.22.4', category: 'vpn', action: 'OpenVPN desconectado (sessão 58m)', severity: 'info' },
  { id: 7, ts: '2026-07-08 18:12:05', actor: 'desconhecido', ip: '45.9.148.201', category: 'auth', action: 'Falha de login (senha inválida) — usuário "root"', severity: 'error' },
  { id: 8, ts: '2026-07-08 17:20:31', actor: 'admin', ip: '170.231.45.197', category: 'config', action: 'IPsec: conexão "matriz" criada', severity: 'info' },
  { id: 9, ts: '2026-07-08 16:49:35', actor: 'admin', ip: '170.231.45.197', category: 'users', action: 'Usuário "vitor" criado', severity: 'info' },
  { id: 10, ts: '2026-07-08 15:03:12', actor: 'sistema', ip: '—', category: 'system', action: 'Uso de disco acima de 85% (86%)', severity: 'warning' },
  { id: 11, ts: '2026-07-08 14:41:20', actor: 'admin', ip: '170.231.45.197', category: 'auth', action: 'MFA ativado', severity: 'success' },
  { id: 12, ts: '2026-07-08 13:47:59', actor: 'admin', ip: '170.231.45.197', category: 'config', action: 'Config do servidor VPN alterada (split-DNS)', severity: 'info' },
  { id: 13, ts: '2026-07-08 11:14:02', actor: 'bernardo', ip: '177.32.9.88', category: 'vpn', action: 'Perfil .ovpn baixado', severity: 'info' },
  { id: 14, ts: '2026-07-08 09:58:41', actor: 'admin', ip: '170.231.45.197', category: 'config', action: 'Domínio do painel alterado', severity: 'warning' },
  { id: 15, ts: '2026-07-07 22:10:00', actor: 'admin', ip: '170.231.45.197', category: 'auth', action: 'Logout', severity: 'info' },
]

const CATEGORIES: { key: Category | 'all'; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'auth', label: 'Autenticação' },
  { key: 'vpn', label: 'OpenVPN' },
  { key: 'config', label: 'Configuração' },
  { key: 'system', label: 'Sistema' },
  { key: 'users', label: 'Usuários' },
]

const SEVERITIES: { key: Severity | 'all'; label: string }[] = [
  { key: 'all', label: 'Todas severidades' },
  { key: 'success', label: 'Sucesso' },
  { key: 'info', label: 'Info' },
  { key: 'warning', label: 'Atenção' },
  { key: 'error', label: 'Erro' },
]

const catMeta: Record<Category, { label: string; icon: React.ElementType }> = {
  auth: { label: 'Autenticação', icon: LogIn },
  vpn: { label: 'OpenVPN', icon: Shield },
  config: { label: 'Configuração', icon: Settings2 },
  system: { label: 'Sistema', icon: Server },
  users: { label: 'Usuários', icon: UserPlus },
}

const sevMeta: Record<Severity, { label: string; cls: string; dot: string }> = {
  success: { label: 'Sucesso', cls: 'text-success', dot: 'bg-success' },
  info: { label: 'Info', cls: 'text-muted-foreground', dot: 'bg-muted-foreground' },
  warning: { label: 'Atenção', cls: 'text-warning', dot: 'bg-warning' },
  error: { label: 'Erro', cls: 'text-destructive', dot: 'bg-destructive' },
}

function actionIcon(r: AuditRow) {
  if (r.action.startsWith('Login')) return LogIn
  if (r.action.startsWith('Logout')) return LogOut
  if (r.action.includes('MFA') || r.action.includes('senha')) return KeyRound
  if (r.action.startsWith('Atualiz')) return RefreshCw
  if (r.action.includes('disco') || r.action.includes('Falha')) return AlertTriangle
  return catMeta[r.category].icon
}

export default function AuditPage() {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [sev, setSev] = useState<Severity | 'all'>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return MOCK.filter((r) => {
      if (cat !== 'all' && r.category !== cat) return false
      if (sev !== 'all' && r.severity !== sev) return false
      if (q && !(r.action.toLowerCase().includes(q) || r.actor.toLowerCase().includes(q) || r.ip.includes(q))) return false
      return true
    })
  }, [query, cat, sev])

  const selectCls = 'h-9 rounded-lg border border-border bg-secondary/40 px-3 text-sm text-foreground focus:outline-none focus:border-primary/50'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria"
        subtitle="Registro de eventos do sistema · prévia com dados fictícios"
        actions={
          <Button variant="outline" size="sm"><Download className="mr-2 h-4 w-4" /> Exportar CSV</Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por ação, usuário ou IP..." className="pl-9" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value as any)} className={selectCls}>
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <select value={sev} onChange={(e) => setSev(e.target.value as any)} className={selectCls}>
          {SEVERITIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input type="date" className={selectCls} />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Data / hora</th>
                  <th className="px-4 py-3 font-medium">Usuário</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">Categoria</th>
                  <th className="px-4 py-3 font-medium">Ação</th>
                  <th className="px-4 py-3 font-medium">Severidade</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const Icon = actionIcon(r)
                  const s = sevMeta[r.severity]
                  return (
                    <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-accent/20">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{r.ts}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-foreground">{r.actor}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">{r.ip}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                          {(() => { const C = catMeta[r.category].icon; return <C className="h-3.5 w-3.5" /> })()}
                          {catMeta[r.category].label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-2 text-foreground">
                          <Icon className={cn('h-4 w-4 shrink-0', s.cls)} />
                          {r.action}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', s.cls)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                          {s.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Nenhum evento encontrado</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span>{rows.length} evento(s) · prévia (mock)</span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled>Anterior</Button>
              <Button variant="outline" size="sm" disabled>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
