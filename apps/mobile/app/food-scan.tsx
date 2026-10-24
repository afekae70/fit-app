/**
 * Photograph a meal, and log what it comes to.
 *
 * The slow part of a food log is the typing: finding each thing on the plate, guessing its
 * weight, adding it. This asks for one photograph instead and comes back with a list — rice,
 * 180 g, 234 kcal — for the person to correct and confirm.
 *
 * ## It is an estimate, and the screen is built around that
 *
 * A model looking at a photo cannot weigh anything. What it returns is a guess at what the
 * food is and a rougher guess at how much. So nothing is logged on arrival: the result is a
 * list to review, the portion of every item is a field with −/+ beside it — the portion is
 * what is most often wrong, and what the person at the table knows best — an item that is not
 * there can be removed, and the only thing that writes to the day is the button at the bottom.
 * That is the rule for every piece of AI output in this app (see CLAUDE.md), and here it is
 * also simply what the numbers deserve.
 *
 * ## What leaves the phone
 *
 * The photograph, and nothing else — not the day, not the account's log. It goes to the
 * app's own server function and from there to the model, and is stored by neither. The screen
 * says so before the camera opens, because a camera button is a promise about where the
 * picture goes.
 *
 * The talking to the camera and the server is `food/scanClient.ts`; what is done with the
 * answer is `food/scanEstimate.ts`, which is tested. This file is the four things the screen
 * can be showing: the invitation, the wait, the list, and what went wrong.
 */

import type { FoodScanItem, FoodScanResult } from '@fit/shared/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ForkKnife, Image as ImageIcon, WarningCircle, X } from 'phosphor-react-native';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { Glyph } from '../src/components/Glyph.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { Pressable } from '../src/components/Pressable.js';
import { Text, TextInput } from '../src/components/Text.js';
import {
  Button,
  Card,
  EmptyState,
  Hint,
  ScreenHeader,
  SectionTitle,
} from '../src/components/ui.js';
import { addFoodEntry } from '../src/db/food.js';
import { getExecutor, newId } from '../src/db/provider.js';
import { localDate } from '../src/db/schedule.js';
import {
  pickMealPhoto,
  scanMeal,
  takeMealPhoto,
  type MealPhoto,
  type PhotoOutcome,
} from '../src/food/scanClient.js';
import {
  scanTotals,
  toFoodEntries,
  withGrams,
  type ScanFailure,
} from '../src/food/scanEstimate.js';
import { hapticLight, hapticSuccess } from '../src/haptics.js';
import { AiAgeNotice } from '../src/components/AiAgeNotice.js';
import { useAiAge } from '../src/coach/useAiAge.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

/** How far one tap on − or + moves a portion. A spoonful, roughly. */
const GRAM_STEP = 10;

/** One line of the list being reviewed. */
interface Line {
  id: number;
  /** What the model said, untouched. Every correction is worked out from this. */
  estimate: FoodScanItem;
  /**
   * The portion as it stands in the field, as text: it is being typed, and "2" on the way to
   * "250" has to be allowed to exist.
   */
  grams: string;
}

type Stage =
  | { kind: 'ask' }
  | { kind: 'scanning'; photo: MealPhoto }
  | { kind: 'review'; photo: MealPhoto; confidence: FoodScanResult['confidence'] }
  | { kind: 'nothing'; photo: MealPhoto }
  | { kind: 'failed'; error: ScanFailure };

const gramsOf = (line: Line): number | null => {
  const value = Number(line.grams.replace(',', '.'));
  return line.grams.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
};

/** The line as it will be saved: the estimate at the portion now in the field. */
const current = (line: Line): FoodScanItem => {
  const grams = gramsOf(line);
  return grams === null ? line.estimate : withGrams(line.estimate, grams);
};

