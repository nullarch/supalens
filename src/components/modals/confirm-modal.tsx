'use client';

import { useTranslations } from 'next-intl';

import { BaseModal } from './base-modal';
import { ModalButton } from './controls';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  isLoading?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  cancelText,
  confirmVariant = 'default',
  isLoading = false,
}: ConfirmModalProps) {
  const t = useTranslations('appCommon');
  const confirmLabel = confirmText ?? t('confirm');
  const cancelLabel = cancelText ?? t('cancel');

  const handleConfirm = () => {
    onConfirm();
  };

  return (
    <BaseModal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      showCloseButton={false}
      footer={
        <div className="flex gap-2 w-full sm:w-auto">
          <ModalButton
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
            className="flex-1 sm:flex-none"
          >
            {cancelLabel}
          </ModalButton>
          <ModalButton
            variant={confirmVariant === 'destructive' ? 'destructive' : 'primary'}
            onClick={handleConfirm}
            disabled={isLoading}
            className="flex-1 sm:flex-none"
          >
            {isLoading ? t('processing') : confirmLabel}
          </ModalButton>
        </div>
      }
    />
  );
}
