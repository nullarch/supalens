import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import s from "./McpHub.module.css";

type T = Awaited<ReturnType<typeof getTranslations>>;

/* Light Claude Code / Cursor conversation mock — decorative, so aria-hidden.
   Proves "ask when you need to, it keeps watching when you don't": a user turn
   that asks for MRR BY THE APPROVED DEFINITION, an execute_sql tool-call whose
   SQL trace carries the verified-KPI predicate (from SUPALENS.md), the result,
   an assistant reply, a create_alert tool-call, and the monitor confirmation.
   The finished conversation IS the base (unanimated) state, so reduced-motion
   shows it statically; the CSS loop staggers the same rows in. */
function ConversationMock({ t }: { t: T }) {
  return (
    <div className={s.window} aria-hidden>
      <div className={s.bar}>
        <span className={s.dots}>
          <i />
          <i />
          <i />
        </span>
        <span className={s.addr}>Claude · supalens MCP</span>
      </div>

      <div className={s.thread}>
        {/* user turn */}
        <div className={s.user} style={{ "--i": 0 } as React.CSSProperties}>
          <span className={s.userText}>{t("mock.user")}</span>
        </div>

        {/* tool call — execute_sql (collapsed header + trace) */}
        <div className={s.tool} style={{ "--i": 1 } as React.CSSProperties}>
          <div className={s.toolHead}>
            <span className={s.chev}>⏵</span>
            <span className={s.call}>execute_sql</span>
            <span className={s.server}>supalens</span>
          </div>
          <code className={s.sql}>
            {`-- verified KPI: mrr (SUPALENS.md)
SELECT date_trunc('month', s.period_start) AS month,
       sum(s.amount) AS mrr
FROM subscriptions s
WHERE s.status = 'active'
  AND s.deleted_at IS NULL
  AND s.payment_status = 'paid'
  AND s.internal_account = false
GROUP BY 1 ORDER BY 1 DESC LIMIT 2;`}
          </code>
          <div className={s.result}>
            <div className={s.row}>
              <span className={s.rLabel}>{t("mock.lastMonth")}</span>
              <span className={s.rVal}>₩45.3M</span>
            </div>
            <div className={s.row}>
              <span className={s.rLabel}>{t("mock.thisMonth")}</span>
              <span className={s.rVal}>₩48.2M</span>
              <span className={s.rDelta} data-good>
                +6.4%
              </span>
            </div>
          </div>
        </div>

        {/* assistant reply */}
        <div
          className={s.assistant}
          style={{ "--i": 2 } as React.CSSProperties}
        >
          {t("mock.reply")}
        </div>

        {/* tool call — create_alert (an anomaly monitor on the approved KPI) */}
        <div className={s.tool} style={{ "--i": 3 } as React.CSSProperties}>
          <div className={s.toolHead}>
            <span className={s.chev}>⏵</span>
            <span className={s.call}>create_alert</span>
            <span className={s.server}>supalens</span>
          </div>
        </div>

        {/* assistant confirmation */}
        <div
          className={s.assistant}
          style={{ "--i": 4 } as React.CSSProperties}
        >
          {t("mock.saved")}
        </div>
      </div>
    </div>
  );
}

export default async function McpHub() {
  const t = await getTranslations("mcpHub");
  return (
    <section id="mcp" className={`cx-section ${s.section}`}>
      <div className="cx-container">
        <div className={`cx-grid ${s.grid}`}>
          <div className={s.text}>
            <h3 className="cx-type-md">{t("heading")}</h3>
            <p className={`cx-type-md ${s.lede}`}>{t("lede")}</p>
            <Link className="cx-link" href="/docs/mcp">
              {t("guideLink")}
            </Link>
          </div>

          <div className={`cx-frame ${s.media}`}>
            <ConversationMock t={t} />
          </div>
        </div>
      </div>
    </section>
  );
}
