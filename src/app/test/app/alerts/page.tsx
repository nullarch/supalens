import { Fragment } from 'react'

import { ALERTS } from '../_components/sample-data'
import s from './alerts.module.css'

export default function AlertsPage() {
  return (
    <div className={s.wrap}>
      <div className={s.titleRow}>
        <h1 className={`cx-type-md ${s.h1}`}>알림</h1>
        <button type="button" className="cx-btn cx-btn--sm">
          새 알림 →
        </button>
      </div>

      <div className={s.panel}>
        {ALERTS.map((a) => (
          <Fragment key={a.id}>
            <div className={s.row}>
              <span className={s.dot} data-status={a.status} />
              <div className={s.main}>
                <span className={s.name}>{a.name}</span>
                <code className={s.condition}>{a.condition}</code>
              </div>
              <span className={s.checked}>{a.lastChecked}</span>
              <span
                className={s.toggle}
                data-on={a.enabled}
                role="switch"
                aria-checked={a.enabled}
                aria-label={`${a.name} ${a.enabled ? '켜짐' : '꺼짐'}`}
              >
                <span className={s.knob} />
              </span>
            </div>

            {a.explanation && (
              <div className={s.explain}>
                <span className={s.explainLabel}>왜 발동했나</span>
                <p className={s.explainText}>{a.explanation}</p>
                <a className={`cx-link ${s.explainLink}`} href="#">
                  관련 쿼리 보기 →
                </a>
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
