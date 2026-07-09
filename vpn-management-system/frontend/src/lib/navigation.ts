import {
  LayoutDashboard,
  Users,
  Shield,
  Link2,
  Globe,
  Network,
  Activity,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  name: string
  href: string
  icon: LucideIcon
  adminOnly: boolean
  keywords?: string
}

export const navigation: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, adminOnly: false, keywords: 'inicio home visao geral' },
  { name: 'Usuários', href: '/users', icon: Users, adminOnly: true, keywords: 'users contas acessos' },
  { name: 'OpenVPN', href: '/vpn', icon: Shield, adminOnly: false, keywords: 'vpn servidor tunel perfil ovpn' },
  { name: 'IPsec', href: '/ipsec', icon: Link2, adminOnly: true, keywords: 'site to site tunel ike' },
  { name: 'Proxy Reverso', href: '/proxy', icon: Globe, adminOnly: true, keywords: 'reverse proxy traefik dominio certificado' },
  { name: 'Firewall', href: '/firewall', icon: Network, adminOnly: true, keywords: 'regras rules rede interna' },
  { name: 'Conexões', href: '/connections', icon: Activity, adminOnly: true, keywords: 'connections clientes sessoes ativas' },
  { name: 'Configurações', href: '/settings', icon: Settings, adminOnly: false, keywords: 'settings conta senha mfa dominio' },
]
