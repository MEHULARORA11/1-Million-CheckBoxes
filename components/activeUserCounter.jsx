import React from 'react';

export default function ActiveUsers({ count }) {
  return (
    <div className="stat-card active-users-badge">
      <div className="pulse-dot-container">
        <span className="pulse-ring" />
        <span className="pulse-dot" />
      </div>
      <div className="stat-content">
        <span className="stat-label">Active Users</span>
        <span className="stat-number">{count.toLocaleString()}</span>
      </div>
    </div>
  );
}