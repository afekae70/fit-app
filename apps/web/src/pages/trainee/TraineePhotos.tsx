/**
 * A trainee's progress photos, when they share them: every photo newest first, any one larger,
 * and any two side by side with the days between them.
 *
 * The pictures are in a private bucket. They are shown through links signed for an hour, asked
 * for as the signed-in coach — storage lets a coach read the folder only while the trainee has
 * photos shared, so turning sharing off in the app closes it here as well, even for a page left
 * open. A photo whose picture has not reached the server yet says so instead of a broken image.
 */

import { ArrowsLeftRight, Camera, CheckCircle, ImageBroken, X } from '@phosphor-icons/react';
import type { CoachPhoto } from '@fit/shared/coaching';
import { useEffect, useState } from 'react';

import { daysApart } from '../../analytics/dates.js';
import { useCoach } from '../../coachContext.js';
import { Button, Card, Dialog, EmptyState, ErrorBanner, Skeleton } from '../../components/ui.js';
import { fill, he } from '../../i18n/he.js';
import { formatDayLong, formatDayShort } from '../../lib/format.js';
import { useLoad } from '../../lib/useLoad.js';
import { NotShared } from './NotShared.js';

/** Comfortably inside the ten minutes a link lasts. */
const REFRESH_LINKS_MS = 8 * 60 * 1000;

export function TraineePhotos({ traineeId, shared }: { traineeId: string; shared: boolean }) {
  if (!shared) return <NotShared />;
  return <SharedPhotos traineeId={traineeId} />;
}

function SharedPhotos({ traineeId }: { traineeId: string }) {
  const { source } = useCoach();
  const photos = useLoad(() => source.photos(traineeId), [source, traineeId]);
  const [urls, setUrls] = useState<Record<string, string> | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [enlarged, setEnlarged] = useState<CoachPhoto | null>(null);

  const list = photos.state === 'ready' ? photos.value : null;
  useEffect(() => {
    if (!list) return;
    let live = true;
    const fetchLinks = () =>
      void source.photoUrls(traineeId, list.map((photo) => photo.id)).then((answer) => {
        if (live) setUrls(answer);
      });
    fetchLinks();
    // The links last ten minutes (see supabaseSource.ts); a page left open is given new ones
    // before they run out, so a photo scrolled to later still opens.
    const timer = window.setInterval(fetchLinks, REFRESH_LINKS_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [source, traineeId, list]);

  if (photos.state === 'loading') return <Skeleton kind="photos" />;
  if (photos.state === 'failed') return <ErrorBanner error={photos.error} onRetry={photos.reload} />;
  if (photos.value.length === 0) {
    return (
      <Card>
        <EmptyState icon={Camera} title={he.photos.none} />
      </Card>
    );
  }

  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : // Two at most: a third choice replaces the older of the two.
          [...current, id].slice(-2),
    );
  const chosen = picked
    .map((id) => photos.value.find((photo) => photo.id === id))
    .filter((photo): photo is CoachPhoto => photo !== undefined)
    .sort((a, b) => (a.takenOn < b.takenOn ? -1 : a.takenOn > b.takenOn ? 1 : 0));

  return (
    <>
      {source.mode === 'demo' ? <p className="muted">{he.photos.demo}</p> : null}

      {chosen.length === 2 ? (
        <Card
          title={he.photos.compareTitle}
          action={
            <Button variant="ghost" small onClick={() => setPicked([])}>
              <X size={16} aria-hidden /> {he.photos.clear}
            </Button>
          }
        >
          <div className="compare">
            {chosen.map((photo, index) => (
              <figure className="compare-side" key={photo.id}>
                <span className="compare-label">
                  {index === 0 ? he.photos.before : he.photos.after}
                </span>
                <Picture photo={photo} url={urls?.[photo.id]} loading={urls === null} />
                <figcaption>
                  <strong>{formatDayLong(photo.takenOn)}</strong>
                  {photo.pose ? <span className="muted"> · {he.photos[`pose_${photo.pose}`]}</span> : null}
                  {photo.note ? <span className="photo-note">{photo.note}</span> : null}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="compare-gap">
            <ArrowsLeftRight size={16} aria-hidden />{' '}
            {chosen[0]!.takenOn === chosen[1]!.takenOn
              ? he.photos.sameDay
              : fill(he.photos.daysApart, {
                  n: daysApart(chosen[0]!.takenOn, chosen[1]!.takenOn),
                })}
          </p>
        </Card>
      ) : chosen.length === 1 ? (
        <p className="banner info">{he.photos.pickAnother}</p>
      ) : null}

      <Card title={he.photos.title} sub={he.photos.sub}>
        <div className="photo-grid">
          {photos.value.map((photo) => {
            const selected = picked.includes(photo.id);
            return (
              <div className={`photo-tile${selected ? ' selected' : ''}`} key={photo.id}>
                <button
                  type="button"
                  className="photo-open"
                  onClick={() => setEnlarged(photo)}
                  aria-label={`${he.photos.open}: ${formatDayLong(photo.takenOn)}`}
                >
                  <Picture photo={photo} url={urls?.[photo.id]} loading={urls === null} />
                </button>
                <div className="photo-meta">
                  <span>
                    <strong>{formatDayShort(photo.takenOn)}</strong>
                    {photo.pose ? (
                      <span className="muted"> · {he.photos[`pose_${photo.pose}`]}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="chip"
                    aria-pressed={selected}
                    onClick={() => toggle(photo.id)}
                  >
                    {selected ? <CheckCircle size={14} weight="fill" aria-hidden /> : null}
                    {selected ? he.photos.comparing : he.photos.compare}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {enlarged ? (
        <Dialog
          title={formatDayLong(enlarged.takenOn)}
          onClose={() => setEnlarged(null)}
          actions={
            <Button variant="ghost" onClick={() => setEnlarged(null)}>
              {he.photos.close}
            </Button>
          }
        >
          <div className="photo-large">
            <Picture
              key={enlarged.id}
              photo={enlarged}
              url={urls?.[enlarged.id]}
              loading={urls === null}
            />
          </div>
          {enlarged.note ? <p>{enlarged.note}</p> : null}
        </Dialog>
      ) : null}
    </>
  );
}

function Picture({
  photo,
  url,
  loading,
}: {
  photo: CoachPhoto;
  url: string | undefined;
  loading: boolean;
}) {
  // Broken is about one link: a fresh one for the same photo gets its own chance.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  if (loading) return <span className="photo-frame placeholder" aria-hidden />;
  if (!url || brokenUrl === url) {
    return (
      <span className="photo-frame placeholder">
        <ImageBroken size={28} weight="duotone" aria-hidden />
        <span>{he.photos.missing}</span>
      </span>
    );
  }
  return (
    <img
      className="photo-frame"
      src={url}
      alt={`${formatDayLong(photo.takenOn)}${photo.pose ? ` · ${he.photos[`pose_${photo.pose}`]}` : ''}`}
      loading="lazy"
      // Never sent along when the picture is fetched: the link is the only key it needs.
      referrerPolicy="no-referrer"
      onError={() => setBrokenUrl(url)}
    />
  );
}
