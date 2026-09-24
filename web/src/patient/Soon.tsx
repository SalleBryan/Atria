/** Holds a patient screen's place until it is built; replaced screen by screen. */

import { Link } from "react-router-dom";

export function Soon({ title }: { title: string }) {
  return (
    <div className="page">
      <header className="top-bar glass">
        <div className="greeting">
          <h1>{title}</h1>
          <p>This screen is being built next.</p>
        </div>
        <Link className="pill-button pill-primary" to="/home">
          Back to home
        </Link>
      </header>
    </div>
  );
}
