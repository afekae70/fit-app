/**
 * The app's own way of asking a question, in place of the operating system's.
 *
 * `Alert.alert` was used for every confirmation and every choice list. It works, but it is the
 * one surface in the app that ignores everything the rest of it decides: not the palette, not
 * the corner radii, not the type scale, and not the light/dark setting — an OS dialog stays
 * whatever the OS thinks it should be while the screen behind it is themed. On Android it also
 * renders its buttons in the platform's own arrangement, which is a row of capitals in the
 * corner, in the middle of an app that is otherwise Hebrew and RTL.
 *
 * ## Why a provider rather than a component
 *
 * `Alert.alert` is convenient *because* it is a call. A declarative dialog would put a piece of
 * state, a handler and a JSX block in each of the eight screens that ask something — the sort
 * of boilerplate that gets copied slightly wrong the ninth time.
 *
 * So the sheet is mounted once, at the root, and handed out as a function that returns a
 * promise. A call site keeps the shape it already had and loses the callback nesting:
 *
 *     if (await confirm({ message: t('history.confirmDelete'), confirmLabel: t('common.delete') })) {
 *       await remove(id);
 *     }
 *
 * ## One component for both jobs
 *
 * A confirmation and a choice list are the same thing with a different number of options, so
 * they are the same sheet. `confirm` is the two-action case, named separately only because that
 * is what the call sites actually say.
 *
 * ## Driver mode
 *
 * The slide comes from `Modal`'s own `animationType`, the same as `FinishSummary`. Nothing here
 * animates a value by hand, so there is no way to mix driver modes on one node — the crash
 * `SegmentButton` documents.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View, type ViewStyle, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hapticLight } from '../haptics.js';
import { isRtlLanguage, type Language } from '../i18n/index.js';
import { useTheme } from '../ThemeProvider.js';
import { fontSize, radius, spacing, type ColorPalette } from '../theme.js';

export interface SheetAction {
  label: string;
  /** Marks the one action that destroys something. At most one per sheet. */
  destructive?: boolean;
}

export interface SheetRequest {
  title?: string;
  message?: string;
  actions: readonly SheetAction[];
  /**
   * What the bottom row says. Defaults to "cancel", which is right when there is something to
   * cancel and wrong when there is not — a message that only reports something has nothing to
   * back out of, and offering to cancel it suggests the report itself could be undone.
   */
  dismissLabel?: string;
}

export interface ConfirmRequest {
  title?: string;
  message: string;
  confirmLabel: string;
  /** Confirmations that do not delete anything pass false, and lose the red. */
  destructive?: boolean;
}

interface AskApi {
  /**
   * Present a list of choices. Resolves with the index chosen, or null if it was dismissed —
   * null rather than -1 because "picked nothing" is a different kind of answer from "picked
   * something", and a number can be compared against by accident.
   */
  ask: (request: SheetRequest) => Promise<number | null>;
  /** The two-action case. Resolves true only on an explicit confirm. */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /**
   * Say something and offer no choice. The app's replacement for a one-button alert — a
   * refusal to start a second workout, and anything else that reports rather than asks.
   */
  notify: (request: { title?: string; message: string }) => Promise<void>;
}

const AskContext = createContext<AskApi | null>(null);

export function useActionSheet(): AskApi {
  const api = useContext(AskContext);
  if (!api) throw new Error('useActionSheet must be used inside ActionSheetProvider');
  return api;
}

