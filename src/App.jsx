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
const globalCheckedState = new Uint8Array(CHECKBOX_COUNT);

// Helper to generate dynamic identicons for guests or resolve google pictures
const getAvatarUrl = (user) => {
  if (!user) return null;
  if (user.isGuest) {
    return `https://api.dicebear.com/7.x/identicon/svg?seed=${user.guestId || 'guest'}`;
  }
  return user.picture || `https://api.dicebear.com/7.x/fun-emoji/svg?seed=${encodeURIComponent(user.name)}`;
};

/**
 * Custom Hover Tooltip with Live Resets Countdown & Ownership Status
 */
function HoverTooltip({ hoveredBox, currentUser }) {
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
    top: `${rect.top - 100}px`,
    left: `${rect.left + rect.width / 2}px`,
    transform: 'translateX(-50%)',
    zIndex: 1000,
    pointerEvents: 'none'
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const timeString = timeLeft > 0 ? `${minutes}m ${seconds}s` : null;
  const avatarUrl = getAvatarUrl(user);

  // Compute locked state relative to current user
  const isLocked = isChecked && user && !user.isGuest && (!currentUser || user.userId !== currentUser.id);
  const isOwnAuth = isChecked && user && !user.isGuest && currentUser && user.userId === currentUser.id;

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
              {avatarUrl && (
                <img src={avatarUrl} alt={user.name} className="tooltip-avatar" />
              )}
              <div className="tooltip-user-details">
                <div className="tooltip-user-name">
                  {user.isGuest ? `Guest (${user.guestId})` : user.name}
                </div>
                {user.isGuest && timeString && (
                  <div className="tooltip-ttl">Resets in {timeString}</div>
                )}
                {!user.isGuest && (
                  <div className="tooltip-permanent">Permanent Check</div>
                )}
                {user.isGuest ? (
                  <div className="tooltip-badge temporary">
                    ⚡ Guest
                  </div>
                ) : isOwnAuth ? (
                  <div className="tooltip-badge owned">
                    ✨ Yours
                  </div>
                ) : (
                  <div className="tooltip-badge locked">
                    🔒 Locked
                  </div>
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
 * Highly Optimized Cell Component subscribing to selective updates
 */
const Cell = React.memo(({ columnIndex, rowIndex, style, columnCount, onCheckboxChange, onCheckboxHover, onCheckboxLeave, checkboxListeners, ownerCache, currentUser, guestSessionId }) => {
  const index = rowIndex * columnCount + columnIndex;

  if (index >= CHECKBOX_COUNT) {
    return <div style={style} />;
  }

  // Local state to support instant targeted renders on socket/local events
  const [isChecked, setIsChecked] = useState(() => globalCheckedState[index] === 1);
  const [owner, setOwner] = useState(() => {
    const cached = ownerCache?.current?.get(index);
    return cached ? cached.user : null;
  });
  const [isShaking, setIsShaking] = useState(false);

  useEffect(() => {
    if (!checkboxListeners) return;

    // Subscribes cell to targeted change updates
    const listener = ({ isChecked: nextChecked, owner: nextOwner, shake }) => {
      setIsChecked(nextChecked);
      if (nextOwner !== undefined) {
        setOwner(nextOwner);
      }
      if (shake) {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 500);
      }
    };

    let listeners = checkboxListeners.current.get(index);
    if (!listeners) {
      listeners = new Set();
      checkboxListeners.current.set(index, listeners);
    }
    listeners.add(listener);

    // Sync initial states
    setIsChecked(globalCheckedState[index] === 1);
    const cached = ownerCache?.current?.get(index);
    if (cached) {
      setOwner(cached.user);
    }

    return () => {
      const listeners = checkboxListeners.current.get(index);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          checkboxListeners.current.delete(index);
        }
      }
    };
  }, [index, checkboxListeners, ownerCache]);

  // Compute lock status relative to user
  const isLocked = useMemo(() => {
    if (!owner) return false;
    if (owner.isGuest) {
      return false; // Guest owned checkboxes are NEVER locked! Anyone can uncheck them.
    } else {
      return !currentUser || owner.userId !== currentUser.id;
    }
  }, [owner, currentUser]);

  const handleChange = (e) => {
    const nextChecked = e.target.checked;

    // Client-side Guard Check: if locked, block action and trigger shake immediately
    if (isLocked) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      const ownerName = owner.isGuest ? `Guest (${owner.guestId})` : owner.name;
      onCheckboxChange(index, isChecked, true, ownerName); // Notify parent of rejection
      return;
    }

    // Optimistic Update
    globalCheckedState[index] = nextChecked ? 1 : 0;
    setIsChecked(nextChecked);
    onCheckboxChange(index, nextChecked, false);
  };

  return (
    <div style={style} className="checkbox-cell">
      <input
        type="checkbox"
        id={`checkbox-${index}`}
        checked={isChecked}
        onChange={handleChange}
        onMouseEnter={(e) => onCheckboxHover(index, e.target, isChecked)}
        onMouseLeave={() => onCheckboxLeave(index)}
        className={`custom-checkbox ${isLocked ? 'is-locked' : ''} ${isShaking ? 'shake' : ''}`}
      />
    </div>
  );
});

