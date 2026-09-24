import "./styles/tokens.css";
import "./styles/auth.css";
// Finishes a Google sign-in when Cognito returns the browser to the app.
import "aws-amplify/auth/enable-oauth-listener";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { SessionProvider } from "./auth/session";
import { fitToWindow } from "./layout/fit";

fitToWindow();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
