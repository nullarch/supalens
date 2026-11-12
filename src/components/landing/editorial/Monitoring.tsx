import { ArrowUpRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import SignalDemo from "./SignalDemo";

/* Split heading (copy left, demo link right) over one pale panel holding the
   sample alert: the Slack post beside the email and the all-clear that follow. */
export default async function Monitoring() {
  const t = await getTranslations("alertDemo");
  const product = await getTranslations("globalProduct");
  const locale = await getLocale();
  const demoHref = `${locale === "en" ? "" : `/${locale}`}/demo`;

  return (
    <section id="monitoring" className="ed-section" aria-labelledby="monitoring-title">
      <div className="ed-container" data-reveal>
        <header className="ed-head ed-head--split">
          <div>
            <span className="ed-tag">{t("eyebrow")}</span>
            <h2 id="monitoring-title" className="ed-title">
              {t("title")}
            </h2>
            <p className="ed-lede">{t("lede")}</p>
          </div>
          <a className="ed-text-link" href={demoHref}>
            {product("tryDemo")}
            <ArrowUpRight size={15} aria-hidden />
          </a>
        </header>

        <SignalDemo />
      </div>
    </section>
  );
}
