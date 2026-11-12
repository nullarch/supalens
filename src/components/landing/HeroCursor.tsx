import Link from "next/link";
import { getTranslations } from "next-intl/server";
import s from "./HeroCursor.module.css";
import HeroDesktop from "./HeroDesktop";

/* ============================================================
   HeroCursor — the production hero, the left-aligned copy + media frame layout.
   A left-aligned eyebrow/headline/CTA block + a dominant media
   frame. The frame hosts HeroDesktop: an OS-desktop scene whose
   app window loops the golden path (connect Supabase + GitHub →
   scan → business rules found → KPIs approved → monitoring →
   a Slack anomaly investigation as the live tail). Rides the
   global `.cx` tokens from landing.css.

   The primary CTA lands on the real Supabase connect surface
   after login (`/app/sources?connect=supabase` auto-opens the
   connect modal on Supabase) so the label never over-promises.
   ============================================================ */

const CONNECT_HREF = "/login?next=%2Fapp%2Fsources%3Fconnect%3Dsupabase";

export default async function HeroCursor() {
  const t = await getTranslations("hero");
  return (
    <section className={`cx-section cx-section--first ${s.hero}`}>
      <div className="cx-container">
        <div className={s.copy}>
          <span className={s.eyebrow}>{t("cursor.eyebrow")}</span>
          <h1 className={`cx-type-md-lg ${s.headline}`}>
            {t("cursor.headline")}
          </h1>
          <p className={`cx-type-sm ${s.sub}`}>{t("cursor.sub")}</p>
          <div className={s.ctaRow}>
            <Link className="cx-btn" href={CONNECT_HREF}>
              {t("cursor.ctaPrimary")}
            </Link>
            <a className="cx-btn cx-btn--secondary" href="#how">
              {t("cursor.ctaSecondary")}
            </a>
          </div>
        </div>

        {/* media panel — the "supalens OS" golden-path scene */}
        <div className={`cx-frame ${s.media}`} aria-hidden="true">
          <HeroDesktop />
        </div>
      </div>
    </section>
  );
}