export function ActionSheetProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  /**
   * A `Modal` renders into its own native root, outside the `direction` wrapper in `_layout`.
   * Nothing it contains inherits that wrapper's RTL, so `textAlign: 'auto'` inside the sheet
   * would resolve against the platform default and align a Hebrew title to the left while the
   * screen behind it is right-aligned. Set here for the same reason it is set there, and off
   * the same source of truth — the active language, not `I18nManager.isRTL`, which stays stale
   * until relaunch.
   */
  const direction = isRtlLanguage(i18n.language as Language) ? 'rtl' : 'ltr';
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [request, setRequest] = useState<SheetRequest | null>(null);
  // The promise's resolver, held across renders. A ref rather than state because resolving is
  // not something the sheet renders, and storing a function in state invites React to call it.
  const resolver = useRef<((index: number | null) => void) | null>(null);

  const settle = useCallback((index: number | null) => {
    setRequest(null);
    // Cleared before calling, so a handler that opens another sheet is not immediately closed
    // by the resolver of the one that opened it.
    const resolve = resolver.current;
    resolver.current = null;
    resolve?.(index);
  }, []);

  const ask = useCallback(
    (next: SheetRequest) => {
      // A sheet already open is answered as dismissed rather than dropped. Leaving its promise
      // unresolved would hang whatever awaited it, forever and silently.
      resolver.current?.(null);
      void hapticLight();
      setRequest(next);
      return new Promise<number | null>((resolve) => {
        resolver.current = resolve;
      });
    },
    [],
  );

  const confirm = useCallback(
    async ({ title, message, confirmLabel, destructive = true }: ConfirmRequest) => {
      const choice = await ask({
        title,
        message,
        actions: [{ label: confirmLabel, destructive }],
      });
      return choice === 0;
    },
    [ask],
  );

  const notify = useCallback(
    async ({ title, message }: { title?: string; message: string }) => {
      await ask({ title, message, actions: [], dismissLabel: t('common.gotIt') });
    },
    [ask, t],
  );

  const api = useMemo(() => ({ ask, confirm, notify }), [ask, confirm, notify]);

  return (
    <AskContext.Provider value={api}>
      {children}
      <Modal
        visible={request !== null}
        transparent
        animationType="slide"
        // The Android back button. Without this it dismisses the modal and leaves the promise
        // pending, which is the same hang as above by a different route.
        onRequestClose={() => settle(null)}
      >
        {/* Tapping away is a dismissal, which is why the backdrop is a button rather than a
            view. It carries no accessibility role: a screen reader is served by the cancel
            action below, and announcing the backdrop as a button would give it two. */}
        <Pressable style={styles.backdrop} onPress={() => settle(null)} accessible={false}>
          {/* Swallows presses so a tap inside the sheet does not reach the backdrop. */}
          <Pressable
            style={[styles.sheet, { direction, paddingBottom: insets.bottom + spacing.lg }]}
            onPress={() => undefined}
            accessible={false}
          >
            <View style={styles.grabber} />

            {request?.title ? <Text style={styles.title}>{request.title}</Text> : null}
            {request?.message ? <Text style={styles.message}>{request.message}</Text> : null}

            {request?.actions.map((action, index) => (
              <Pressable
                key={action.label}
                onPress={() => {
                  void hapticLight();
                  settle(index);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.action,
                  action.destructive && styles.actionDestructive,
                  pressed && styles.actionPressed,
                ]}
              >
                <Text
                  style={[styles.actionLabel, action.destructive && styles.actionLabelDestructive]}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}

            {/* Always last and always present. Every sheet can be backed out of, and the way out
                should sit in the same place each time rather than wherever a call site put it. */}
            <Pressable
              onPress={() => settle(null)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancel, pressed && styles.actionPressed]}
            >
              <Text style={styles.cancelLabel}>
                {request?.dismissLabel ?? t('common.cancel')}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </AskContext.Provider>
  );
}

interface Styles {
  backdrop: ViewStyle;
  sheet: ViewStyle;
  grabber: ViewStyle;
  title: TextStyle;
  message: TextStyle;
  action: ViewStyle;
  actionDestructive: ViewStyle;
  actionPressed: ViewStyle;
  actionLabel: TextStyle;
  actionLabelDestructive: TextStyle;
  cancel: ViewStyle;
  cancelLabel: TextStyle;
}

const createStyles = (colors: ColorPalette) =>
  StyleSheet.create<Styles>({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.surface,
      borderTopStartRadius: radius.xl,
      borderTopEndRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.sm,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.borderStrong,
      marginBottom: spacing.sm,
    },
    title: {
      color: colors.text,
      fontSize: fontSize.lg,
      fontWeight: '700',
      textAlign: 'auto',
      marginBottom: spacing.xxs,
    },
    message: {
      color: colors.textMuted,
      fontSize: fontSize.sm,
      lineHeight: 20,
      textAlign: 'auto',
      marginBottom: spacing.xs,
    },
    action: {
      backgroundColor: colors.surfaceRaised,
      borderRadius: radius.md,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.lg,
      // Tall enough to be an easy target, and the same height as the app's buttons so the sheet
      // does not read as a different app's component.
      minHeight: 52,
      justifyContent: 'center',
    },
    actionDestructive: { backgroundColor: colors.dangerSoft },
    actionPressed: { opacity: 0.7 },
    actionLabel: {
      color: colors.text,
      fontSize: fontSize.md,
      fontWeight: '600',
      textAlign: 'center',
    },
    actionLabelDestructive: { color: colors.danger },
    cancel: {
      borderRadius: radius.md,
      paddingVertical: spacing.lg,
      minHeight: 52,
      justifyContent: 'center',
      marginTop: spacing.xxs,
    },
    cancelLabel: {
      color: colors.textMuted,
      fontSize: fontSize.md,
      fontWeight: '600',
      textAlign: 'center',
    },
  });
