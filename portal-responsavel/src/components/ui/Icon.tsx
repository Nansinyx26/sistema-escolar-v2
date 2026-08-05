/**
 * components/ui/Icon.tsx
 * Wrapper de ícone padronizado sobre lucide-react.
 *
 * Substitui os antigos `<i className="ti ti-*">` (Tabler) por SVGs Lucide,
 * mantendo a mesma família de ícones do restante do portal. Centraliza o mapa
 * Tabler → Lucide num único lugar e preserva `className`/props.
 *
 * Uso:  <Icon name="user" />           (tamanho 1em, herda cor via currentColor)
 *       <Icon name="trash" size={20} />
 *       <Icon name={loading ? 'loader' : 'check'} className={styles.x} />
 */
import React from 'react';
import * as Lucide from 'lucide-react';
import type { LucideProps } from 'lucide-react';

// Nome Tabler (sem prefixo `ti-`) → nome do componente lucide-react.
const MAP: Record<string, keyof typeof Lucide> = {
  'alert-circle': 'CircleAlert',
  'alert-triangle': 'TriangleAlert',
  'affiliate': 'Share2',
  'arrow-right': 'ArrowRight',
  'bell': 'Bell',
  'bell-filled': 'Bell',
  'bell-off': 'BellOff',
  'book': 'Book',
  'brand-whatsapp': 'MessageCircle',
  'building': 'Building2',
  'calendar-stats': 'CalendarDays',
  'camera': 'Camera',
  'chart-bar': 'BarChart3',
  'check': 'Check',
  'checkbox': 'SquareCheck',
  'circle-check': 'CircleCheck',
  'circle-check-filled': 'CircleCheck',
  'clipboard-list': 'ClipboardList',
  'clock': 'Clock',
  'confetti': 'PartyPopper',
  'database': 'Database',
  'device-mobile': 'Smartphone',
  'file-check': 'FileCheck',
  'file-download': 'FileDown',
  'file-text': 'FileText',
  'file-upload': 'FileUp',
  'gavel': 'Gavel',
  'help': 'CircleHelp',
  'home': 'House',
  'id': 'IdCard',
  'id-badge': 'IdCard',
  'key': 'Key',
  'layout-dashboard': 'LayoutDashboard',
  'link': 'Link',
  'loader': 'Loader',
  'lock': 'Lock',
  'login': 'LogIn',
  'logout': 'LogOut',
  'mail': 'Mail',
  'message-circle': 'MessageCircle',
  'mood-empty': 'Meh',
  'mood-smile': 'Smile',
  'phone': 'Phone',
  'phone-call': 'PhoneCall',
  'player-pause': 'Pause',
  'refresh': 'RefreshCw',
  'robot': 'Bot',
  'school': 'School',
  'search': 'Search',
  'send': 'Send',
  'settings': 'Settings',
  'shield-alert': 'ShieldAlert',
  'shield-check': 'ShieldCheck',
  'shield-lock': 'Shield',
  'signature': 'Signature',
  'trash': 'Trash2',
  'upload': 'Upload',
  'user': 'User',
  'user-check': 'UserCheck',
  'user-circle': 'CircleUser',
  'user-plus': 'UserPlus',
  'users': 'Users',
  'users-group': 'Users',
  'volume': 'Volume2',
  'x': 'X',
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
  const componentName = MAP[name];
  const Cmp = (componentName && Lucide[componentName]) as
    | React.ComponentType<LucideProps>
    | undefined;

  if (!Cmp) {
    // Ícone não mapeado: não quebra o layout, só avisa em dev.
    if (import.meta.env?.DEV) console.warn(`[Icon] sem mapeamento para "${name}"`);
    const Fallback = Lucide.HelpCircle;
    return <Fallback size={size} style={mergedStyle} {...rest} />;
  }

  return <Cmp size={size} style={mergedStyle} {...rest} />;
};

export default Icon;
