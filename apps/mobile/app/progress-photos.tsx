/**
 * Progress photos — a picture now, to set beside one from before.
 *
 * The scale answers one question and answers it noisily; a mirror answers a different one and
 * has no memory. These are the mirror with a memory: a photo every week or two, from the same
 * angle, and any two of them side by side with the days between them and what the scale said
 * around each.
 *
 * Five things the screen can be showing: the gallery, a photo being added (its angle and a
 * note), one photo, the gallery again while a second is chosen, and the two side by side.
 *
 * ## Where the pictures go
 *
 * The phone's own folder, and a private bucket in the person's account (`photoSync.ts`). Nobody
 * else can open them — a coach only while the trainee has photo sharing on, which is a switch
 * on the coaching screen and off until turned on. The screen says so under the buttons, before
 * a photo is taken, for the reason the meal scan does: a camera button is a promise about where
 * the picture goes. The location the camera recorded is taken out before the file is kept.
 */

import type { PhotoPose } from '@fit/shared/coaching';
import { useFocusEffect } from 'expo-router';
import { ArrowsLeftRight, Camera, Image as ImageIcon, Trash } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { useActionSheet } from '../src/components/ActionSheetProvider.js';
import { BeforeAfterSlider } from '../src/components/BeforeAfterSlider.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { FadeSlideIn } from '../src/components/motion.js';
import { Pressable } from '../src/components/Pressable.js';
import { Text, TextInput } from '../src/components/Text.js';
import { Button, Card, Hint, ScreenHeader, Segmented } from '../src/components/ui.js';
import { listBodyMetrics } from '../src/db/metrics.js';
import {
  addProgressPhoto,
  deleteProgressPhoto,
  forgetPhotoFile,
  listProgressPhotos,
  MAX_PHOTO_NOTE,
  type ProgressPhoto,
} from '../src/db/progressPhotos.js';
import { getExecutor, newId } from '../src/db/provider.js';
import { localDate, parseLocalDate } from '../src/db/schedule.js';
import { hapticLight, hapticSuccess } from '../src/haptics.js';
import { daysBetween, inOrder, weightNear } from '../src/progressPhotos/compare.js';
import {
  deletePhotoFile,
  keepPhotoFile,
  photoFileExists,
  pickProgressPhoto,
  takeProgressPhoto,
  type TakenPhoto,
} from '../src/progressPhotos/files.js';
import { PhotoLock } from '../src/progressPhotos/PhotoLock.js';
import { remotePhotoUrl, syncProgressPhotosNow } from '../src/progressPhotos/photoSync.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';
import { useUnit } from '../src/UnitsProvider.js';
import { formatBodyWeight, kgToDisplay, weightUnitKey } from '../src/units.js';

type Stage =
  | { kind: 'gallery' }
  | { kind: 'add'; uri: string; takenOn: string }
  | { kind: 'view'; id: string }
  | { kind: 'pick'; firstId: string }
  | { kind: 'compare'; ids: [string, string] };

type PoseChoice = PhotoPose | 'none';

/** One frame with a line to drag, or two pictures side by side. */
type CompareMode = 'slider' | 'side';

type Failure = Exclude<TakenPhoto, { ok: true }>['error'] | 'not_saved';

interface Reading {
  measuredAt: string;
  weightKg: number | null;
}

const COLUMNS = 3;

