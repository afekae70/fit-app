/**
 * Share a workout as a picture: the card, shown, with a button that sends it.
 *
 * The card is on screen before it is sent, for two reasons. The first is the person's: it is
 * their workout going to their friends, and they should see what is about to be sent. The
 * second is the machine's — a view is photographed from the screen, so the preview is not a
 * copy of what will be shared, it *is* what will be shared.
 *
 * ## The two native pieces
 *
 * `react-native-view-shot` turns the card into a PNG in the app's cache, and `expo-sharing`
 * hands that file to the system's share sheet. React Native's own `Share` can pass text on
 * Android and nothing else, which is why a picture needs both. They are loaded only when the
 * button is pressed: a build made before they were added still opens this screen, and says
 * that the picture is not available rather than failing somewhere less obvious.
 *
 * Text is always still on offer here. A picture that cannot be made is not a reason for the
 * workout not to be shared at all.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hapticLight } from '../../haptics.js';
import { isRtlLanguage, type Language } from '../../i18n/index.js';
import { useTheme } from '../../ThemeProvider.js';
import { radius, spacing, type ColorPalette } from '../../theme.js';
import type { ShareCardModel } from '../../workout/shareCard.js';
import { BrandButton } from '../BrandButton.js';
import { Text } from '../Text.js';
import { WorkoutShareCard } from './WorkoutShareCard.js';

export interface ShareCardModalProps {
  visible: boolean;
  /** What the card says. Null while there is nothing to show; the modal stays shut. */
  model: ShareCardModel | null;
  /** The card's last line: where it came from. */
  footer: string;
  onClose: () => void;
  /** Send the workout as text instead — the fallback, and a choice in its own right. */
  onShareText: () => void;
}

/** Photograph a view and hand the picture to the share sheet. Throws when it cannot. */
async function shareView(target: View, dialogTitle: string): Promise<void> {
  const [{ captureRef }, Sharing] = await Promise.all([
    import('react-native-view-shot'),
    import('expo-sharing'),
  ]);
  if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
  const uri = await captureRef(target, { format: 'png', quality: 1, result: 'tmpfile' });
  await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle, UTI: 'public.png' });
}

export function ShareCardModal({
  visible,
  model,
  footer,
  onClose,
  onShareText,
}: ShareCardModalProps) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const card = useRef<View>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // A `Modal` renders into its own native root, outside the `direction` wrapper in `_layout`.
  const direction = isRtlLanguage(i18n.language as Language) ? 'rtl' : 'ltr';

  const close = () => {
    setFailed(false);
    onClose();
  };

  const share = () => {
    const target = card.current;
    if (!target || busy) return;
    setBusy(true);
    setFailed(false);
    void shareView(target, t('history.share'))
      // Dismissing the share sheet is not a failure: the picture was made and offered.
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  if (!model) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={[styles.backdrop, { direction }]}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <WorkoutShareCard ref={card} model={model} footer={footer} />

          <View style={styles.actions}>
            <BrandButton label={t('history.shareImage')} onPress={share} busy={busy} />
            {failed ? <Text style={styles.failed}>{t('history.shareImageFailed')}</Text> : null}
            <Pressable
              onPress={() => {
                void hapticLight();
                close();
                onShareText();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>{t('history.shareAsText')}</Text>
            </Pressable>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Text style={styles.closeText}>{t('common.cancel')}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<{
    backdrop: ViewStyle;
    content: ViewStyle;
    actions: ViewStyle;
    failed: TextStyle;
    secondary: ViewStyle;
    secondaryText: TextStyle;
    closeButton: ViewStyle;
    closeText: TextStyle;
    pressed: ViewStyle;
  }>({
    // Dark behind the card in both schemes: it is a picture being held up, and the dimmer
    // the room, the truer its colours read.
    backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.72)' },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      gap: spacing.xl,
    },
    actions: { alignSelf: 'stretch', gap: spacing.sm, maxWidth: 360, width: '100%' },
    failed: { color: colors.warning, fontSize: 13, textAlign: 'center' },
    secondary: {
      minHeight: 50,
      borderRadius: radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    closeButton: {
      alignSelf: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    // On the dark backdrop in either scheme, so a fixed light tone rather than a palette text
    // colour that is near-black in daylight.
    closeText: { color: 'rgba(255, 255, 255, 0.8)', fontSize: 14 },
    pressed: { opacity: 0.7 },
  });
