/**
 * Logging a packaged food by its barcode.
 *
 * Point the camera at the packet; the app reads the number, asks a public database what is
 * printed on the label, and asks the person one thing — how much of it they ate. What comes
 * back is the label, not an estimate, which is why this exists beside the photograph scan: a
 * yoghurt has a barcode, and guessing at it from a picture would be the worse answer.
 *
 * ## The camera
 *
 * `expo-camera`, which reads the barcode on the phone itself: no picture is taken and none
 * leaves it. The camera is on only while the screen is waiting for a barcode, and is taken
 * off the screen the moment one is read.
 *
 * A number can also be typed. The camera will not read a crumpled packet or one under a
 * refrigerator's light, and the digits printed beneath the bars are the same thing.
 *
 * ## What is read
 *
 * Only a code whose check digit agrees is acted on (`productCode`). A frame in which a digit
 * was misread is simply ignored — the next one, a thirtieth of a second later, will be right
 * — rather than looked up as the different product it would name.
 *
 * ## What is sent
 *
 * The digits, to Open Food Facts, and nothing else (`barcodeClient.ts`).
 */

import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, useLocalSearchParams } from 'expo-router';
import { Barcode, MagnifyingGlass, WarningCircle } from 'phosphor-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCurrentUserId } from '../src/auth/CurrentUserProvider.js';
import { BrandButton } from '../src/components/BrandButton.js';
import { Field } from '../src/components/Field.js';
import { KeyboardSafe } from '../src/components/KeyboardSafe.js';
import { Pressable } from '../src/components/Pressable.js';
import { Text } from '../src/components/Text.js';
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
  productCode,
  productLabel,
  productMacros,
  type BarcodeFailure,
  type Product,
} from '../src/food/barcode.js';
import { lookUpBarcode } from '../src/food/barcodeClient.js';
import { parseAmount } from '../src/food/foodMath.js';
import { hapticLight, hapticSuccess } from '../src/haptics.js';
import { useTheme } from '../src/ThemeProvider.js';
import { fontSize, fontWeight, radius, spacing, type ColorPalette } from '../src/theme.js';

type Stage =
  /** Waiting for a barcode: the camera is on. */
  | { kind: 'aim' }
  | { kind: 'looking' }
  | { kind: 'found'; product: Product }
  | { kind: 'failed'; error: BarcodeFailure };

