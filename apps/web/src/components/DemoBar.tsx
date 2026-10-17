/** Said at the top of every page of the demonstration, so nobody mistakes it for real people. */

import { Info } from '@phosphor-icons/react';

import { useCoach } from '../coachContext.js';
import { he } from '../i18n/he.js';
import { Button } from './ui.js';

export function DemoBar() {
  const { source, signOut } = useCoach();
  if (source.mode !== 'demo') return null;
  return (
    <div className="demo-bar" role="note">
      <Info size={18} weight="duotone" aria-hidden />
      <span>
        <strong>{he.demo.banner}.</strong> {he.demo.bannerBody}
      </span>
      <Button small variant="secondary" onClick={signOut}>
        {he.demo.leave}
      </Button>
    </div>
  );
}
