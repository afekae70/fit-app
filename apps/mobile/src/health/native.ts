/**
 * The one place that touches `react-native-health-connect`.
 *
 * It is loaded with `require` inside a try, not imported, for the same reason the BLE scanner is:
 * the module is native, it does not exist in Expo Go, and a static import would take the whole
 * app down at startup instead of letting a screen say that a development build is needed.
 *
 * Reading (reader.ts) and writing (writer.ts) both come through here so there is one loader, one
 * module shape and one set of status codes rather than a copy per direction.
 */

/** A Health Connect permission: a direction and a record type, granted per type by the user. */
export interface HealthPermission {
  accessType: 'read' | 'write';
  recordType: string;
}

export interface HealthConnectModule {
  initialize(): Promise<boolean>;
  requestPermission(permissions: readonly HealthPermission[]): Promise<HealthPermission[]>;
  getGrantedPermissions(): Promise<HealthPermission[]>;
  getSdkStatus(): Promise<number>;
  readRecords(
    recordType: string,
    options: { timeRangeFilter: { operator: string; startTime: string; endTime: string } },
  ): Promise<{ records: unknown[] }>;
  insertRecords(records: readonly unknown[]): Promise<string[]>;
  openHealthConnectSettings(): void;
}

/**
 * Health Connect SDK status codes.
 *
 * 3 means available; 1 means unavailable on this device; 2 means the app that provides it needs
 * an update. Only 3 is usable, and the two failure codes are worth distinguishing because the
 * user's remedy differs — one is "this phone cannot", the other is "update Health Connect".
 */
export const SDK_AVAILABLE = 3;
export const SDK_PROVIDER_UPDATE_REQUIRED = 2;

export function loadHealthConnect(): HealthConnectModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-health-connect') as HealthConnectModule;
  } catch {
    return null;
  }
}

/**
 * The permissions actually granted, as a set of "direction:type" strings.
 *
 * Health Connect grants per data type inside its own app, so a user can allow the workout and
 * refuse the calories. Everything here therefore asks what was granted rather than assuming that
 * a successful request means all of it.
 */
export async function grantedHealthPermissions(): Promise<Set<string>> {
  const module = loadHealthConnect();
  if (!module) return new Set();

  try {
    await module.initialize();
    const granted = await module.getGrantedPermissions();
    return new Set(granted.map((permission) => `${permission.accessType}:${permission.recordType}`));
  } catch {
    return new Set();
  }
}