export default function FoodScanScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : localDate(new Date());

  const [stage, setStage] = useState<Stage>({ kind: 'ask' });
  // The food screen offers no way here under 18 (AI_MIN_AGE); this is for any other way in.
  const aiAge = useAiAge();
  const [lines, setLines] = useState<Line[]>([]);
  const [saving, setSaving] = useState(false);
  // A scan that is answered after the person has started another must not replace it.
  const latest = useRef(0);

  const scan = (outcome: PhotoOutcome) => {
    if (!outcome.ok) {
      // Backing out of the camera is not a failure and has nothing to say for itself.
      if (outcome.error !== 'cancelled') setStage({ kind: 'failed', error: outcome.error });
      return;
    }
    const { photo } = outcome;
    const ticket = (latest.current += 1);
    setStage({ kind: 'scanning', photo });
    void scanMeal(photo, i18n.language).then((answer) => {
      if (latest.current !== ticket) return;
      if (!answer.ok) {
        setStage({ kind: 'failed', error: answer.error });
        return;
      }
      if (answer.result.items.length === 0) {
        setStage({ kind: 'nothing', photo });
        return;
      }
      setLines(
        answer.result.items.map((estimate, id) => ({
          id,
          estimate,
          grams: String(Math.round(estimate.grams)),
        })),
      );
      setStage({ kind: 'review', photo, confidence: answer.result.confidence });
    });
  };

  const fromCamera = () => {
    void hapticLight();
    void takeMealPhoto().then(scan);
  };
  const fromGallery = () => {
    void hapticLight();
    void pickMealPhoto().then(scan);
  };

  const setGrams = (id: number, grams: string) =>
    setLines((all) => all.map((line) => (line.id === id ? { ...line, grams } : line)));
  const nudge = (line: Line, by: number) => {
    void hapticLight();
    const next = Math.max(GRAM_STEP, Math.round((gramsOf(line) ?? line.estimate.grams) + by));
    setGrams(line.id, String(next));
  };
  const remove = (id: number) => {
    void hapticLight();
    setLines((all) => all.filter((line) => line.id !== id));
  };

  const ready = lines.length > 0 && lines.every((line) => gramsOf(line) !== null);
  const totals = scanTotals(lines.map(current));

  /** The one path from an estimate to the log: the person, having looked, saying yes. */
  const save = () => {
    if (!ready || saving) return;
    setSaving(true);
    void (async () => {
      const db = await getExecutor();
      for (const entry of toFoodEntries(lines.map(current), date)) {
        await addFoodEntry(db, userId, newId, entry);
      }
      hapticSuccess();
      router.back();
    })().catch(() => setSaving(false));
  };

  const photoButtons = (
    <View style={styles.buttons}>
      <BrandButton label={t('foodScan.takePhoto')} onPress={fromCamera} />
      <Button label={t('foodScan.fromGallery')} variant="secondary" onPress={fromGallery} />
    </View>
  );

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
        <ScreenHeader title={t('foodScan.title')} />

        {aiAge === 'minor' || aiAge === 'unknown' ? (
          <>
            <AiAgeNotice verdict={aiAge} />
            <Button
              label={t('foodScan.byHand')}
              variant="ghost"
              onPress={() => router.replace({ pathname: '/food-add', params: { date } })}
            />
          </>
        ) : null}

        {stage.kind === 'ask' && aiAge === 'adult' ? (
          <>
            <Card style={styles.invite}>
              <View style={styles.inviteIcon}>
                <Camera size={34} color={colors.accent} weight="duotone" />
              </View>
              <Text style={styles.inviteTitle}>{t('foodScan.inviteTitle')}</Text>
              <Text style={styles.inviteBody}>{t('foodScan.inviteBody')}</Text>
            </Card>
            {photoButtons}
            {/* Before the camera opens, not after: where the picture goes is part of deciding
                whether to take it. */}
            <Hint>{t('foodScan.privacy')}</Hint>
          </>
        ) : null}

        {stage.kind === 'scanning' ? (
          <Card style={styles.waiting}>
            <Image source={{ uri: stage.photo.uri }} style={styles.photo} resizeMode="cover" />
            <View style={styles.waitingRow}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.waitingText}>{t('foodScan.scanning')}</Text>
            </View>
          </Card>
        ) : null}

        {stage.kind === 'review' ? (
          <>
            <Card style={styles.summary}>
              <Image source={{ uri: stage.photo.uri }} style={styles.thumb} resizeMode="cover" />
              <View style={styles.summaryText}>
                <Text style={styles.summaryCalories}>
                  {totals.calories.toLocaleString()}
                  <Text style={styles.summaryUnit}> {t('common.kcal')}</Text>
                </Text>
                <Text style={styles.summaryMacros}>
                  {t('foodScan.macros', {
                    protein: totals.proteinG,
                    carbs: totals.carbsG,
                    fat: totals.fatG,
                  })}
                </Text>
              </View>
            </Card>

            {/* Said in the model's own terms, and then in the app's: check before saving. */}
            <Text style={[styles.confidence, stage.confidence === 'low' && styles.confidenceLow]}>
              {t(`foodScan.confidence_${stage.confidence}`)} {t('foodScan.reviewHint')}
            </Text>

            <SectionTitle>{t('foodScan.found')}</SectionTitle>
            <View style={styles.list}>
              {lines.map((line) => {
                const item = current(line);
                const valid = gramsOf(line) !== null;
                return (
                  <View key={line.id} style={styles.line}>
                    <View style={styles.lineHead}>
                      <Text style={styles.lineName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.lineCalories}>
                        {Math.round(item.calories).toLocaleString()}
                        <Text style={styles.lineUnit}> {t('common.kcal')}</Text>
                      </Text>
                    </View>
                    <Text style={styles.lineMacros}>
                      {t('foodScan.macros', {
                        protein: item.proteinG,
                        carbs: item.carbsG,
                        fat: item.fatG,
                      })}
                    </Text>

                    <View style={styles.lineControls}>
                      <Pressable
                        onPress={() => nudge(line, -GRAM_STEP)}
                        accessibilityRole="button"
                        accessibilityLabel={t('foodScan.less', { name: item.name })}
                        style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                      >
                        <Text style={styles.stepText}>−</Text>
                      </Pressable>
                      <View style={[styles.gramsBox, !valid && styles.gramsBoxInvalid]}>
                        <TextInput
                          value={line.grams}
                          onChangeText={(text) => setGrams(line.id, text.replace(/[^0-9.,]/g, ''))}
                          keyboardType="decimal-pad"
                          maxLength={6}
                          selectTextOnFocus
                          accessibilityLabel={t('foodScan.gramsOf', { name: item.name })}
                          style={styles.gramsInput}
                        />
                        <Text style={styles.gramsUnit}>{t('common.grams')}</Text>
                      </View>
                      <Pressable
                        onPress={() => nudge(line, GRAM_STEP)}
                        accessibilityRole="button"
                        accessibilityLabel={t('foodScan.more', { name: item.name })}
                        style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                      >
                        <Text style={styles.stepText}>+</Text>
                      </Pressable>
                      <View style={styles.spacer} />
                      <Pressable
                        onPress={() => remove(line.id)}
                        accessibilityRole="button"
                        accessibilityLabel={t('foodScan.remove', { name: item.name })}
                        hitSlop={8}
                        style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
                      >
                        <Glyph icon={X} style={styles.removeGlyph} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>

            {lines.length === 0 ? <Hint>{t('foodScan.allRemoved')}</Hint> : null}

            <BrandButton
              label={t('foodScan.save', { count: lines.length })}
              onPress={save}
              disabled={!ready}
              busy={saving}
            />
            <Button label={t('foodScan.again')} variant="ghost" onPress={fromCamera} />
          </>
        ) : null}

        {stage.kind === 'nothing' ? (
          <>
            <EmptyState
              icon={ForkKnife}
              title={t('foodScan.nothingTitle')}
              hint={t('foodScan.nothingHint')}
            />
            {photoButtons}
          </>
        ) : null}

        {stage.kind === 'failed' ? (
          <>
            <Card style={styles.invite}>
              <View style={styles.inviteIcon}>
                {stage.error === 'camera_denied' ? (
                  <ImageIcon size={34} color={colors.accent} weight="duotone" />
                ) : (
                  <WarningCircle size={34} color={colors.warning} weight="duotone" />
                )}
              </View>
              <Text style={styles.inviteBody}>{t(`foodScan.errors.${stage.error}`)}</Text>
            </Card>
            {photoButtons}
            <Button
              label={t('foodScan.byHand')}
              variant="ghost"
              onPress={() => router.replace({ pathname: '/food-add', params: { date } })}
            />
          </>
        ) : null}
      </ScrollView>
    </KeyboardSafe>
  );
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
    waiting: ViewStyle;
    photo: ImageStyle;
    waitingRow: ViewStyle;
    waitingText: TextStyle;
    summary: ViewStyle;
    thumb: ImageStyle;
    summaryText: ViewStyle;
    summaryCalories: TextStyle;
    summaryUnit: TextStyle;
    summaryMacros: TextStyle;
    confidence: TextStyle;
    confidenceLow: TextStyle;
    list: ViewStyle;
    line: ViewStyle;
    lineHead: ViewStyle;
    lineName: TextStyle;
    lineCalories: TextStyle;
    lineUnit: TextStyle;
    lineMacros: TextStyle;
    lineControls: ViewStyle;
    step: ViewStyle;
    stepText: TextStyle;
    gramsBox: ViewStyle;
    gramsBoxInvalid: ViewStyle;
    gramsInput: TextStyle;
    gramsUnit: TextStyle;
    spacer: ViewStyle;
    remove: ViewStyle;
    removeGlyph: TextStyle;
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

    waiting: { gap: spacing.md },
    photo: { width: '100%', height: 220, borderRadius: radius.lg },
    waitingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    waitingText: { color: colors.textSecondary, fontSize: fontSize.sm },

    summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    thumb: { width: 72, height: 72, borderRadius: radius.md },
    summaryText: { flex: 1, gap: spacing.xxs },
    summaryCalories: {
      color: colors.text,
      fontSize: fontSize.xxl,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    summaryUnit: { color: colors.textMuted, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
    summaryMacros: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    confidence: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      lineHeight: 18,
      textAlign: 'auto',
    },
    // A low-confidence guess is said in the warning colour: it is the one case where the
    // numbers below should be distrusted before they are read.
    confidenceLow: { color: colors.warning },

    list: { gap: spacing.sm },
    line: {
      padding: spacing.md,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      gap: spacing.xs,
    },
    lineHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
    lineName: {
      flex: 1,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.medium,
      textAlign: 'auto',
    },
    lineCalories: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
    },
    lineUnit: { color: colors.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
    lineMacros: {
      color: colors.textMuted,
      fontSize: fontSize.xs,
      fontVariant: ['tabular-nums'],
      textAlign: 'auto',
    },
    lineControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    // 44 across: these are pressed with a thumb, between bites.
    step: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
    },
    stepText: { color: colors.textSecondary, fontSize: fontSize.xl, lineHeight: 26 },
    gramsBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      height: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    gramsBoxInvalid: { borderColor: colors.danger },
    gramsInput: {
      minWidth: 48,
      padding: 0,
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      fontVariant: ['tabular-nums'],
      textAlign: 'center',
    },
    gramsUnit: { color: colors.textMuted, fontSize: fontSize.xs },
    spacer: { flex: 1 },
    remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    removeGlyph: { color: colors.textFaint, fontSize: fontSize.md },
    pressed: { opacity: 0.7 },
  });
