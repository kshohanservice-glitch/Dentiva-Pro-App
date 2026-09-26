// Dentiva Pro — command transport.
// In the Tauri runtime, forwards to Rust commands via @tauri-apps/api.
// Otherwise (browser preview / tests) routes to the built-in fallback backend
// which enforces the same permission checks over sql.js.

import { browserInvoke } from '../backend/browserBackend';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

export class CommandError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauriRuntime()) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    try {
      return await tauriInvoke<T>(cmd, args);
    } catch (e: unknown) {
      const msg = typeof e === 'string' ? e : (e as Error)?.message ?? 'Command failed';
      // Rust errors are serialised as "CODE: message"
      const m = /^([A-Z_]{3,40}):\s?([\s\S]*)$/.exec(msg);
      throw new CommandError(m ? m[1] : 'COMMAND_FAILED', m ? m[2] : msg);
    }
  }
  return browserInvoke<T>(cmd, args ?? {});
}

export function friendlyError(e: unknown): string {
  if (e instanceof CommandError) return e.message;
  if (e instanceof Error) return e.message;
  return 'An unexpected error occurred. Please try again.';
}
