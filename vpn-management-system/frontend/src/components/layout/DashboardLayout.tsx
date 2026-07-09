import { Outlet, Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { navigation } from '@/lib/navigation'
import { Logo, LogoMark } from '@/components/Logo'
import { CommandPalette } from '@/components/CommandPalette'
import { LogOut, Menu, X, Search, Bell, PanelLeftClose, PanelLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { systemApi } from '@/api/client'

export default function DashboardLayout() {
  const { user, logout } = useAuthStore()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('eg.rail') === '1')
  const [cmdkOpen, setCmdkOpen] = useState(false)
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    systemApi.version().then((res) => setVersion(res.data?.current ?? null)).catch(() => setVersion(null))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCmdkOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('eg.rail', c ? '0' : '1')
      return !c
    })
  }

  const visibleNav = navigation.filter((item) => !item.adminOnly || user?.is_admin)
  const domain = typeof window !== 'undefined' ? window.location.hostname : ''

  const railWidth = collapsed ? 'lg:w-[72px]' : 'lg:w-60'
  const contentPad = collapsed ? 'lg:pl-[72px]' : 'lg:pl-60'

  return (
    <div className="min-h-screen bg-background">
      <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-border bg-[#0a0f18] transition-all duration-200 ease-in-out',
          railWidth,
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Brand */}
        <div className={cn('flex h-16 items-center border-b border-border', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
          <Link to="/dashboard" onClick={() => setMobileOpen(false)}>
            <Logo collapsed={collapsed} />
          </Link>
          <button
            className="hidden lg:inline-flex text-muted-foreground hover:text-foreground"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expandir' : 'Recolher'}
          >
            {collapsed ? null : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setMobileOpen(false)}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {collapsed && (
            <button
              className="mb-2 hidden lg:flex w-full items-center justify-center rounded-lg py-2 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              onClick={toggleCollapsed}
              title="Expandir"
            >
              <PanelLeft className="h-5 w-5" />
            </button>
          )}
          {visibleNav.map((item) => {
            const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={() => setMobileOpen(false)}
                title={collapsed ? item.name : undefined}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  collapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'
                )}
              >
                {isActive && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-primary" />}
                <item.icon className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')} />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            )
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-border p-3">
          <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold ring-1 ring-primary/30 shrink-0">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{user?.username}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.is_admin ? 'Administrador' : 'Usuário'}</p>
              </div>
            )}
            {!collapsed && (
              <button onClick={logout} title="Sair" className="text-muted-foreground hover:text-destructive">
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className={cn('transition-all duration-200', contentPad)}>
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
          <button className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>

          {/* Domain / subtitle */}
          <div className="hidden min-w-0 sm:flex items-center gap-2.5">
            <LogoMark size={28} className="lg:hidden" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{domain || 'EdgeGate'}</p>
              <p className="truncate text-xs text-muted-foreground">
                painel de gerenciamento{version ? ` · v${version}` : ''}
              </p>
            </div>
          </div>

          {/* Command palette trigger */}
          <button
            onClick={() => setCmdkOpen(true)}
            className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 md:flex"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Buscar ou executar comando</span>
            <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <button
              onClick={() => setCmdkOpen(true)}
              className="md:hidden text-muted-foreground hover:text-foreground"
              title="Buscar (⌘K)"
            >
              <Search className="h-5 w-5" />
            </button>
            <button className="relative text-muted-foreground hover:text-foreground" title="Notificações">
              <Bell className="h-5 w-5" />
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
            </button>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success eg-pulse" />
              Sistemas OK
            </span>
          </div>
        </header>

        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
