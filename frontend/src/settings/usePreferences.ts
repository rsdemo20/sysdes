/** React's view of the preference store; the store itself stays framework-free. */
import { useSyncExternalStore } from "react";
import { preferences, type Preferences } from "./preferences";

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    preferences.subscribe,
    preferences.getSnapshot,
    preferences.getSnapshot,
  );
}
