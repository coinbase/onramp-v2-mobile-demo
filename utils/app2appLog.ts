/**
 * Gated verbose logging for the app2app / App Attest client flow.
 *
 * This flow emits a lot of step-by-step debug output that is useful while
 * developing on a device but is noise in a normal build. It is OFF by default
 * and opt-in via EXPO_PUBLIC_APP2APP_VERBOSE=1 (mirrors the server's
 * APP2APP_VERBOSE gate). Genuine failures should keep using console.error,
 * which is intentionally always-on and not routed through here.
 */
const APP2APP_VERBOSE = process.env.EXPO_PUBLIC_APP2APP_VERBOSE === '1';

export function a2aLog(...args: unknown[]): void {
  if (APP2APP_VERBOSE) console.log(...args);
}

export function a2aWarn(...args: unknown[]): void {
  if (APP2APP_VERBOSE) console.warn(...args);
}
