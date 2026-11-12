"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import s from "./Faq.module.css";

type Item = { q: string; a: string };

/* Serif heading column beside a hairline accordion. One answer open at a time;
   collapsed answers are inert so they never take focus. */
export default function Faq() {
  const t = useTranslations("faq");
  const items = t.raw("items") as Item[];
  const [open, setOpen] = useState<number | null>(null);
  const id = useId();

  return (
    <section id="faq" className="ed-section" aria-labelledby={`${id}-title`}>
      <div className={`ed-container ${s.layout}`} data-reveal>
        <h2 id={`${id}-title`} className={`ed-title ${s.title}`}>
          {t("title")}
        </h2>
        <div className={s.list}>
          {items.map((item, index) => {
            const expanded = open === index;
            return (
              <div key={item.q} className={s.item} data-open={expanded}>
                <h3 className={s.question}>
                  <button
                    type="button"
                    id={`${id}-q-${index}`}
                    aria-expanded={expanded}
                    aria-controls={`${id}-a-${index}`}
                    onClick={() => setOpen(expanded ? null : index)}
                  >
                    <span>{item.q}</span>
                    <span className={s.icon} aria-hidden />
                  </button>
                </h3>
                <div
                  id={`${id}-a-${index}`}
                  className={s.answer}
                  role="region"
                  aria-labelledby={`${id}-q-${index}`}
                  inert={!expanded}
                >
                  <div>
                    <p>{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
