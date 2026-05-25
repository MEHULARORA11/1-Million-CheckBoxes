import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { io } from 'socket.io-client';
import { Grid } from 'react-window';
import { CHECKBOX_COUNT } from '../constant.js';
import './App.css';

const PORT = import.meta.env.VITE_PORT || 8000;
const BASE_URL = import.meta.env.VITE_BACKEND_URL;
// console.log(BASE_URL)
const socket = io(`${BASE_URL}:${PORT}`, {
  transports: ['websocket']
});

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
 * Memoized Cell Component
 */
const Cell = React.memo(({ columnIndex, rowIndex, style, columnCount, onCheckboxChange, tick }) => {
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
        className="custom-checkbox"
        title={`Checkbox #${index + 1}`}
      />
    </div>
  );
});

Cell.displayName = 'CheckboxCell';

function App() {
  const [dataLoaded, setDataLoaded] = useState(false);
  const [tick, setTick] = useState(0); // A tiny integer to force fast visual updates
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [errorMessage, setErrorMessage] = useState('');
  const lastToggleTime = useRef(0);
  const errorTimeoutRef = useRef(null);

  // Handle window resize for dynamic grid
  useEffect(() => {
    const handleResize = () => {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch initial state
  useEffect(() => {
    async function getState() {
      try {
        const response = await fetch(`${BASE_URL}:${PORT}/checkboxes`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (data.base64) {
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
          setDataLoaded(true); // Mount the grid now that we have data!
        }
      } catch (error) {
        console.error('Failed to fetch checkboxes:', error);
      }
    }
    getState();
  }, []);

  // Socket listener for remote checkbox changes
  useEffect(() => {
    const handleCheckboxChange = ({ isChecked, index }) => {
      globalCheckedState[index] = isChecked ? 1 : 0;
      setTick(t => t + 1); // Trigger fast render
    };

    socket.on('server:checkbox:change', handleCheckboxChange);
    return () => socket.off('server:checkbox:change', handleCheckboxChange);
  }, []);

  // Callback to handle checkbox changes
  const handleCheckboxChange = useCallback((index, isChecked) => {
    const now = Date.now();
    if (now - lastToggleTime.current < 5000) {
      setErrorMessage('Please wait 5 seconds before toggling again.');
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
    setTick(t => t + 1); // Trigger fast render

    // Emit to server
    socket.emit('client:checkbox:change', { isChecked, index });
  }, []);

  // Calculate Grid dimensions
  const CELL_SIZE = 26; // 24px checkbox + 2px spacing
  const gridWidth = Math.min(dimensions.width - 40, 1200); // Max width of 1200px
  const columnCount = Math.floor(gridWidth / CELL_SIZE);
  const rowCount = Math.ceil(CHECKBOX_COUNT / columnCount);

  // Memoize the itemData to avoid unnecessary rerenders
  const itemData = useMemo(() => ({
    columnCount,
    onCheckboxChange: handleCheckboxChange,
    tick // Passing tick forces react-window to update the cells quickly without crashing DevTools!
  }), [columnCount, handleCheckboxChange, tick]);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>One Million Checkboxes</h1>
        <p className="subtitle">Virtualization ensures seamless scrolling!</p>
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
              height: dimensions.height - 180,
              width: columnCount * CELL_SIZE
            }}
          />
        ) : (
          <div style={{ color: 'white', marginTop: '50px' }}>Loading {CHECKBOX_COUNT.toLocaleString()} checkboxes...</div>
        )}
      </div>
    </div>
  );
}

export default App;