'use client';

import { useTranslations } from 'next-intl';

import { BaseModal } from './base-modal';
import { ModalButton } from './controls';

interface AlertModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
}

export function AlertModal({
  open,
  onClose,
  title,
  description,
  confirmText,
  variant = 'default',
}: AlertModalProps) {
  const t = useTranslations('appCommon');
  const confirmLabel = confirmText ?? t('confirm');
  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      showCloseButton={false}
      footer={
        <ModalButton variant={variant === 'destructive' ? 'destructive' : 'primary'} onClick={onClose} className="w-full sm:w-auto">
          {confirmLabel}
        </ModalButton>
      }
    />
  );
}
