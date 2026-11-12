"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-[color:var(--ax-scrim,rgba(16,17,18,0.55))] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { showCloseButton?: boolean; closeDisabled?: boolean }
>(({ className, children, showCloseButton = true, closeDisabled = false, onEscapeKeyDown, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const t = useTranslations('appCommon')
  const returnFocus = React.useRef<HTMLElement | null>(null)
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onOpenAutoFocus={(event) => {
        // Most BaseModal consumers are controlled by state and have no Radix
        // DialogTrigger. Remember the actual opener before focus enters.
        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        onOpenAutoFocus?.(event)
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)
        if (!event.defaultPrevented && returnFocus.current?.isConnected) {
          event.preventDefault()
          returnFocus.current.focus()
        }
      }}
      onEscapeKeyDown={(event) => {
        // Radix observes Escape in capture phase, before our inline Select's
        // option handler closes the listbox. Let that first Escape dismiss
        // only the nested menu; a second Escape can close the dialog.
        if (event.target instanceof Element && event.target.closest('[role="listbox"]')) {
          event.preventDefault()
        }
        onEscapeKeyDown?.(event)
      }}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-5 border border-line bg-paper-2 p-6 text-ink shadow-lift-strong duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-[var(--r-card,14px)] max-sm:p-5",
        "outline-none focus-visible:ring-2 focus-visible:ring-clay",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close disabled={closeDisabled} className="absolute right-4 top-4 rounded-[10px] p-1.5 text-ink-3 opacity-90 transition hover:bg-paper-3 hover:text-ink hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-clay/30 disabled:pointer-events-none disabled:opacity-40">
          <X className="h-4 w-4" />
          <span className="sr-only">{t('close')}</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col gap-2 text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "font-serif text-[22px] font-normal leading-[1.3] tracking-[-0.025em] text-ink",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-[14px] leading-[22.75px] text-ink-3", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