export default function ProgressPhotosScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const { confirm } = useActionSheet();
  const unit = useUnit();
  const { width } = useWindowDimensions();

  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [stage, setStage] = useState<Stage>({ kind: 'gallery' });
  const [pose, setPose] = useState<PoseChoice>('front');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  // The slider first: laid over each other, the same waist is in the same place.
  const [compareMode, setCompareMode] = useState<CompareMode>('slider');

  const reload = useCallback(async () => {
    const db = await getExecutor();
    const [kept, metrics] = await Promise.all([
      listProgressPhotos(db, userId),
      listBodyMetrics(db, userId, 1000),
    ]);
    setPhotos(kept);
    setReadings(metrics.map((m) => ({ measuredAt: m.measured_at, weightKg: m.weight_kg })));
  }, [userId]);

  // Again on every return to the screen: sync may have brought photos from another phone.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const byId = (id: string) => photos.find((photo) => photo.id === id) ?? null;
  const dayLabel = (day: string) =>
    parseLocalDate(day).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  const weightOn = (day: string) => weightNear(readings, day, (iso) => localDate(new Date(iso)));
  const weightUnit = t(`common.${weightUnitKey(unit)}`);

  const took = (outcome: TakenPhoto) => {
    if (!outcome.ok) {
      if (outcome.error !== 'cancelled') setFailure(outcome.error);
      return;
    }
    setFailure(null);
    setNote('');
    setPose('front');
    setStage({ kind: 'add', uri: outcome.uri, takenOn: outcome.takenOn });
  };

  const save = () => {
    if (stage.kind !== 'add' || saving) return;
    setSaving(true);
    void (async () => {
      const id = newId();
      const kept = await keepPhotoFile(userId, id, stage.uri);
      const recorded =
        kept !== null &&
        (await addProgressPhoto(await getExecutor(), userId, {
          id,
          takenOn: stage.takenOn,
          pose: pose === 'none' ? null : pose,
          note,
          fileUri: kept,
        }));
      setSaving(false);
      if (!recorded) {
        if (kept) deletePhotoFile(kept);
        setFailure('not_saved');
        return;
      }
      hapticSuccess();
      await reload();
      setStage({ kind: 'gallery' });
      // Sent now rather than at the next sync, so the backup does not wait for one.
      void syncProgressPhotosNow(userId);
    })().catch(() => {
      setSaving(false);
      setFailure('not_saved');
    });
  };

  const remove = (photo: ProgressPhoto) => {
    void (async () => {
      const yes = await confirm({
        message: t('progressPhotos.confirmDelete'),
        confirmLabel: t('progressPhotos.delete'),
      });
      if (!yes) return;
      const db = await getExecutor();
      if (!(await deleteProgressPhoto(db, userId, photo.id))) return;
      // Off this phone at once, signed in or not; the server's copy goes with the next sync.
      if (photo.fileUri) {
        deletePhotoFile(photo.fileUri);
        await forgetPhotoFile(db, photo.id);
      }
      await reload();
      setStage({ kind: 'gallery' });
      void syncProgressPhotosNow(userId);
    })();
  };

  const tileWidth = Math.floor((width - spacing.lg * 2 - spacing.sm * (COLUMNS - 1)) / COLUMNS);

  const gallery = (onPick: (photo: ProgressPhoto) => void, exceptId?: string) => (
    <View style={styles.grid}>
      {photos
        .filter((photo) => photo.id !== exceptId)
        .map((photo, index) => (
          // A few at a time, in reading order, as every list in the app arrives.
          <FadeSlideIn key={photo.id} index={index}>
            <Pressable
              onPress={() => {
                void hapticLight();
                onPick(photo);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('progressPhotos.open', { date: dayLabel(photo.takenOn) })}
              style={({ pressed }) => [{ width: tileWidth }, pressed && styles.pressed]}
            >
              <PhotoImage
                photo={photo}
                userId={userId}
                style={[styles.tile, { width: tileWidth, height: (tileWidth * 4) / 3 }]}
              />
              <Text style={styles.tileDate} numberOfLines={1}>
                {parseLocalDate(photo.takenOn).toLocaleDateString(i18n.language, {
                  day: 'numeric',
                  month: 'short',
                })}
              </Text>
            </Pressable>
          </FadeSlideIn>
        ))}
    </View>
  );

  const failureNote = failure ? (
    <Text style={styles.failure}>{t(`progressPhotos.errors.${failure}`)}</Text>
  ) : null;

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title={
            stage.kind === 'compare' ? t('progressPhotos.compareTitle') : t('progressPhotos.title')
          }
        />

        <PhotoLock>
          {stage.kind === 'gallery' ? (
            <>
              {photos.length === 0 ? (
                <Card style={styles.invite}>
                  <View style={styles.inviteIcon}>
                    <Camera size={34} color={colors.accent} weight="duotone" />
                  </View>
                  <Text style={styles.inviteTitle}>{t('progressPhotos.inviteTitle')}</Text>
                  <Text style={styles.inviteBody}>{t('progressPhotos.inviteBody')}</Text>
                </Card>
              ) : null}
              <View style={styles.buttons}>
                <BrandButton
                  label={t('progressPhotos.take')}
                  onPress={() => {
                    void hapticLight();
                    void takeProgressPhoto().then(took);
                  }}
                />
                <Button
                  label={t('progressPhotos.fromGallery')}
                  variant="secondary"
                  onPress={() => {
                    void hapticLight();
                    void pickProgressPhoto().then(took);
                  }}
                />
              </View>
              {failureNote}
              <Hint>{t('progressPhotos.privacy')}</Hint>
              {photos.length > 0 ? (
                <>
                  <Text style={styles.count}>
                    {t('progressPhotos.count', { count: photos.length })}
                  </Text>
                  {gallery((photo) => setStage({ kind: 'view', id: photo.id }))}
                </>
              ) : null}
            </>
          ) : null}

          {stage.kind === 'add' ? (
            <>
              <Image source={{ uri: stage.uri }} style={styles.large} resizeMode="cover" />
              <Text style={styles.meta}>
                {t('progressPhotos.takenOn', { date: dayLabel(stage.takenOn) })}
              </Text>
              <Segmented<PoseChoice>
                label={t('progressPhotos.pose')}
                options={[
                  { value: 'front', label: t('progressPhotos.pose_front') },
                  { value: 'side', label: t('progressPhotos.pose_side') },
                  { value: 'back', label: t('progressPhotos.pose_back') },
                  { value: 'none', label: t('progressPhotos.poseNone') },
                ]}
                selected={pose}
                onSelect={setPose}
              />
              <View style={styles.noteBlock}>
                <Text style={styles.noteLabel}>{t('progressPhotos.note')}</Text>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={t('progressPhotos.notePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_PHOTO_NOTE}
                  style={styles.noteInput}
                />
              </View>
              {failureNote}
              <BrandButton label={t('progressPhotos.save')} onPress={save} busy={saving} />
              <Button
                label={t('progressPhotos.cancel')}
                variant="ghost"
                onPress={() => {
                  setFailure(null);
                  setStage({ kind: 'gallery' });
                }}
              />
            </>
          ) : null}

          {stage.kind === 'view'
            ? (() => {
                const photo = byId(stage.id);
                if (!photo) return null;
                const kg = weightOn(photo.takenOn);
                return (
                  <>
                    <PhotoImage photo={photo} userId={userId} style={styles.large} />
                    <Text style={styles.viewDate}>{dayLabel(photo.takenOn)}</Text>
                    <Text style={styles.meta}>
                      {[
                        photo.pose ? t(`progressPhotos.pose_${photo.pose}`) : null,
                        kg !== null ? `${formatBodyWeight(kg, unit)} ${weightUnit}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {photo.note ? <Text style={styles.note}>{photo.note}</Text> : null}
                    {photos.length > 1 ? (
                      <Pressable
                        onPress={() => setStage({ kind: 'pick', firstId: photo.id })}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                      >
                        <ArrowsLeftRight size={20} color={colors.accent} weight="bold" />
                        <Text style={styles.actionText}>{t('progressPhotos.compare')}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => remove(photo)}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                    >
                      <Trash size={20} color={colors.danger} weight="bold" />
                      <Text style={[styles.actionText, styles.danger]}>
                        {t('progressPhotos.delete')}
                      </Text>
                    </Pressable>
                    <Button
                      label={t('progressPhotos.back')}
                      variant="ghost"
                      onPress={() => setStage({ kind: 'gallery' })}
                    />
                  </>
                );
              })()
            : null}

          {stage.kind === 'pick' ? (
            <>
              <Text style={styles.inviteTitle}>{t('progressPhotos.pickSecond')}</Text>
              <Hint>{t('progressPhotos.pickSecondHint')}</Hint>
              {gallery(
                (photo) => setStage({ kind: 'compare', ids: [stage.firstId, photo.id] }),
                stage.firstId,
              )}
              <Button
                label={t('progressPhotos.cancel')}
                variant="ghost"
                onPress={() => setStage({ kind: 'view', id: stage.firstId })}
              />
            </>
          ) : null}

          {stage.kind === 'compare'
            ? (() => {
                const a = byId(stage.ids[0]);
                const b = byId(stage.ids[1]);
                if (!a || !b) return null;
                const [before, after] = inOrder(a, b);
                const days = daysBetween(before.takenOn, after.takenOn);
                const kgBefore = weightOn(before.takenOn);
                const kgAfter = weightOn(after.takenOn);
                const half = Math.floor((width - spacing.lg * 2 - spacing.sm) / 2);
                const change =
                  kgBefore !== null && kgAfter !== null
                    ? Math.round((kgToDisplay(kgAfter, unit) - kgToDisplay(kgBefore, unit)) * 10) /
                      10
                    : null;
                return (
                  <>
                    <Segmented<CompareMode>
                      label={t('progressPhotos.compareHow')}
                      options={[
                        { value: 'slider', label: t('progressPhotos.slider') },
                        { value: 'side', label: t('progressPhotos.sideBySide') },
                      ]}
                      selected={compareMode}
                      onSelect={setCompareMode}
                    />
                    {compareMode === 'slider' ? (
                      <>
                        <BeforeAfterSlider
                          before={(size) => (
                            <PhotoImage photo={before} userId={userId} style={size} />
                          )}
                          after={(size) => (
                            <PhotoImage photo={after} userId={userId} style={size} />
                          )}
                          beforeLabel={`${t('progressPhotos.before')} · ${dayLabel(before.takenOn)}`}
                          afterLabel={`${t('progressPhotos.after')} · ${dayLabel(after.takenOn)}`}
                        />
                        <Hint>{t('progressPhotos.sliderHint')}</Hint>
                      </>
                    ) : (
                      <View style={styles.pair}>
                        {[before, after].map((photo, index) => {
                          const kg = index === 0 ? kgBefore : kgAfter;
                          return (
                            <View key={photo.id} style={[styles.half, { width: half }]}>
                              <Text style={styles.halfLabel}>
                                {index === 0
                                  ? t('progressPhotos.before')
                                  : t('progressPhotos.after')}
                              </Text>
                              <PhotoImage
                                photo={photo}
                                userId={userId}
                                style={[styles.tile, { width: half, height: (half * 4) / 3 }]}
                              />
                              <Text style={styles.halfDate}>{dayLabel(photo.takenOn)}</Text>
                              {kg !== null ? (
                                <Text style={styles.halfWeight}>
                                  {formatBodyWeight(kg, unit)} {weightUnit}
                                </Text>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    )}
                    <Card style={styles.summary}>
                      <Text style={styles.summaryText}>
                        {days === 0
                          ? t('progressPhotos.sameDay')
                          : t('progressPhotos.daysApart', { count: days })}
                      </Text>
                      {change !== null ? (
                        <Text style={styles.summaryText}>
                          {t('progressPhotos.weightChange', {
                            // A sign the reader can see either way; isolated so RTL keeps it in front.
                            change: `⁦${change > 0 ? '+' : ''}${change}⁩`,
                            unit: weightUnit,
                          })}
                        </Text>
                      ) : null}
                    </Card>
                    <Button
                      label={t('progressPhotos.back')}
                      variant="ghost"
                      onPress={() => setStage({ kind: 'gallery' })}
                    />
                  </>
                );
              })()
            : null}
        </PhotoLock>
      </ScrollView>
    </KeyboardSafe>
  );
}

/**
 * One photo, from wherever it is: this phone's folder, or — for one taken on another phone —
 * the private bucket, through a link signed for an hour. While neither is to hand, a quiet
 * placeholder rather than a broken image.
 */
function PhotoImage({
  photo,
  userId,
  style,
}: {
  photo: ProgressPhoto;
  userId: string;
  style: StyleProp<ImageStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useTranslation();
  const local = photo.fileUri && photoFileExists(photo.fileUri) ? photo.fileUri : null;
  const [remote, setRemote] = useState<string | null>(null);

  useEffect(() => {
    if (local) return;
    let live = true;
    void remotePhotoUrl(userId, photo.id).then((url) => {
      if (live) setRemote(url);
    });
    return () => {
      live = false;
    };
  }, [local, userId, photo.id]);

  const uri = local ?? remote;
  if (!uri) {
    return (
      <View
        style={[style, styles.placeholder]}
        accessibilityLabel={t('progressPhotos.unavailable')}
      >
        <ImageIcon size={28} color={colors.textFaint} weight="duotone" />
      </View>
    );
  }
  return <Image source={{ uri }} style={style} resizeMode="cover" />;
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    screen: ViewStyle;
    content: ViewStyle;
    buttons: ViewStyle;
    invite: ViewStyle;
    inviteIcon: ViewStyle;
    inviteTitle: TextStyle;
    inviteBody: TextStyle;
    failure: TextStyle;
    count: TextStyle;
    grid: ViewStyle;
    tile: ImageStyle;
    tileDate: TextStyle;
    placeholder: ViewStyle;
    large: ImageStyle;
    meta: TextStyle;
    viewDate: TextStyle;
    note: TextStyle;
    noteBlock: ViewStyle;
    noteLabel: TextStyle;
    noteInput: TextStyle;
    action: ViewStyle;
    actionText: TextStyle;
    danger: TextStyle;
    pair: ViewStyle;
    half: ViewStyle;
    halfLabel: TextStyle;
    halfDate: TextStyle;
    halfWeight: TextStyle;
    summary: ViewStyle;
    summaryText: TextStyle;
    pressed: ViewStyle;
  }>({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },
    buttons: { gap: spacing.sm },

    invite: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
    inviteIcon: {
      width: 72,
      height: 72,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    inviteTitle: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'center',
    },
    inviteBody: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      lineHeight: 21,
      textAlign: 'center',
    },
    failure: { color: colors.warning, fontSize: fontSize.sm, lineHeight: 20, textAlign: 'auto' },
    count: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },

    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    tile: { borderRadius: radius.md, backgroundColor: colors.surface },
    tileDate: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      marginTop: spacing.xxs,
      textAlign: 'center',
    },
    placeholder: { alignItems: 'center', justifyContent: 'center' },

    large: {
      width: '100%',
      aspectRatio: 3 / 4,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    meta: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    viewDate: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    note: { color: colors.text, fontSize: fontSize.md, lineHeight: 22, textAlign: 'auto' },
    noteBlock: { gap: spacing.xs },
    noteLabel: { color: colors.textSecondary, fontSize: fontSize.sm, textAlign: 'auto' },
    noteInput: {
      minHeight: 48,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      fontSize: fontSize.md,
      textAlign: 'auto',
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    actionText: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },
    danger: { color: colors.danger },

    pair: { flexDirection: 'row', gap: spacing.sm },
    half: { gap: spacing.xs },
    halfLabel: {
      color: colors.accent,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    halfDate: { color: colors.text, fontSize: fontSize.sm, textAlign: 'auto' },
    halfWeight: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    summary: { gap: spacing.xs },
    summaryText: { color: colors.text, fontSize: fontSize.md, textAlign: 'auto' },
    pressed: { opacity: 0.7 },
  });
