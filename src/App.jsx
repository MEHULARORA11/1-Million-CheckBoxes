import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { Grid } from 'react-window';
import { CHECKBOX_COUNT } from '../constant.js';
import './App.css';
import ActiveUsers from '../components/activeUserCounter.jsx';
import GlobalClickCounter from '../components/globalClickCounter.jsx';

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

// Helper to convert base64 buffer to Uint8Array bitfield
const base64ToUint8Array = (base64) => {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

// Global state array to achieve ZERO React-render lag
let globalCheckedState = new Uint8Array(CHECKBOX_COUNT);

/**
 * Custom Hover Tooltip with Live Resets Countdown
 */
function HoverTooltip({ hoveredBox }) {
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!hoveredBox || hoveredBox.ttl <= 0) {
      setTimeLeft(0);
      return;
    }
    setTimeLeft(hoveredBox.ttl);
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(interval);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [hoveredBox]);

  if (!hoveredBox) return null;

  const { index, rect, isChecked, loading, user } = hoveredBox;

  // Position above the checkbox
  const style = {
    position: 'absolute',
    top: `${rect.top - 85}px`,
    left: `${rect.left + rect.width / 2}px`,
    transform: 'translateX(-50%)',
    zIndex: 1000,
    pointerEvents: 'none'
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeString = timeLeft > 0 ? `${minutes}m ${seconds}s` : null;

  return (
    <div className="custom-tooltip" style={style}>
      <div className="tooltip-arrow" />
      <div className="tooltip-content">
        <div className="tooltip-title">Checkbox #{index + 1}</div>
        {isChecked ? (
          loading ? (
            <div className="tooltip-loading">
              <span className="spinner-tiny" /> Loading details...
            </div>
          ) : user ? (
            <div className="tooltip-user-info">
              {user.picture && (
                <img src={user.picture} alt={user.name} className="tooltip-avatar" />
              )}
              <div className="tooltip-user-details">
                <div className="tooltip-user-name">{user.name}</div>
                {timeString && (
                  <div className="tooltip-ttl">Resets in {timeString}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="tooltip-no-user">Checked</div>
          )
        ) : (
          <div className="tooltip-unchecked">Unchecked</div>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized Cell Component
 */
const Cell = React.memo(({ columnIndex, rowIndex, style, columnCount, onCheckboxChange, onCheckboxHover, onCheckboxLeave, tick }) => {
  const index = rowIndex * columnCount + columnIndex;

  if (index >= CHECKBOX_COUNT) {
    return <div style={style} />; // Empty cell for grid padding at the end
  }

  // Read directly from the global array instantly
  const isChecked = globalCheckedState[index] === 1;

  return (
    <div style={style} className="checkbox-cell">
      <input
        type="checkbox"
        id={`checkbox-${index}`}
        checked={isChecked}
        onChange={(e) => onCheckboxChange(index, e.target.checked)}
        onMouseEnter={(e) => onCheckboxHover(index, e.target, isChecked)}
        onMouseLeave={() => onCheckboxLeave(index)}
        className="custom-checkbox"
      />
    </div>
  );
});

Cell.displayName = 'CheckboxCell';

function App() {
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState({ googleConfigured: false, googleClientId: null });
  const [mockName, setMockName] = useState('');
  const [activeUser, setActiveUser] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [tick, setTick] = useState(0); // Force fast visual updates on checkbox modifications
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [errorMessage, setErrorMessage] = useState('');
  const [hoveredBox, setHoveredBox] = useState(null);

  const lastToggleTime = useRef(0);
  const errorTimeoutRef = useRef(null);
  const hoverTimeoutRef = useRef(null);
  const socketRef = useRef(null);

  // Handle window resize for dynamic grid
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch session & authentication setup configuration on load
  useEffect(() => {
    async function checkSessionAndConfig() {
      setUserLoading(true);
      setErrorMessage('');
      
      const sessionPromise = fetch(`${BASE_URL}/api/auth/session`, { credentials: 'include' })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            if (data.authenticated) {
              setUser(data.user);
            }
          }
        })
        .catch((err) => {
          console.error('Session check failed:', err);
          setErrorMessage('Cannot connect to the authentication server. Please verify if the backend is running.');
        });

      const configPromise = fetch(`${BASE_URL}/api/auth/config`)
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setAuthConfig(data);
          } else {
            console.error('Failed to load auth configuration');
          }
        })
        .catch((err) => {
          console.error('Auth config fetch failed:', err);
          setErrorMessage('Cannot connect to the authentication server. Please verify if the backend is running.');
        });

      try {
        await Promise.all([sessionPromise, configPromise]);
      } catch (err) {
        console.error('Initialization failed:', err);
      } finally {
        setUserLoading(false);
      }
    }
    checkSessionAndConfig();
  }, []);

  // Handle Google OAuth callback SUCCESS
  const handleGoogleLoginSuccess = async (response) => {
    setUserLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`${BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential }),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUser(data.user);
      } else {
        setErrorMessage(data.error || 'Google Sign-In failed.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Network error during Google sign-in.');
    } finally {
      setUserLoading(false);
    }
  };

  // Google GSI Script Injection
  useEffect(() => {
    if (user || !authConfig.googleConfigured || !authConfig.googleClientId) return;

    let scriptEl = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    
    const initGoogle = () => {
      if (window.google) {
        try {
          window.google.accounts.id.initialize({
            client_id: authConfig.googleClientId,
            callback: handleGoogleLoginSuccess
          });
          
          const container = document.getElementById("google-signin-button");
          if (container) {
            window.google.accounts.id.renderButton(
              container,
              { theme: "dark", size: "large", width: 280, shape: "pill" }
            );
          }
        } catch (error) {
          console.error("Failed to initialize Google Sign-In:", error);
          setErrorMessage("Failed to load Google Sign-In helper library.");
        }
      }
    };

    if (!scriptEl) {
      scriptEl = document.createElement('script');
      scriptEl.src = 'https://accounts.google.com/gsi/client';
      scriptEl.async = true;
      scriptEl.defer = true;
      scriptEl.onload = initGoogle;
      document.body.appendChild(scriptEl);
    } else {
      if (window.google) {
        initGoogle();
      } else {
        scriptEl.addEventListener('load', initGoogle);
      }
    }

    return () => {
      if (scriptEl) {
        scriptEl.removeEventListener('load', initGoogle);
      }
    };
  }, [user, authConfig]);

  // Handle Mock Sandbox login
  const handleMockLogin = async (e) => {
    e.preventDefault();
    if (!mockName.trim()) {
      setErrorMessage('Please enter a username to proceed.');
      return;
    }
    setUserLoading(true);
    setErrorMessage('');
    try {
      const res = await fetch(`${BASE_URL}/api/auth/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: mockName }),
        credentials: 'include'
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setUser(data.user);
      } else {
        setErrorMessage(data.error || 'Sandbox login failed.');
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Network error during sandbox login.');
    } finally {
      setUserLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    setUserLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
      if (res.ok) {
        setUser(null);
        setDataLoaded(false);
        setClickCount(0);
        setActiveUser(0);
        setHoveredBox(null);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage('Failed to logout.');
    } finally {
      setUserLoading(false);
    }
  };

  // Fetch initial grid state once logged in
  useEffect(() => {
    if (!user) return;
    
    async function getState() {
      try {
        const response = await fetch(`${BASE_URL}/checkboxes`, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.base64 !== undefined) {
          const bytes = base64ToUint8Array(data.base64);
          for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
            const byte = bytes[byteIndex];
            for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
              const index = byteIndex * 8 + bitIndex;
              if (index < CHECKBOX_COUNT) {
                globalCheckedState[index] = (byte & (1 << (7 - bitIndex))) ? 1 : 0;
              }
            }
          }
          setClickCount(data.clickCount || 0);
          setDataLoaded(true);
        }
      } catch (error) {
        console.error('Failed to fetch checkboxes:', error);
        setErrorMessage('Failed to load checkboxes. Reconnecting...');
      }
    }
    getState();
  }, [user]);

  // Socket listener callbacks
  const handleUserCount = useCallback((count) => {
    setActiveUser(count);
  }, []);

  const handleCheckboxChange = useCallback(({ index, isChecked, clickCount }) => {
    globalCheckedState[index] = isChecked ? 1 : 0;
    if (clickCount !== undefined) {
      setClickCount(clickCount);
    }
    setTick(t => t + 1); // Trigger fast render

    // Reactively update hover state if currently open on this checkbox
    setHoveredBox(prev => {
      if (prev && prev.index === index) {
        return {
          ...prev,
          isChecked,
          user: isChecked ? prev.user : null,
          ttl: isChecked ? prev.ttl : 0
        };
      }
      return prev;
    });
  }, []);

  const handleHoverResponse = useCallback(({ index, user, ttl }) => {
    setHoveredBox(prev => {
      if (prev && prev.index === index) {
        return {
          ...prev,
          loading: false,
          user,
          ttl
        };
      }
      return prev;
    });
  }, []);

  // Socket Lifecycles
  useEffect(() => {
    if (!user) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const socket = io(BASE_URL, {
      transports: ['websocket'],
      withCredentials: true
    });

    socketRef.current = socket;

    socket.on('server:checkbox:change', handleCheckboxChange);
    socket.on('online:users', handleUserCount);
    socket.on('server:checkbox:hover', handleHoverResponse);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, handleCheckboxChange, handleUserCount, handleHoverResponse]);

  // Local Checkbox Interaction trigger
  const handleLocalCheckboxChange = useCallback((index, isChecked) => {
    const now = Date.now();
    if (now - lastToggleTime.current < 3000) {
      setErrorMessage('Please wait 3 seconds before toggling again.');
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
      errorTimeoutRef.current = setTimeout(() => {
        setErrorMessage('');
      }, 3000);
      return;
    }

    lastToggleTime.current = now;
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
      setErrorMessage('');
    }

    // Optimistic update
    globalCheckedState[index] = isChecked ? 1 : 0;
    setTick(t => t + 1);

    // Emit to server
    if (socketRef.current) {
      socketRef.current.emit('client:checkbox:change', { isChecked, index });
    }
  }, []);

  // Debounced hover event emitters
  const handleCheckboxHover = useCallback((index, target, isChecked) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    const rect = target.getBoundingClientRect();
    
    setHoveredBox({
      index,
      rect: {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
      },
      isChecked,
      loading: isChecked,
      user: null,
      ttl: 0
    });

    if (isChecked && socketRef.current) {
      hoverTimeoutRef.current = setTimeout(() => {
        if (socketRef.current) {
          socketRef.current.emit('client:checkbox:hover', { index });
        }
      }, 150); // 150ms debounce
    }
  }, []);

  const handleCheckboxLeave = useCallback((index) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredBox(null);
  }, []);

  // Calculate Grid dimensions
  const CELL_SIZE = 26; // 20px checkbox + 6px padding/gaps
  const gridWidth = Math.min(dimensions.width - 40, 1200); // Max width of 1200px
  const columnCount = Math.floor(gridWidth / CELL_SIZE);
  const rowCount = Math.ceil(CHECKBOX_COUNT / columnCount);

  // Memoize the itemData to avoid unnecessary rerenders
  const itemData = useMemo(() => ({
    columnCount,
    onCheckboxChange: handleLocalCheckboxChange,
    onCheckboxHover: handleCheckboxHover,
    onCheckboxLeave: handleCheckboxLeave,
    tick
  }), [columnCount, handleLocalCheckboxChange, handleCheckboxHover, handleCheckboxLeave, tick]);

  if (userLoading) {
    return (
      <div className="loader-screen">
        <div className="futuristic-spinner" />
        <div className="loader-text">Initializing session...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-bg-dots" />
        <div className="login-card">
          <div className="login-header">
            <h1 className="login-logo">One Million Checkboxes</h1>
            <p className="login-subtitle">A collaborative realtime pixel grid experiment</p>
          </div>
          
          <div className="login-features">
            <div className="feature-item">
              <span className="feature-icon">⚡</span>
              <div>
                <div className="feature-title">Realtime Operations</div>
                <div className="feature-desc">Observe toggles instantly across all connections using WebSocket sync.</div>
              </div>
            </div>
            <div className="feature-item">
              <span className="feature-icon">⏳</span>
              <div>
                <div className="feature-title">5-Min Auto Expiration</div>
                <div className="feature-desc">States automatically expire and reset after 5 minutes using Redis TTL.</div>
              </div>
            </div>
            <div className="feature-item">
              <span className="feature-icon">👤</span>
              <div>
                <div className="feature-title">Real Identity Tracking</div>
                <div className="feature-desc">Hover over any checkbox to discover who flipped it and when it expires.</div>
              </div>
            </div>
          </div>

          <div className="login-actions">
            {authConfig.googleConfigured ? (
              <div className="google-btn-wrapper">
                <div id="google-signin-button"></div>
              </div>
            ) : (
              <div className="sandbox-warning">
                Google SSO is not configured. Using Mock Sandbox Auth fallback.
              </div>
            )}

            <div className="divider">
              <span>{authConfig.googleConfigured ? 'OR RUN SANDBOX MODE' : 'SANDBOX MODE'}</span>
            </div>

            <form onSubmit={handleMockLogin} className="mock-login-form">
              <input
                type="text"
                placeholder="Enter Nickname..."
                value={mockName}
                onChange={(e) => setMockName(e.target.value)}
                maxLength={18}
                className="mock-login-input"
              />
              <button type="submit" className="mock-login-btn">
                Enter Sandbox
              </button>
            </form>
          </div>

          {errorMessage && (
            <div className="login-error-toast">
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-header-main">
          <h1>One Million Checkboxes</h1>
          
          <div className="user-profile-badge">
            {user.picture && (
              <img src={user.picture} alt={user.name} className="user-avatar" />
            )}
            <span className="user-name">{user.name}</span>
            <button onClick={handleLogout} className="logout-btn" title="Logout">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="stats-row">
          <ActiveUsers count={activeUser} />
          <GlobalClickCounter count={clickCount} />
        </div>
        <p className="subtitle">Hover checkboxes to view live check owners and Redis TTL expirations.</p>
      </header>

      {errorMessage && (
        <div className="error-toast">
          <div className="error-icon">⏳</div>
          <div className="error-content">{errorMessage}</div>
        </div>
      )}

      <div className="grid-container">
        {dataLoaded ? (
          <Grid
            key="grid-loaded"
            className="virtualized-grid"
            columnCount={columnCount}
            columnWidth={CELL_SIZE}
            rowCount={rowCount}
            rowHeight={CELL_SIZE}
            cellProps={itemData}
            cellComponent={Cell}
            style={{
              height: dimensions.height - 230,
              width: columnCount * CELL_SIZE
            }}
          />
        ) : (
          <div className="grid-loading-container">
            <div className="spinner-large" />
            <div style={{ marginTop: '16px' }}>Fetching {CHECKBOX_COUNT.toLocaleString()} checkboxes...</div>
          </div>
        )}
      </div>

      <HoverTooltip hoveredBox={hoveredBox} />
    </div>
  );
}

export default App;