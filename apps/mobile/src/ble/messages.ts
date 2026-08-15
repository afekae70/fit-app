/**
 * Translation keys for the reasons a scan cannot run.
 *
 * Shared rather than repeated, because two screens now explain the same four failures and a
 * `Record<ScanUnavailableReason, string>` is exhaustive — adding a reason breaks compilation
 * here instead of silently leaving one screen with a blank message.
 *
 * Each failure gets its own message because each has a different remedy: install a development
 * build, turn Bluetooth on, or grant a permission. A single "scan failed" leaves the user with
 * nothing to act on.
 */

import type { ScanUnavailableReason } from './scanner.js';

export const BLE_REASON_MESSAGE: Record<ScanUnavailableReason, string> = {
  no_native_module: 'metrics.bleUnavailable',
  bluetooth_off: 'metrics.bleOff',
  permission_denied: 'metrics.blePermission',
  not_supported_platform: 'metrics.bleUnavailable',
};
