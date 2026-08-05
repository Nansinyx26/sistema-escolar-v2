/**
 * components/ui/Dialog.tsx
 * Dialog acessível padronizado sobre Radix Primitives.
 *
 * Radix cuida de foco preso, ESC, aria-* e scroll-lock; aqui só aplicamos o
 * visual (paleta esmeralda/teal) e o ícone Lucide — a mesma família de ícones
 * do restante do portal.
 *
 * Uso:
 *   <Dialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title="Confirmar matrícula"
 *     description="Esta ação notifica o responsável."
 *     trigger={<button className="dui-btn">Abrir</button>}
 *   >
 *     …conteúdo…
 *   </Dialog>
 */
import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import styles from './Dialog.module.scss';

export interface DialogProps {
  /** Controlado: estado de abertura. Omita para uso não-controlado via `trigger`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Elemento que abre o diálogo (não-controlado). */
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Ícone opcional exibido ao lado do título. */
  icon?: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  icon,
}) => {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={styles.content}>
          <div className={styles.header}>
            <div>
              <RadixDialog.Title className={styles.title}>
                {icon}
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className={styles.description}>
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button className={styles.close} aria-label="Fechar">
                <X size={18} aria-hidden="true" />
              </button>
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
};

export default Dialog;
