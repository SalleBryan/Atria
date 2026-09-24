/** While the session is being resolved: the loading indicator, alone, centred. */

import { LoadingIndicator } from "./LoadingIndicator";

export function Waiting() {
  return (
    <div className="page-waiting">
      <LoadingIndicator size={56} contained label="Loading Atria" />
    </div>
  );
}
