import { useEffect, useRef, useState } from 'react'
import { systemApi, type UpdateStatus } from '@/api/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Server,
} from 'lucide-react'

interface VersionInfo {
  current: string | null
  git_sha?: string | null
  build_date?: string | null
}

interface LatestInfo {
  latest: string | null
  current_sha?: string
  update_available: boolean
  target?: string
  error?: string
}

// Poll the host update-agent directly (via Traefik). Resilient to the backend
// and frontend restarting mid-update — a failed poll just means "not back yet".
const POLL_MS = 2000
const RUNNING_STATES = ['running']

export default function SystemUpdateCard() {
  const { toast } = useToast()
  const [version, setVersion] = useState<VersionInfo | null>(null)
  const [latest, setLatest] = useState<LatestInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [polling, setPolling] = useState(false)
  const [backup, setBackup] = useState(true)
  const [runMigrations, setRunMigrations] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    systemApi.version().then((r) => setVersion(r.data)).catch(() => {})
    // Best-effort update check on mount (silent).
    systemApi.checkUpdate().then((r) => setLatest(r.data)).catch(() => {})
  }, [])

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setPolling(false)
  }

  // Poll the agent while an update is in flight.
  useEffect(() => {
    if (!polling) return
    let missed = 0
    pollRef.current = setInterval(async () => {
      const s = await systemApi.agentStatus()
      if (!s) {
        // Backend/frontend restart window — keep waiting, don't give up.
        missed += 1
        setStatus((prev) =>
          prev ? { ...prev, message: 'Reiniciando serviços… aguarde' } : prev
        )
        return
      }
      missed = 0
      setStatus(s)
      if (!RUNNING_STATES.includes(s.state)) {
        stopPolling()
        if (s.state === 'done') {
          toast({ title: 'Atualização concluída', description: s.message })
          setTimeout(() => window.location.reload(), 3000)
        } else if (s.state === 'rolled_back') {
          toast({
            title: 'Rollback automático',
            description: 'A atualização falhou e o sistema voltou à versão anterior.',
            variant: 'destructive',
          })
        } else if (s.state === 'failed') {
          toast({
            title: 'Falha na atualização',
            description: s.error || s.message,
            variant: 'destructive',
          })
        }
      }
    }, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polling])

  const handleCheck = async () => {
    setChecking(true)
    try {
      const r = await systemApi.checkUpdate()
      setLatest(r.data)
      if (r.data?.update_available) {
        toast({ title: 'Atualização disponível', description: `Nova versão: ${r.data.latest ?? r.data.target}` })
      } else {
        toast({ title: 'Sistema atualizado', description: 'Você já está na versão mais recente.' })
      }
    } catch (e: any) {
      toast({
        title: 'Não foi possível verificar',
        description: e?.response?.data?.detail || 'Update-agent indisponível.',
        variant: 'destructive',
      })
    } finally {
      setChecking(false)
    }
  }

  const handleUpdate = async () => {
    if (!confirm('Iniciar a atualização completa do sistema? Os serviços serão reconstruídos. Certificados do OpenVPN são preservados.')) {
      return
    }
    try {
      await systemApi.startUpdate({ backup, run_migrations: runMigrations })
      setStatus({ state: 'running', pct: 1, message: 'Iniciando atualização…' })
      setPolling(true)
    } catch (e: any) {
      toast({
        title: 'Não foi possível iniciar',
        description: e?.response?.data?.detail || 'Verifique se o update-agent está ativo.',
        variant: 'destructive',
      })
    }
  }

  const handleRegenOpenvpn = async () => {
    if (!confirm('Regenerar o server.conf do OpenVPN a partir do template? Isso descarta edições manuais do server.conf. Os certificados/PKI são preservados.')) {
      return
    }
    try {
      await systemApi.regenerateOpenvpnConfig()
      toast({ title: 'OpenVPN', description: 'Configuração regenerada; PKI preservado.' })
    } catch (e: any) {
      toast({
        title: 'Falha ao regenerar',
        description: e?.response?.data?.detail || 'Erro no update-agent.',
        variant: 'destructive',
      })
    }
  }

  const updateAvailable = latest?.update_available
  const running = polling || status?.state === 'running'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          Sistema & Atualizações
        </CardTitle>
        <CardDescription>
          Versão atual:{' '}
          <span className="font-mono font-medium">
            v{version?.current ?? '—'}
          </span>
          {version?.git_sha && (
            <span className="text-muted-foreground"> ({version.git_sha})</span>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Update availability banner */}
        {!running && latest && (
          <div
            className={
              'flex items-center gap-2 rounded-md border p-3 text-sm ' +
              (updateAvailable
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-emerald-500/40 bg-emerald-500/10')
            }
          >
            {updateAvailable ? (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>
                  Atualização disponível:{' '}
                  <span className="font-mono font-medium">{latest.latest ?? latest.target}</span>
                </span>
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span>Você está na versão mais recente.</span>
              </>
            )}
          </div>
        )}

        {/* Progress (while running / after finish) */}
        {status && (running || status.state !== 'idle') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{status.message}</span>
              <span className="text-muted-foreground">{status.pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={
                  'h-full transition-all duration-500 ' +
                  (status.state === 'failed'
                    ? 'bg-destructive'
                    : status.state === 'rolled_back'
                    ? 'bg-amber-500'
                    : status.state === 'done'
                    ? 'bg-emerald-500'
                    : 'bg-primary')
                }
                style={{ width: `${Math.min(100, Math.max(0, status.pct))}%` }}
              />
            </div>
            {status.error && (
              <p className="text-sm text-destructive">{status.error}</p>
            )}
            {status.log_tail && status.log_tail.length > 0 && (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
                {status.log_tail.join('')}
              </pre>
            )}
          </div>
        )}

        {/* Options */}
        {!running && (
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
              Fazer backup (banco + PKI do OpenVPN) antes de atualizar
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={runMigrations}
                onChange={(e) => setRunMigrations(e.target.checked)}
              />
              Rodar migrações do banco (alembic) após atualizar
            </label>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleCheck} disabled={checking || running} className="gap-2">
            <RefreshCw className={'h-4 w-4 ' + (checking ? 'animate-spin' : '')} />
            Verificar atualizações
          </Button>
          <Button onClick={handleUpdate} disabled={running} className="gap-2">
            <Download className="h-4 w-4" />
            {running ? 'Atualizando…' : 'Atualizar agora'}
          </Button>
          <Button variant="ghost" onClick={handleRegenOpenvpn} disabled={running} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Regenerar config OpenVPN
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          A atualização preserva os certificados/PKI do OpenVPN e não derruba
          banco, cache ou proxy. Em caso de falha no health-check, o sistema faz
          rollback automático para a versão anterior.
        </p>
      </CardContent>
    </Card>
  )
}
