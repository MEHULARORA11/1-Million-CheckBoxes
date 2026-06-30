import React from 'react';

export default function GlobalClickCounter({ count }) {
  return (
    <div className="stat-card click-counter-badge">
      <div className="stat-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 4 7.07 17 2.51-7.39L21 11.07z" />
          <path d="M13.5 13.5 19 19" />
        </svg>
      </div>

      <div className="stat-content">
        <span className="stat-label">Global Clicks</span>
        <span key={count} className="stat-number pulse-animation">
          {count.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
