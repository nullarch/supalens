"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

/**
 * Button-anchored menu behaviour shared by the header's organization and account
 * menus: outside press and Escape close it and return focus to the trigger, the
 * checked (else first) item receives focus on open, and arrow/Home/End move
 * between items. Tab closes the menu so focus is never trapped in a popover.
 */
export function useMenu<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<T>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    (menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      menu?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])'),
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      close(false);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };

  const triggerProps = {
    ref: triggerRef,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    onClick: () => setOpen((value) => !value),
    onKeyDown: (event: KeyboardEvent<T>) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setOpen(true);
      }
    },
  };

  const menuProps = { id: menuId, ref: menuRef, role: "menu" as const, onKeyDown: onMenuKeyDown };

  return { open, setOpen, close, triggerRef, triggerProps, menuProps };
}
