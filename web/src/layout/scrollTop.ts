/**
 * A new screen opens at its top. On phones the window scrolls, so without
 * this a visit opened from far down the day list opened at its foot
 * (audit 2026-10-05). Only the path counts: ?cancel=1 and the like keep the
 * place, because they open a dialog over the same screen.
 */

import { useLayoutEffect } from "react";

export function useScrollTopOnNavigate(pathname: string) {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    document.getElementById("main")?.scrollTo?.(0, 0);
  }, [pathname]);
}