Cell.displayName = 'CheckboxCell';

function App() {
  const [user, setUser] = useState(null);
  const [userLoading, setUserLoading] = useState(true);
  const [authConfig, setAuthConfig] = useState({ googleConfigured: false, googleClientId: null });
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [activeUser, setActiveUser] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [notification, setNotification] = useState(null);
  const [hoveredBox, setHoveredBox] = useState(null);

  // References for O(1) listeners and grid size observer
  const checkboxListeners = useRef(new Map());
  const ownerCache = useRef(new Map());
  const observerRef = useRef(null);
  const [gridHeight, setGridHeight] = useState(450);

  // Callback ref that handles mounting/unmounting of the container dynamically
  const gridContainerRef = useCallback((node) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (node !== null) {
      const observer = new ResizeObserver((entries) => {
        for (let entry of entries) {
          setGridHeight(entry.contentRect.height);
        }
      });
      observer.observe(node);
      observerRef.current = observer;
    }
  }, []);

  const lastToggleTime = useRef(0);
  const errorTimeoutRef = useRef(null);
  const hoverTimeoutRef = useRef(null);
  const socketRef = useRef(null);

  // Generate stable Guest Session ID
  const guestSessionId = useMemo(() => {
    let id = localStorage.getItem('guest_session_id');
    if (!id) {
      id = `guest-${crypto.randomUUID().substring(0, 8)}`;
      localStorage.setItem('guest_session_id', id);
    }
    return id;
  }, []);

  // Redirect 127.0.0.1 to localhost for Google OAuth compatibility
  useEffect(() => {
    if (window.location.hostname === '127.0.0.1') {
      const newUrl = window.location.href.replace('127.0.0.1', 'localhost');
      window.location.replace(newUrl);
    }
  }, []);

  // Handle window resize dimension tracking
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ResizeObserver handled via callback ref gridContainerRef

  // Unified Toast helper
  const showToast = useCallback((message, type = 'info') => {
    setNotification({ message, type });
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
    }
    errorTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 3000);
  }, []);

  // Fetch session & authentication config on load
  useEffect(() => {
    async function checkSessionAndConfig() {
      setUserLoading(true);
      setNotification(null);
      
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
          showToast('Cannot connect to the authentication server. Backend offline.', 'error');
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
  }, [showToast]);

  // Handle Google OAuth callback success
  const handleGoogleLoginSuccess = async (response) => {
    setUserLoading(true);
    setNotification(null);
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
        showToast(`Successfully logged in as ${data.user.name}!`, 'info');
      } else {
        showToast(data.error || 'Google Sign-In failed.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Network error during Google sign-in.', 'error');
    } finally {
      setUserLoading(false);
    }
  };

  // Google GSI Script Injection & Button Rendering
  useEffect(() => {
    if (user || !authConfig.googleConfigured || !authConfig.googleClientId) return;

    let scriptEl = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    
    const initGoogle = () => {
      if (window.google) {
        try {
          window.google.accounts.id.initialize({
            client_id: authConfig.googleClientId,
            callback: handleGoogleLoginSuccess,
            use_fedcm_for_prompt: true
          });
          
          const container = document.getElementById("google-signin-button");
          if (container) {
            window.google.accounts.id.renderButton(
              container,
              { theme: "dark", size: "large", shape: "pill", width: 240 }
            );
          }
        } catch (error) {
          console.error("Failed to initialize Google Sign-In:", error);
          showToast("Failed to load Google Sign-In helper library.", "error");
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
  }, [user, authConfig, showToast]);

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
        setHoveredBox(null);
        ownerCache.current.clear();
        showToast('Successfully logged out.', 'info');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to logout.', 'error');
    } finally {
      setUserLoading(false);
    }
  };

  // Fetch initial grid state on load
  useEffect(() => {
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
        showToast('Failed to load checkboxes. Reconnecting...', 'error');
      }
    }
    getState();
  }, [showToast]);

  // Socket listener callbacks
  const handleUserCount = useCallback((count) => {
    setActiveUser(count);
  }, []);

  const handleCheckboxChange = useCallback(({ index, isChecked, clickCount, owner }) => {
    globalCheckedState[index] = isChecked ? 1 : 0;
    if (clickCount !== undefined) {
      setClickCount(clickCount);
    }

    // Sync metadata inside owner cache
    if (isChecked && owner) {
      ownerCache.current.set(index, {
        user: owner,
        ttl: owner.isGuest ? 600 : 0,
        fetchedAt: Date.now()
      });
    } else {
      ownerCache.current.delete(index);
    }

    // O(1) notify cell listener directly
    const listeners = checkboxListeners.current.get(index);
    if (listeners) {
      listeners.forEach(listener => listener({ isChecked, owner }));
    }

    // Reactively update hover state if currently open on this checkbox
    setHoveredBox(prev => {
      if (prev && prev.index === index) {
        return {
          ...prev,
          isChecked,
          user: isChecked ? owner : null,
          ttl: isChecked ? (owner?.isGuest ? 600 : 0) : 0,
          loading: false
        };
      }
      return prev;
    });
  }, []);

  const handleCheckboxRejected = useCallback(({ index, isChecked, owner, clickCount }) => {
    globalCheckedState[index] = isChecked ? 1 : 0;
    if (clickCount !== undefined) {
      setClickCount(clickCount);
    }

    // Store correct info back in cache
    if (isChecked && owner) {
      ownerCache.current.set(index, {
        user: owner,
        ttl: owner.isGuest ? 600 : 0,
        fetchedAt: Date.now()
      });
    } else {
      ownerCache.current.delete(index);
    }

    // Trigger cell update and shake
    const listeners = checkboxListeners.current.get(index);
    if (listeners) {
      listeners.forEach(listener => listener({ isChecked, owner, shake: true }));
    }

    const ownerName = owner ? (owner.isGuest ? `Guest (${owner.guestId})` : owner.name) : 'another user';
    showToast(`🔒 Checkbox #${index + 1} is locked by ${ownerName}.`, 'lock');
  }, [showToast]);

  const handleHoverResponse = useCallback(({ index, user, ttl }) => {
    if (user) {
      ownerCache.current.set(index, {
        user,
        ttl,
        fetchedAt: Date.now()
      });
    } else {
      ownerCache.current.delete(index);
    }

    // Push owner metadata to the cell to apply lock styling
    const listeners = checkboxListeners.current.get(index);
    if (listeners) {
      listeners.forEach(listener => listener({ isChecked: globalCheckedState[index] === 1, owner: user }));
    }

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
    const socket = io(BASE_URL, {
      transports: ['websocket'],
      withCredentials: true,
      auth: {
        guestSessionId
      }
    });

    socketRef.current = socket;
    setConnectionStatus('connecting');

    socket.on('connect', () => {
      setConnectionStatus('connected');
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('connect_error', () => {
      setConnectionStatus('error');
    });

    socket.on('server:checkbox:change', handleCheckboxChange);
    socket.on('server:checkbox:rejected', handleCheckboxRejected);
    socket.on('online:users', handleUserCount);
    socket.on('server:checkbox:hover', handleHoverResponse);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, guestSessionId, handleCheckboxChange, handleCheckboxRejected, handleUserCount, handleHoverResponse]);

  // Local Checkbox interaction trigger
  const handleLocalCheckboxChange = useCallback((index, isChecked, wasRejected = false, ownerName = '') => {
    if (wasRejected) {
      showToast(`🔒 Checkbox #${index + 1} is locked by ${ownerName}.`, 'lock');
      return;
    }

    const now = Date.now();
    if (now - lastToggleTime.current < 3000) {
      showToast('Please wait 3 seconds before toggling again.', 'info');
      // Revert checked state locally
      globalCheckedState[index] = isChecked ? 0 : 1;
      const listeners = checkboxListeners.current.get(index);
      if (listeners) {
        listeners.forEach(listener => listener({ isChecked: !isChecked }));
      }
      return;
    }

    lastToggleTime.current = now;

    // Emit flip to server
    if (socketRef.current) {
      socketRef.current.emit('client:checkbox:change', { isChecked, index });
    }
  }, [showToast]);

  // Hover lookup callback
  const handleCheckboxHover = useCallback((index, target, isChecked) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    
    const rect = target.getBoundingClientRect();
    
    // Check local owner cache first
    const cached = ownerCache.current.get(index);
    let cachedUser = null;
    let cachedTtl = 0;
    let stillValid = false;

    if (cached) {
      if (cached.user.isGuest) {
        const elapsed = Math.floor((Date.now() - cached.fetchedAt) / 1000);
        if (elapsed < cached.ttl) {
          cachedUser = cached.user;
          cachedTtl = cached.ttl - elapsed;
          stillValid = true;
        } else {
          ownerCache.current.delete(index);
        }
      } else {
        cachedUser = cached.user;
        cachedTtl = 0;
        stillValid = true;
      }
    }

    setHoveredBox({
      index,
      rect: {
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
      },
      isChecked,
      loading: isChecked && !stillValid,
      user: cachedUser,
      ttl: cachedTtl
    });

    if (isChecked && !stillValid && socketRef.current) {
      hoverTimeoutRef.current = setTimeout(() => {
        if (socketRef.current) {
          socketRef.current.emit('client:checkbox:hover', { index });
        }
      }, 150);
    }
  }, []);

  const handleCheckboxLeave = useCallback((index) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setHoveredBox(null);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, []);

  // Calculate Grid viewport dimensions
  const CELL_SIZE = 26;
  const gridWidth = Math.min(dimensions.width - 48, 1200);
  const columnCount = Math.floor(gridWidth / CELL_SIZE);
  const rowCount = Math.ceil(CHECKBOX_COUNT / columnCount);

  // Grid Cell shared props (all stable Refs to avoid grid rerenders)
  const itemData = useMemo(() => ({
    columnCount,
    onCheckboxChange: handleLocalCheckboxChange,
    onCheckboxHover: handleCheckboxHover,
    onCheckboxLeave: handleCheckboxLeave,
    checkboxListeners,
    ownerCache,
    currentUser: user,
    guestSessionId
  }), [columnCount, handleLocalCheckboxChange, handleCheckboxHover, handleCheckboxLeave, user, guestSessionId]);

  if (userLoading) {
    return (
      <div className="loader-screen">
        <div className="futuristic-spinner" />
        <div className="loader-text">Loading collaborative state...</div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-header-main">
          <h1>One Million Checkboxes</h1>
          
          {user ? (
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
          ) : (
            <div className="auth-upgrade-pill">
              <span className="guest-badge">Guest Mode</span>
              {authConfig.googleConfigured ? (
                <span className="sso-ready-dot" style={{ display: 'inline-block', width: 8, height: 8, background: '#10b981', borderRadius: '50%' }} title="SSO Ready" />
              ) : (
                <span className="sso-missing-warning">SSO Offline</span>
              )}
            </div>
          )}
        </div>

        {/* Cohesive Stats Cards Dashboard */}
        <div className="stats-row">
          <div className={`stat-card connection-status-badge ${connectionStatus}`}>
            <span className="status-dot"></span>
            <div className="stat-content">
              <span className="stat-label">Server</span>
              <span className="stat-value">
                {connectionStatus === 'connected' && 'Live'}
                {connectionStatus === 'connecting' && 'Connecting'}
                {connectionStatus === 'disconnected' && 'Offline'}
                {connectionStatus === 'error' && 'Error'}
              </span>
            </div>
          </div>
          <ActiveUsers count={activeUser} />
          <GlobalClickCounter count={clickCount} />
        </div>
        <p className="subtitle">Hover checkboxes to view live check owners and Redis TTL expirations.</p>
      </header>

      {/* Redesigned SSO Promo Card for Guest Users */}
      {!user && (
        <div className="auth-promo-card">
          <div className="auth-promo-info">
            <span className="auth-promo-badge">Guest Session</span>
            <h2>Claim Permanent Checkboxes ⚡</h2>
            <p>
              Your check flips currently reset and unlock after <strong>5 minutes</strong>. Sign in with Google to protect your checks permanently!
            </p>
          </div>
          
          <div className="auth-promo-features">
            <div className="promo-feature">
              <span className="feature-dot">✓</span> Lock your checks permanently
            </div>
            <div className="promo-feature">
              <span className="feature-dot">✓</span> Live Profile Avatar sync
            </div>
            <div className="promo-feature">
              <span className="feature-dot">✓</span> Prevent others from unchecking
            </div>
          </div>

          <div className="auth-promo-action">
            {authConfig.googleConfigured ? (
              <div className="google-btn-container">
                <div id="google-signin-button" className="google-signin-btn"></div>
                <div className="btn-glow" />
              </div>
            ) : (
              <div className="sso-offline-badge">
                <span className="dot-red"></span> Google SSO Offline
              </div>
            )}
          </div>
        </div>
      )}

      {/* Grid Container wrapper with Observer Height */}
      <div className="grid-container" ref={gridContainerRef}>
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
              height: gridHeight,
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

      {/* Tooltip Overlay */}
      <HoverTooltip hoveredBox={hoveredBox} currentUser={user} />

      {/* Unified Notification Toast */}
      {notification && (
        <div className={`notification-toast ${notification.type}`}>
          <span className="toast-icon">
            {notification.type === 'lock' && '🔒'}
            {notification.type === 'error' && '⚠️'}
            {notification.type === 'info' && 'ℹ️'}
          </span>
          <span className="toast-message">{notification.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;