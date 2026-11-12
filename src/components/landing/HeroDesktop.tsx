import { getTranslations } from "next-intl/server";
import LogoMark from "@/components/brand/LogoMark";
import s from "./HeroDesktop.module.css";

/* ============================================================
   HeroDesktop — the hero media scene: a warm "supalens OS"
   desktop (wallpaper + menu bar) with one frosted app window
   on top, playing a 30s pure-CSS loop that tells the golden
   path, honestly:

     A · connect     an OS pointer clicks Connect on Supabase,
                     then on GitHub (DB + code — both, on purpose)
     B · scan        schema + code ticker, then counters land
                     (42 tables · 6 entities · 9 rules · 7 KPIs)
     C · understood  "your business works like this": entity
                     chips + code-backed rules with file:line
                     evidence; the pointer presses Looks correct
     D · KPIs        the suggested KPI list with monitor kinds;
                     the pointer presses Approve & monitor; a
                     completion card states TWO numbers — KPIs
                     approved vs monitors active — because not
                     every KPI gets a monitor
     E · live tail   a Slack anomaly investigation that keeps
                     ticking: typing → confirmed-in-data facts →
                     likely driver → ack. Facts and hypothesis
                     are visibly separate blocks, and nothing
                     claims deploy/log access the product lacks.

   Everything here is DEPICTED PRODUCT (inside the hero mock),
   not marketing chrome — so the scene may use gradients,
   shadows and looped motion that the `.cx` page chrome bans.
   Decorative only: the parent frame is aria-hidden. No client
   JS — the whole loop is CSS keyframes on one master duration.
   ============================================================ */

/* Wallpaper gradient-mesh: blurred color fields (Sonoma-style),
   colors come from CSS vars on .desktop so the dark theme can
   restyle them. Bottom layer of the scene — purely decorative. */
export function WallpaperMesh({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <filter id="hd-wall-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="88" />
        </filter>
      </defs>
      <g filter="url(#hd-wall-blur)">
        <ellipse cx="180" cy="60" rx="560" ry="380" fill="var(--w-cream)" />
        <ellipse cx="1120" cy="150" rx="640" ry="420" fill="var(--w-peach)" />
        <ellipse
          cx="1010"
          cy="520"
          rx="520"
          ry="360"
          fill="var(--w-coral)"
          transform="rotate(-14 1010 520)"
        />
        <ellipse
          cx="330"
          cy="560"
          rx="440"
          ry="330"
          fill="var(--w-rose)"
          transform="rotate(12 330 560)"
        />
        <ellipse
          cx="720"
          cy="330"
          rx="700"
          ry="200"
          fill="var(--w-amber)"
          opacity="0.75"
          transform="rotate(-6 720 330)"
        />
        <ellipse
          cx="150"
          cy="920"
          rx="560"
          ry="360"
          fill="var(--w-olive)"
          opacity="0.85"
        />
        <ellipse cx="1240" cy="960" rx="680" ry="400" fill="var(--w-umber)" />
      </g>
    </svg>
  );
}

/* Supabase bolt — brand green, one of the two sanctioned brand marks in
   the otherwise monochrome mock: this is the connect moment, so the marks
   should read unmistakably. Official two-path logo geometry. */
function SupabaseMark({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 109 113" aria-hidden="true">
      <path
        d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627H99.1935C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
        fill="#249361"
      />
      <path
        d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z"
        fill="#3ECF8E"
      />
    </svg>
  );
}

/* GitHub mark (same glyph the login form uses) — monochrome ink. */
function GithubMark({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.28-.01-1.04-.02-2.04-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.22.7.83.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5Z" />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6.4 4.8 9l5.2-6" />
    </svg>
  );
}

function Pointer({ className }: { className: string }) {
  return (
    <span className={className} aria-hidden="true">
      <svg viewBox="0 0 20 20">
        <path d="M4.5 1.8v14.4l3.7-3.3 2.4 5.1 2.4-1.1-2.4-5h5Z" />
      </svg>
    </span>
  );
}

