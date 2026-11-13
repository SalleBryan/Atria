/**
 * Says so, in plain words, when the screen cannot be trusted to be current
 * (audit F16): the device is offline, or it has a network but Atria does not
 * answer. It rises on the fast spatial spring and goes by itself when the
 * connection returns, with a short "Back online" in the snackbar.
 *
 * It floats over the screen rather than pushing it down, so no layout moves.
 */

import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import { useConnection } from "../api/network";
import { Snackbar } from "../staff/Snackbar";
import { Notice } from "./controls";

export function ConnectionBanner() {
  const connection = useConnection();
  const [checking, setChecking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const was = useRef(connection);

  useEffect(() => {
    if (was.current !== "online" && connection === "online") setSaid("Back online. This screen is refreshing.");
    was.current = connection;
  }, [connection]);

  // The browser's offline flag can be wrong either way, so the person can ask
  // for a real check: any answer from Atria, even a refusal, ends the banner.
  async function check() {
    setChecking(true);
    await api("/me").catch(() => undefined);
    setChecking(false);
  }

  return (
    <>
      <div className="connection-slot">
        {connection !== "online" && (
          <Notice tone="error" role="status" className="connection-banner">
            <span className="connection-words">
              <strong>{connection === "offline" ? "You are offline." : "Atria cannot be reached right now."}</strong> What you see may be
              out of date.{" "}
              {connection === "offline" ? "Nothing you do is sent until the connection is back." : "We keep trying and will refresh it."}
            </span>
            <button
              type="button"
              className="connection-retry"
              onClick={() => void check()}
              disabled={checking}
              aria-busy={checking || undefined}
            >
              {checking ? "Checking" : "Try now"}
            </button>
          </Notice>
        )}
      </div>
      <Snackbar message={said} onDone={() => setSaid(null)} />
    </>
  );
}
