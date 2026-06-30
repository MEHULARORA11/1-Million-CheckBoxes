import React from 'react';

export default function GlobalClickCounter({ count }) {
  return (
    <div className="click-counter-badge">
      <div className="click-counter-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 4 7.07 17 2.51-7.39L21 11.07z" />
          <path d="M13.5 13.5 19 19" />
        </svg>
      </div>

      <div className="click-counter-content">
        <span className="click-counter-label">Global Clicks</span>
        <span key={count} className="click-counter-number">
          {count.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
