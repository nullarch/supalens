"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/Select";
import s from "./board.module.css";

export type SwitcherItem = { key: string; label: string; href: string; current: boolean };

/* View switch in the overview title row: "All services" + one entry per data source, as the
   Design-system segmented control. Past a handful of sources the per-source entries fold into a select
   so long names never push the row past the page width. */
export function ServiceSwitcher({ label, placeholder, all, services }: { label: string; placeholder: string; all: SwitcherItem; services: SwitcherItem[] }) {
  const router = useRouter();
  const current = services.find((item) => item.current);

  if (services.length <= 4) {
    return (
      <nav className={`dx-segmented ${s.switcher}`} aria-label={label}>
        {[all, ...services].map((item) => (
          <Link key={item.key} href={item.href} aria-current={item.current ? "page" : undefined} className={s.switcherItem}>
            {item.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className={`dx-segmented ${s.switcher}`} aria-label={label}>
      <Link href={all.href} aria-current={all.current ? "page" : undefined} className={s.switcherItem}>
        {all.label}
      </Link>
      <Select
        value={current?.key ?? ""}
        onValueChange={(key) => {
          const next = services.find((item) => item.key === key);
          if (next) router.push(next.href);
        }}
        options={services.map((item) => ({ value: item.key, label: item.label }))}
        placeholder={placeholder}
        ariaLabel={label}
        size="sm"
      />
    </nav>
  );
}
