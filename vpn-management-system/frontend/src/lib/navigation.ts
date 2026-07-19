import {
  LayoutDashboard,
  Users,
  Shield,
  Link2,
  Globe,
  Network,
  Activity,
  ScrollText,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  adminOnly: boolean
  keywords?: string
  // Searchable in the command palette but NOT shown in the sidebar. Used for
  // deep-links into a page's sub-section (e.g. a Settings tab).
  hidden?: boolean
}

export const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, adminOnly: false, keywords: 'inicio home visao geral' },
  { name: 'Usuários', href: '/users', icon: Users, adminOnly: true, keywords: 'users contas acessos active directory ad' },
  { name: 'OpenVPN', href: '/vpn', icon: Shield, adminOnly: false, keywords: 'vpn servidor tunel perfil ovpn' },
  { name: 'IPsec', href: '/ipsec', icon: Link2, adminOnly: true, keywords: 'site to site tunel ike' },
  { name: 'Proxy Reverso', href: '/proxy', icon: Globe, adminOnly: true, keywords: 'reverse proxy traefik dominio certificado' },
  { name: 'Firewall', href: '/firewall', icon: Network, adminOnly: true, keywords: 'regras rules rede interna' },
  { name: 'Conexões', href: '/connections', icon: Activity, adminOnly: true, keywords: 'connections clientes sessoes ativas' },
  { name: 'Auditoria', href: '/audit', icon: ScrollText, adminOnly: true, keywords: 'audit logs eventos historico login' },
  { name: 'Configurações', href: '/settings', icon: Settings, adminOnly: false, keywords: 'settings conta senha mfa dominio ldap ad active directory autenticacao' },
  // Deep-link (palette-only) straight to the AD tab in Settings.
  { name: 'Autenticação AD (LDAP)', href: '/settings?tab=auth', icon: Network, adminOnly: true, hidden: true, keywords: 'ldap active directory ad autenticacao sincronizacao grupo vpn ntlm' },
]
