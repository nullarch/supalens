'use client';

import { useState } from 'react';
import { AlertModal, BaseModal, ConfirmModal, ModalButton, SelectField, TextAreaField, TextField } from '@/components/modals';
import { Select } from '@/components/ui/Select';

// Dev-only: every dialog and form control of the modal system in one place, mounted
// with local state only (no IO), so the restyled primitives can be checked under the
// app tokens in light and dark.
const OPTIONS = [
  { value: 'every-5m', label: 'Every 5 minutes' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily at 09:00' },
  { value: 'weekly', label: 'Weekly', disabled: true },
];

export function ControlsGallery() {
  const [open, setOpen] = useState<'base' | 'confirm' | 'destructive' | 'alert' | null>(null);
  const [name, setName] = useState('Daily revenue');
  const [cadence, setCadence] = useState('hourly');
  const [sql, setSql] = useState('select sum(amount) from orders where created_at > now() - interval \'1 day\'');
  const [inline, setInline] = useState('daily');
  const close = () => setOpen(null);

  return (
    <section aria-labelledby="gallery-controls-title" style={{ marginTop: 48 }}>
      <div className="dx-section-head">
        <div>
          <h2 id="gallery-controls-title" className="dx-section-title">Dialogs and controls</h2>
          <p className="dx-section-sub">BaseModal, ConfirmModal, AlertModal, the labelled fields and the unified Select.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="dx-card" style={{ padding: '20px 24px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <ModalButton onClick={() => setOpen('base')}>Open form dialog</ModalButton>
          <ModalButton variant="ghost" onClick={() => setOpen('confirm')}>Confirm dialog</ModalButton>
          <ModalButton variant="destructive" onClick={() => setOpen('destructive')}>Destructive confirm</ModalButton>
          <ModalButton variant="ghost" onClick={() => setOpen('alert')}>Alert dialog</ModalButton>
          <ModalButton disabled>Disabled</ModalButton>
        </div>
        <div className="dx-card" style={{ padding: '20px 24px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 20 }}>
          <TextField label="Monitor name" required hint="Shown in alerts and the overview." value={name} onChange={e => setName(e.target.value)} />
          <SelectField label="Check cadence" hint="The plan's minimum interval applies." value={cadence} onValueChange={setCadence} options={OPTIONS} />
          <div style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
            <span className="dx-label">Inline select (sm)</span>
            <div><Select size="sm" ariaLabel="Inline cadence" value={inline} onValueChange={setInline} options={OPTIONS} /></div>
          </div>
        </div>
      </div>

      <BaseModal
        open={open === 'base'}
        onClose={close}
        title="Edit monitor"
        description="Changes apply from the next scheduled check."
        footer={<>
          <ModalButton variant="ghost" onClick={close}>Cancel</ModalButton>
          <ModalButton onClick={close}>Save monitor</ModalButton>
        </>}
      >
        <div style={{ display: 'grid', gap: 16 }}>
          <TextField label="Monitor name" required value={name} onChange={e => setName(e.target.value)} />
          <SelectField label="Check cadence" value={cadence} onValueChange={setCadence} options={OPTIONS} />
          <TextAreaField label="Metric SQL" hint="Read-only. Must return one number." value={sql} onChange={e => setSql(e.target.value)} />
        </div>
      </BaseModal>
      <ConfirmModal open={open === 'confirm'} onClose={close} onConfirm={close} title="Pause this monitor?" description="Checks stop until you resume it. History is kept." confirmText="Pause" />
      <ConfirmModal open={open === 'destructive'} onClose={close} onConfirm={close} title="Delete this data source?" description="Its monitors, reports and context stop working. This cannot be undone." confirmText="Delete" confirmVariant="destructive" />
      <AlertModal open={open === 'alert'} onClose={close} title="Check queued" description="The result appears on the monitor within a minute." />
    </section>
  );
}
