import {
  LayoutDashboard,
  Inbox,
  Megaphone,
  Users,
  Bot,
  Settings,
  BarChart3,
  type LucideIcon,
  SquareKanban,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  // Itens adminOnly só aparecem para role 'admin'. Operadores não veem
  // Credenciais (escrita admin-only — antes a rota existia mas sem link,
  // deixando Configurações/Equipe/Conta inalcançáveis pela UI).
  adminOnly?: boolean;
}

// Single source of truth for both the Sidebar and the router. Adding a new
// app section is a one-liner here.
// Base de Conhecimento, Follow-ups e Horário de atendimento viraram abas dentro
// de /ai-agent. Credenciais virou aba dentro de Configurações. Templates virou
// aba dentro de /campaigns (Módulo 1).
export const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/funil', label: 'Funil', icon: SquareKanban },
  { to: '/contacts', label: 'Contatos', icon: Users },
  { to: '/campaigns', label: 'Campanhas', icon: Megaphone },
  { to: '/vendas', label: 'Vendas & Recompra', icon: BarChart3 },
  { to: '/ai-agent', label: 'Agente de IA', icon: Bot, adminOnly: true },
  { to: '/settings/profile', label: 'Configurações', icon: Settings },
];
