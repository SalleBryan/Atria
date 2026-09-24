import "./styles/tokens.css";
import "./styles/auth.css";
import "./styles/motion.css";
import "./styles/patient.css";
import "./styles/booking.css";
import "./styles/visits.css";
import "./styles/staff.css";
// Finishes a Google sign-in when Cognito returns the browser to the app.
import "aws-amplify/auth/enable-oauth-listener";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { SessionProvider } from "./auth/session";
import { fitToWindow } from "./layout/fit";
import { installMotion } from "./motion/springs";

installMotion();
fitToWindow();

const root = createRoot(document.getElementById("root") as HTMLElement);

// The development preview (src/dev): the patient app against a stand-in API,
// for looking at screens without signing in. The condition is a build-time
// constant, so a production build drops this branch and src/dev with it.
if (import.meta.env.DEV && window.location.pathname.startsWith("/__preview")) {
  void Promise.all([import("./dev/mockApi"), import("./dev/Preview")]).then(([mock, preview]) => {
    mock.installMockApi();
    root.render(
      <StrictMode>
        <preview.default />
      </StrictMode>,
    );
  });
} else {
  root.render(
    <StrictMode>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
