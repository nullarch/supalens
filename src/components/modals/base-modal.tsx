'use client';

import { type ComponentProps, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-[calc(100vw-2rem)] h-[calc(100vh-2rem)]',
};

interface BaseModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  showCloseButton?: boolean;
  closeDisabled?: boolean;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus'];
}

export function BaseModal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  className,
  showCloseButton,
  closeDisabled,
  onCloseAutoFocus,
}: BaseModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton={showCloseButton} closeDisabled={closeDisabled} onCloseAutoFocus={onCloseAutoFocus} className={cn(sizeClasses[size], className)} {...(!description ? { 'aria-describedby': undefined } : {})}>
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle className={showCloseButton === false ? undefined : 'pr-8'}>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}

        {children && <div>{children}</div>}

        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
