import { useEffect, useState } from "preact/hooks";

import { type HarnessControls, parseControls } from "../shared/harness.ts";
import { call } from "./connection.ts";

/**
 * Gets the slash commands, models, and effort levels of the harness of an agent. It gives `null`
 * until they load, and for a harness that has none.
 */
export function useControls(paneId: string, connected: boolean): HarnessControls | null {
  const [controls, setControls] = useState<HarnessControls | null>(null);

  useEffect(() => {
    if (!connected) {
      return;
    }

    let cancelled = false;

    call({ method: "controls", paneId }).then(
      (value) => !cancelled && setControls(parseControls(value)),
      () => !cancelled && setControls(null),
    );

    return () => {
      cancelled = true;
    };
  }, [paneId, connected]);

  return controls;
}
