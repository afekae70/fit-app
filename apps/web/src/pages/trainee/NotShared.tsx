/**
 * What a tab shows when the trainee has not shared what it is about: who decides, and where
 * the switch is — never an error, because nothing is wrong.
 */

import { LockSimple } from '@phosphor-icons/react';

import { Card, EmptyState } from '../../components/ui.js';
import { he } from '../../i18n/he.js';

export function NotShared() {
  return (
    <Card>
      <EmptyState icon={LockSimple} title={he.sharing.notSharedTitle}>
        <p className="muted" style={{ maxWidth: 460, textAlign: 'center' }}>
          {he.sharing.notSharedBody}
        </p>
      </EmptyState>
    </Card>
  );
}
