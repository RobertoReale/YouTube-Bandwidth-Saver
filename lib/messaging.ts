/** Discriminated union and single dispatch point. */

import { browser } from 'wxt/browser';
import type { FilterStats, SchemaViolation, Settings, TabState } from './types';

export type Message =
  // ISOLATED → background
  | { readonly type: 'GET_STATE' }
  | { readonly type: 'TOGGLE_TAB' }
  | { readonly type: 'REPORT_STATS'; readonly stats: Partial<FilterStats> }
  | { readonly type: 'REPORT_SCHEMA_VIOLATION'; readonly violation: SchemaViolation }
  | { readonly type: 'REPORT_LIVE' };

export interface ResolvedState {
  readonly state: TabState;
  readonly settings: Settings;
}

/** background → ISOLATED, broadcast on state change. */
export type Broadcast = { readonly type: 'STATE_CHANGED' } & ResolvedState;

export type ResponseOf<T extends Message['type']> = T extends 'GET_STATE' | 'TOGGLE_TAB'
  ? ResolvedState
  : undefined;

export async function sendMessage<M extends Message>(message: M): Promise<ResponseOf<M['type']>> {
  return (await browser.runtime.sendMessage(message)) as ResponseOf<M['type']>;
}

export function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as Message).type === 'string';
}

export function isBroadcast(value: unknown): value is Broadcast {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Broadcast).type === 'STATE_CHANGED' &&
    typeof (value as Broadcast).state === 'object'
  );
}
