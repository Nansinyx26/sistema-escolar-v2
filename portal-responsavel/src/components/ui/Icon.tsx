/**
 * components/ui/Icon.tsx
 * Wrapper de ícone padronizado sobre lucide-react.
 *
 * Substitui os antigos `<i className="ti ti-*">` (Tabler) por SVGs Lucide,
 * mantendo a mesma família de ícones do restante do portal. Centraliza o mapa
 * Tabler → Lucide num único lugar e preserva `className`/props.
 *
 * Os componentes sao importados nominalmente, nao por `Lucide[nome]`: indexar
 * um namespace import em runtime impede o tree-shaking e arrasta a biblioteca
 * inteira para o bundle.
 *
 * Uso:  <Icon name="user" />           (tamanho 1em, herda cor via currentColor)
 *       <Icon name="trash" size={20} />
 *       <Icon name={loading ? 'loader' : 'check'} className={styles.x} />
 */

import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BellOff,
  Book,
  Bot,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleUser,
  ClipboardList,
  Clock,
  Database,
  FileCheck,
  FileDown,
  FileText,
  FileUp,
  Gavel,
  House,
  IdCard,
  Key,
  LayoutDashboard,
  Link,
  Loader,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Meh,
  MessageCircle,
  PartyPopper,
  Pause,
  Phone,
  PhoneCall,
  RefreshCw,
  School,
  Search,
  Send,
  Settings,
  Share2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Signature,
  Smartphone,
  Smile,
  SquareCheck,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import type React from 'react';

// Nome Tabler (sem prefixo `ti-`) → nome do componente lucide-react.
const MAP: Record<string, LucideIcon> = {
  'alert-circle': CircleAlert,
  'alert-triangle': TriangleAlert,
  affiliate: Share2,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  bell: Bell,
  'bell-filled': Bell,
  'bell-off': BellOff,
  book: Book,
  'brand-whatsapp': MessageCircle,
  building: Building2,
  'calendar-stats': CalendarDays,
  camera: Camera,
  'chart-bar': BarChart3,
  check: Check,
  checkbox: SquareCheck,
  'circle-check': CircleCheck,
  'circle-check-filled': CircleCheck,
  'clipboard-list': ClipboardList,
  clock: Clock,
  confetti: PartyPopper,
  database: Database,
  'device-mobile': Smartphone,
  'file-check': FileCheck,
  'file-download': FileDown,
  'file-text': FileText,
  'file-upload': FileUp,
  gavel: Gavel,
  help: CircleHelp,
  home: House,
  id: IdCard,
  'id-badge': IdCard,
  key: Key,
  'layout-dashboard': LayoutDashboard,
  link: Link,
  loader: Loader,
  lock: Lock,
  login: LogIn,
  logout: LogOut,
  mail: Mail,
  'message-circle': MessageCircle,
  'mood-empty': Meh,
  'mood-smile': Smile,
  phone: Phone,
  'phone-call': PhoneCall,
  'player-pause': Pause,
  refresh: RefreshCw,
  robot: Bot,
  school: School,
  search: Search,
  send: Send,
  settings: Settings,
  'shield-alert': ShieldAlert,
  'shield-check': ShieldCheck,
  'shield-lock': Shield,
  signature: Signature,
  trash: Trash2,
  upload: Upload,
  user: User,
  'user-check': UserCheck,
  'user-circle': CircleUser,
  'user-plus': UserPlus,
  users: Users,
  'users-group': Users,
  volume: Volume2,
  x: X,
};

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'ref'> {
  /** Nome no estilo Tabler (sem `ti-`), ex.: "user", "trash", "arrow-right". */
  name: string;
  /** Tamanho em px (número) ou unidade CSS. Padrão "1em" (casa com o texto). */
  size?: number | string;
  /** Gira o ícone continuamente (usa o @keyframes `spin` global). */
  spin?: boolean;
}

const SPIN_STYLE: React.CSSProperties = { animation: 'spin 0.8s linear infinite' };

const Icon: React.FC<IconProps> = ({ name, size = '1em', spin, style, ...rest }) => {
  const mergedStyle = spin ? { ...SPIN_STYLE, ...style } : style;
  const Cmp = MAP[name];

  if (!Cmp) {
    // Ícone não mapeado: não quebra o layout, só avisa em dev.
    if (import.meta.env?.DEV) console.warn(`[Icon] sem mapeamento para "${name}"`);
    return <CircleHelp size={size} style={mergedStyle} {...rest} />;
  }

  return <Cmp size={size} style={mergedStyle} {...rest} />;
};

export default Icon;
