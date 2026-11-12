"use client";

import { useEffect } from "react";

/** Progressive section reveal (opacity + 12px rise, 520ms).
 * Server HTML is fully visible. After hydration, only `[data-reveal]` blocks
 * still below the fold are hidden, then shown once as they enter the viewport.
 * Reduced motion and browsers without IntersectionObserver skip it entirely. */
export default function RevealOnScroll() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).filter(
      (element) => element.getBoundingClientRect().top > window.innerHeight,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const element of targets) {
      element.dataset.reveal = "pending";
      observer.observe(element);
    }
    return () => {
      observer.disconnect();
      for (const element of targets) element.dataset.reveal = "shown";
    };
  }, []);

  return null;
}