/* Phase-B ticker: BOTH sources are read — DB objects interleaved with
   the application files that give them meaning (this is the product's
   thesis: the code is the semantic layer). */
const SCAN_ITEMS = [
  "public.orders",
  "app/billing/mrr.ts",
  "public.subscriptions",
  "app/payments/revenue.ts",
  "public.payments",
  "public.refunds",
  "app/users/query.ts",
  "public.customers",
  "app/lib/accounts.ts",
  "public.credits",
  "app/credits/consume.ts",
  "public.generations",
  "app/api/webhooks/paddle.ts",
  "public.coupons",
  "auth.users",
  "public.subscription_items",
];

/* Slack-card sparkline: a flat week that breaks downward at the end —
   the drop the investigation is about. Draws to ~88% in the build beat,
   then the newest (lowest) point lands during the live tail. */
const SPARK_PTS =
  "0,8 37,9 74,7 110,10 147,8 184,10.5 220,8.5 257,9 294,8 331,10.5 368,19 415,25";

type Kind = "anomaly" | "threshold" | "dash";

export default async function HeroDesktop() {
  const t = await getTranslations("hero");
  const scanStatus = t.raw("desktop.scanStatus") as string[];
  const scanCounters = t.raw("desktop.scanCounters") as string[];
  const entities = t.raw("desktop.entities") as string[];
  const rules = t.raw("desktop.rules") as Array<{ text: string; ev: string }>;
  const kpis = t.raw("desktop.kpis") as Array<{
    name: string;
    value: string;
    kind: Kind;
  }>;
  const confirmed = t.raw("desktop.slack.confirmed") as string[];
  const kindLabel = (k: Kind) =>
    k === "anomaly"
      ? t("desktop.kindAnomaly")
      : k === "threshold"
        ? t("desktop.kindThreshold")
        : t("desktop.kindDash");

  return (
    <div className={s.desktop}>
      {/* ---- wallpaper (gradient mesh, bottom layer) ---- */}
      <WallpaperMesh className={s.wall} />

      {/* ---- OS menu bar ---- */}
      <div className={s.menubar}>
        <span className={s.mbBrand}>
          <LogoMark size={11} className={s.mbLens} />
          supalens
        </span>
        <span className={s.mbItem}>{t("desktop.menu.file")}</span>
        <span className={s.mbItem}>{t("desktop.menu.edit")}</span>
        <span className={s.mbItem}>{t("desktop.menu.view")}</span>
        <span className={s.mbItemWide}>{t("desktop.menu.go")}</span>
        <span className={s.mbItemWide}>{t("desktop.menu.window")}</span>
        <span className={s.mbRight}>{t("desktop.menuDate")}</span>
      </div>

      {/* ---- the app window ---- */}
      <div className={s.win}>
        <div className={s.chrome}>
          <span className={s.dots}>
            <i />
            <i />
            <i />
          </span>
          <span className={s.chromeTitle}>{t("desktop.chromeTitle")}</span>
        </div>

        <div className={s.stage}>
          {/* loading hairline across the window top (scan phase) */}
          <span className={s.progress}>
            <i className={s.progressFill} />
          </span>

          {/* ---- phase A · connect Supabase, then GitHub ---- */}
          <div className={`${s.phase} ${s.phaseA}`}>
            <div className={s.connect}>
              <span className={s.tag}>{t("desktop.connectTag")}</span>
              <div className={s.consentList}>
                <div className={s.consent}>
                  <SupabaseMark className={s.sbMark} />
                  <span className={s.consentText}>
                    <span className={s.consentTitle}>Supabase</span>
                    <span className={s.consentScope}>
                      {t("desktop.supabaseScope")}
                    </span>
                  </span>
                  {/* button ⇄ "connected" swap on the click beat */}
                  <span className={s.swap}>
                    <span className={`${s.aBtn} ${s.aBtnSb}`}>
                      {t("desktop.connectBtn")}
                    </span>
                    <span className={`${s.aCheck} ${s.aCheckSb}`}>
                      <Check />
                      {t("desktop.connectDone")}
                    </span>
                  </span>
                </div>
                <div className={s.consent}>
                  <GithubMark className={s.ghMark} />
                  <span className={s.consentText}>
                    <span className={s.consentTitle}>GitHub</span>
                    <span className={s.consentScope}>
                      {t("desktop.githubScope")}
                    </span>
                  </span>
                  <span className={s.swap}>
                    <span className={`${s.aBtn} ${s.aBtnGh}`}>
                      {t("desktop.connectBtn")}
                    </span>
                    <span className={`${s.aCheck} ${s.aCheckGh}`}>
                      <Check />
                      {t("desktop.connectDone")}
                    </span>
                  </span>
                </div>
                {/* the OS pointer performs both connect clicks */}
                <Pointer className={`${s.cursorEl} ${s.cursorA}`} />
              </div>
              <p className={s.aHelp}>{t("desktop.connectHelp")}</p>
            </div>
          </div>

          {/* ---- phase B · scan schema + code ---- */}
          <div className={`${s.phase} ${s.phaseB}`}>
            <div className={s.scanTop}>
              <span className={s.pulse} />
              <span className={s.statusStack}>
                {scanStatus.map((line, i) => (
                  <span
                    key={line}
                    className={s.status}
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    {line}
                  </span>
                ))}
              </span>
            </div>

            <div className={s.ticker}>
              {/* list rendered twice so the -50% scroll never runs dry */}
              <ul className={s.tickerList}>
                {[0, 1].map((pass) =>
                  SCAN_ITEMS.map((f) => <li key={`${pass}-${f}`}>{f}</li>),
                )}
              </ul>
            </div>

            <div className={s.chips}>
              {scanCounters.map((c, i) => (
                <span
                  key={c}
                  className={s.chip}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <i className={s.chipDot} />
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* ---- phase C · what we understood (rules + evidence) ---- */}
          <div className={`${s.phase} ${s.phaseC}`}>
            <div className={s.pHead}>
              <span className={s.tag}>{t("desktop.rulesTag")}</span>
              <span className={s.pTitle}>{t("desktop.rulesTitle")}</span>
            </div>
            <div className={s.entRow}>
              {entities.map((e, i) => (
                <span
                  key={e}
                  className={s.ent}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  {e}
                </span>
              ))}
            </div>
            <ul className={s.rules}>
              {rules.map((r, i) => (
                <li
                  key={r.ev}
                  className={`${s.rule} ${i >= 3 ? s.hideM : ""}`}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <span className={s.ruleCheck}>
                    <Check />
                  </span>
                  <span className={s.ruleText}>{r.text}</span>
                  <span className={s.ev}>{r.ev}</span>
                </li>
              ))}
            </ul>
            <div className={s.pFoot}>
              <span className={`${s.btn} ${s.btnC}`}>
                {t("desktop.rulesCta")}
              </span>
              <Pointer className={`${s.cursorEl} ${s.cursorC}`} />
            </div>
          </div>

          {/* ---- phase D · suggested KPIs → approve & monitor ---- */}
          <div className={`${s.phase} ${s.phaseD}`}>
            <div className={s.pHead}>
              <span className={s.tag}>{t("desktop.kpiTag")}</span>
              <span className={s.pMeta}>{t("desktop.kpiMeta")}</span>
            </div>
            <ul className={s.kpis}>
              {kpis.map((k, i) => (
                <li
                  key={k.name}
                  className={`${s.kpi} ${i >= 5 ? s.hideM : ""}`}
                  style={{ "--i": i } as React.CSSProperties}
                >
                  <span className={s.kBox}>
                    <Check />
                  </span>
                  <span className={s.kName}>{k.name}</span>
                  <span className={s.kVal}>{k.value}</span>
                  <span className={s.kKind} data-kind={k.kind}>
                    {kindLabel(k.kind)}
                  </span>
                </li>
              ))}
            </ul>
            <div className={s.pFoot}>
              <span className={`${s.btn} ${s.btnD}`}>
                {t("desktop.approveCta")}
              </span>
              <Pointer className={`${s.cursorEl} ${s.cursorD}`} />
            </div>

            {/* completion card — two honest numbers, not one */}
            <div className={s.done}>
              <span className={s.doneMark}>
                <LogoMark size={16} />
              </span>
              <span className={s.doneTitle}>{t("desktop.doneTitle")}</span>
              <span className={s.doneRow}>
                <span className={s.doneStat}>{t("desktop.doneApproved")}</span>
                <i className={s.doneSep} />
                <span className={s.doneStat}>{t("desktop.doneMonitors")}</span>
              </span>
              <span className={s.doneNext}>
                <i className={s.doneDot} />
                {t("desktop.doneNext")}
              </span>
            </div>
          </div>

          {/* ---- phase E · the live tail: a Slack investigation ---- */}
          <div className={`${s.phase} ${s.phaseE}`}>
            <div className={s.slack}>
              <div className={s.slHead}>
                <span className={s.slChannel}>{t("desktop.slack.channel")}</span>
                <span className={s.livePill}>
                  <i className={s.liveDot} />
                  LIVE
                </span>
              </div>
              <div className={s.msg}>
                <span className={s.msgAvatar}>
                  <LogoMark size={14} />
                </span>
                <div className={s.msgBody}>
                  <span className={s.msgMeta}>
                    <b>{t("desktop.slack.app")}</b>
                    <i className={s.appTag}>APP</i>
                    <span>{t("desktop.slack.time")}</span>
                  </span>

                  {/* typing indicator → the message replaces it */}
                  <span className={s.typing}>
                    <i />
                    <i />
                    <i />
                    <em>{t("desktop.slack.investigating")}</em>
                  </span>

                  <div className={s.msgCard}>
                    <span className={s.msgTitle}>
                      <i className={s.sev} />
                      {t("desktop.slack.title")}
                    </span>
                    <span className={s.msgHead}>{t("desktop.slack.headline")}</span>

                    <span className={`${s.sparkBox} ${s.hideM}`}>
                      <svg
                        className={s.slSpark}
                        viewBox="0 0 420 30"
                        preserveAspectRatio="xMinYMid meet"
                        aria-hidden="true"
                      >
                        <line className={s.slBase} x1="0" y1="9" x2="420" y2="9" />
                        <polyline
                          className={s.slLine}
                          pathLength={100}
                          points={SPARK_PTS}
                        />
                      </svg>
                      <i className={s.slDot} />
                      <i className={s.slPing} />
                    </span>

                    <span className={s.secTag}>{t("desktop.slack.confirmedTag")}</span>
                    <ul className={s.facts}>
                      {confirmed.map((c, i) => (
                        <li key={c} style={{ "--i": i } as React.CSSProperties}>
                          {c}
                        </li>
                      ))}
                    </ul>

                    <span className={`${s.secTag} ${s.likelyTag}`}>
                      {t("desktop.slack.likelyTag")}
                    </span>
                    <span className={s.likely}>{t("desktop.slack.likely")}</span>

                    <span className={s.msgFoot}>{t("desktop.slack.foot")}</span>
                  </div>

                  <span className={s.ack}>
                    <Check />
                    {t("desktop.slack.ack")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- OS notification toast ---- */}
      <div className={s.toast}>
        <span className={s.tIcon}>
          <LogoMark size={15} />
        </span>
        <span className={s.tBody}>
          <span className={s.tTitle}>{t("desktop.toastTitle")}</span>
          <span className={s.tSub}>{t("desktop.toastSub")}</span>
        </span>
      </div>
    </div>
  );
}