export default function FoodBarcodeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = useCurrentUserId();
  const params = useLocalSearchParams<{ date?: string }>();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : localDate(new Date());

  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<Stage>({ kind: 'aim' });
  const [typed, setTyped] = useState('');
  const [gramsRaw, setGramsRaw] = useState('100');
  const [saving, setSaving] = useState(false);
  // A lookup answered after the person has moved on must not replace what they are looking at.
  const latest = useRef(0);
  // The camera reports the same barcode many times a second. Only the first is acted on.
  const reading = useRef(false);

  // Asked for once, on arrival: this screen was opened by pressing "scan a barcode", so the
  // question follows from something the person just did. Not asked again by itself — a second
  // prompt straight after a refusal is the app arguing.
  const asked = useRef(false);
  useEffect(() => {
    if (!permission || permission.granted || asked.current) return;
    asked.current = true;
    if (permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const lookUp = (raw: string) => {
    const ticket = (latest.current += 1);
    setStage({ kind: 'looking' });
    void lookUpBarcode(raw).then((outcome) => {
      if (latest.current !== ticket) return;
      if (!outcome.ok) {
        setStage({ kind: 'failed', error: outcome.error });
        return;
      }
      hapticSuccess();
      setGramsRaw(String(outcome.product.servingGrams ?? 100));
      setStage({ kind: 'found', product: outcome.product });
    });
  };

  const onScanned = (result: BarcodeScanningResult) => {
    if (reading.current) return;
    // A misread frame is not an error to report; the next frame will read it properly.
    const code = productCode(result.data);
    if (code === null) return;
    reading.current = true;
    lookUp(code);
  };

  const aimAgain = () => {
    hapticLight();
    latest.current += 1;
    reading.current = false;
    setTyped('');
    setStage({ kind: 'aim' });
  };

  const grams = parseAmount(gramsRaw);
  const product = stage.kind === 'found' ? stage.product : null;
  const preview = product && grams !== null ? productMacros(product, grams) : null;

  const save = () => {
    if (!product || !preview || grams === null || saving) return;
    setSaving(true);
    void (async () => {
      const id = await addFoodEntry(await getExecutor(), userId, newId, {
        eatenOn: date,
        name: productLabel(product),
        grams,
        calories: preview.calories,
        proteinG: preview.proteinG,
        carbsG: preview.carbsG,
        fatG: preview.fatG,
      });
      if (id) {
        hapticSuccess();
        router.back();
      } else {
        setSaving(false);
      }
    })().catch(() => setSaving(false));
  };

  const cameraAllowed = permission?.granted === true;

  return (
    <KeyboardSafe>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader title={t('barcode.title')} />

        {stage.kind === 'aim' ? (
          <>
            {cameraAllowed ? (
              <View style={styles.cameraFrame}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a'] }}
                  onBarcodeScanned={onScanned}
                />
                {/* Where to hold the barcode. Decoration only: the whole frame is read. */}
                <View pointerEvents="none" style={styles.guide} />
              </View>
            ) : permission ? (
              <Card>
                <EmptyState icon={Barcode} title={t('barcode.needCamera')} />
                {permission.canAskAgain ? (
                  <Button
                    label={t('barcode.allowCamera')}
                    onPress={() => void requestPermission()}
                  />
                ) : (
                  <Button
                    label={t('barcode.openSettings')}
                    variant="secondary"
                    onPress={() => void Linking.openSettings()}
                  />
                )}
              </Card>
            ) : (
              <View style={styles.cameraFrame} />
            )}
            {cameraAllowed ? <Text style={styles.aim}>{t('barcode.aim')}</Text> : null}

            <Card>
              <SectionTitle>{t('barcode.typeInstead')}</SectionTitle>
              <View style={styles.typed}>
                <View style={styles.typedField}>
                  <Field
                    icon={MagnifyingGlass}
                    value={typed}
                    onChangeText={(value) => setTyped(value.replace(/\D/g, '').slice(0, 13))}
                    keyboardType="number-pad"
                    placeholder={t('barcode.codePlaceholder')}
                    returnKeyType="search"
                    onSubmitEditing={() => typed !== '' && lookUp(typed)}
                  />
                </View>
                <Pressable
                  onPress={() => lookUp(typed)}
                  disabled={typed === ''}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.find,
                    typed === '' && styles.findOff,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.findText}>{t('barcode.find')}</Text>
                </Pressable>
              </View>
            </Card>
          </>
        ) : null}

        {stage.kind === 'looking' ? (
          <View style={styles.waiting}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.waitingText}>{t('barcode.looking')}</Text>
          </View>
        ) : null}

        {product ? (
          <>
            <Card tone="accent">
              <Text style={styles.name}>{product.name}</Text>
              {product.brand ? <Text style={styles.brand}>{product.brand}</Text> : null}
              <Text style={styles.per100}>
                {product.kcal} {t('food.per100')}
              </Text>

              <View style={styles.servings}>
                {[
                  ...(product.servingGrams !== null
                    ? [{ grams: product.servingGrams, label: t('barcode.serving') }]
                    : []),
                  { grams: 100, label: null },
                ].map((option) => {
                  const amount = String(option.grams);
                  const on = gramsRaw === amount;
                  return (
                    <Pressable
                      key={`${option.label ?? 'plain'}-${amount}`}
                      onPress={() => {
                        hapticLight();
                        setGramsRaw(amount);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={[styles.serving, on && styles.servingOn]}
                    >
                      <Text style={[styles.servingText, on && styles.servingTextOn]}>
                        {option.label ? `${option.label} · ` : ''}
                        {amount} {t('common.grams')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Field
                value={gramsRaw}
                onChangeText={setGramsRaw}
                keyboardType="decimal-pad"
                placeholder={t('food.gramsPlaceholder')}
                trailing={<Text style={styles.unit}>{t('common.grams')}</Text>}
                selectTextOnFocus
              />
              <Text style={styles.preview}>
                {!preview
                  ? t('food.enterAmount')
                  : preview.proteinG !== null
                    ? t('food.preview', { calories: preview.calories, protein: preview.proteinG })
                    : `${preview.calories} ${t('common.kcal')}`}
              </Text>
              <BrandButton
                label={t('food.addThis')}
                disabled={!preview}
                busy={saving}
                onPress={save}
              />
            </Card>
            <Button label={t('barcode.another')} variant="secondary" onPress={aimAgain} />
            <Hint>{t('barcode.source')}</Hint>
          </>
        ) : null}

        {stage.kind === 'failed' ? (
          <>
            <EmptyState icon={WarningCircle} title={t(`barcode.failed_${stage.error}`)} />
            <BrandButton label={t('barcode.retry')} onPress={aimAgain} />
            {stage.error === 'not_found' || stage.error === 'no_values' ? (
              <Button
                label={t('food.byHand')}
                variant="secondary"
                // Replaced, not pushed: going back from the by-hand screen should land on the
                // day, not on a message about a product that was not found.
                onPress={() => router.replace({ pathname: '/food-add', params: { date } })}
              />
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardSafe>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create({
    screen: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, gap: spacing.lg },

    cameraFrame: {
      height: 240,
      borderRadius: radius.xl,
      overflow: 'hidden',
      backgroundColor: colors.surfaceHigh,
      alignItems: 'center',
      justifyContent: 'center',
    },
    camera: { ...StyleSheet.absoluteFillObject },
    guide: {
      width: '78%',
      height: 96,
      borderRadius: radius.md,
      borderWidth: 2,
      borderColor: colors.accent,
    },
    aim: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'center' },

    typed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    typedField: { flex: 1 },
    find: {
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    findOff: { opacity: 0.4 },
    findText: { color: colors.bg, fontSize: fontSize.md, fontWeight: fontWeight.bold },
    pressed: { opacity: 0.6 },

    waiting: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
    waitingText: { color: colors.textMuted, fontSize: fontSize.md },

    name: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
    },
    brand: { color: colors.textMuted, fontSize: fontSize.sm, textAlign: 'auto' },
    per100: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      textAlign: 'auto',
      marginTop: spacing.xs,
      marginBottom: spacing.md,
    },
    servings: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
    serving: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceRaised,
    },
    servingOn: { backgroundColor: colors.accent },
    servingText: {
      color: colors.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
    },
    servingTextOn: { color: colors.bg, fontWeight: fontWeight.bold },
    unit: { color: colors.textMuted, fontSize: fontSize.sm },
    preview: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: fontWeight.bold,
      textAlign: 'auto',
      marginVertical: spacing.md,
    },
  });
