import React, { useState, useEffect, useRef } from 'react';
import './RealTimeAlerts.css';

// API Configuration
const WEBSOCKET_URL = 'wss://sdzrplzis6.execute-api.us-east-1.amazonaws.com/production/';
const REST_API_URL = 'https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com/dev';

const RealTimeAlerts = () => {
  const [alerts, setAlerts] = useState([]);
  const [filteredAlerts, setFilteredAlerts] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    unread: 0,
    stockOuts: 0,
    priceJumps: 0,
    trendSpikes: 0
  });
  const [filters, setFilters] = useState({
    type: 'All',
    severity: 'All',
    unreadOnly: false
  });
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef(null);

  // Fetch initial alerts from REST API
  const fetchAlerts = async () => {
    try {
      console.log('Fetching alerts from:', `${REST_API_URL}/alerts/live`);
      
      const response = await fetch(`${REST_API_URL}/alerts/live`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Fetched alerts:', data);
      
      if (data.alerts && Array.isArray(data.alerts)) {
        setAlerts(data.alerts);
        updateStats(data.alerts);
      }
    } catch (error) {
      console.error('Error fetching alerts:', error);
    }
  };

  // Connect to WebSocket
  const connectWebSocket = () => {
    try {
      console.log('Connecting to WebSocket:', WEBSOCKET_URL);
      
      const ws = new WebSocket(WEBSOCKET_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'alert') {
            setAlerts(prevAlerts => {
              const newAlerts = [data.alert, ...prevAlerts];
              updateStats(newAlerts);
              return newAlerts;
            });
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        
        // Reconnect after 5 seconds
        setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, 5000);
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
    }
  };

  // Update stats based on alerts
  const updateStats = (alertsList) => {
    const newStats = {
      total: alertsList.length,
      unread: alertsList.filter(a => !a.read).length,
      stockOuts: alertsList.filter(a => a.type === 'Stock Out').length,
      priceJumps: alertsList.filter(a => a.type === 'Price Jump').length,
      trendSpikes: alertsList.filter(a => a.type === 'Trend Spike').length
    };
    setStats(newStats);
  };

  // Filter alerts based on selected filters
  useEffect(() => {
    let filtered = [...alerts];

    if (filters.type !== 'All') {
      filtered = filtered.filter(alert => alert.type === filters.type);
    }

    if (filters.severity !== 'All') {
      filtered = filtered.filter(alert => alert.severity === filters.severity);
    }

    if (filters.unreadOnly) {
      filtered = filtered.filter(alert => !alert.read);
    }

    setFilteredAlerts(filtered);
  }, [alerts, filters]);

  // Initialize on component mount
  useEffect(() => {
    fetchAlerts();
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleRefresh = () => {
    fetchAlerts();
  };

  const getSeverityColor = (severity) => {
    const colors = {
      'Critical': '#ef4444',
      'Warning': '#f59e0b',
      'Info': '#3b82f6'
    };
    return colors[severity] || '#6b7280';
  };

  return (
    <div className="real-time-alerts">
      <div className="alerts-header">
        <div className="header-title">
          <h2>Real-Time Alerts</h2>
          <p>Monitor stock levels, price changes, and trending products</p>
        </div>
        <div className="header-actions">
          <div className="connection-status">
            <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></span>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <button onClick={handleRefresh} className="refresh-btn">
            Refresh
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Alerts</div>
          <div className="stat-value">{stats.total}</div>
          <div className="stat-detail">{stats.unread} unread</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Stock Outs</div>
          <div className="stat-value red">{stats.stockOuts}</div>
          <div className="stat-detail">Out of stock items</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Price Jumps</div>
          <div className="stat-value orange">{stats.priceJumps}</div>
          <div className="stat-detail">Significant changes</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Trend Spikes</div>
          <div className="stat-value green">{stats.trendSpikes}</div>
          <div className="stat-detail">Google Trends up</div>
        </div>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <label>Type:</label>
          <button 
            className={filters.type === 'All' ? 'active' : ''} 
            onClick={() => setFilters({...filters, type: 'All'})}
          >
            All
          </button>
          <button 
            className={filters.type === 'Stock Out' ? 'active' : ''} 
            onClick={() => setFilters({...filters, type: 'Stock Out'})}
          >
            Stock Outs
          </button>
          <button 
            className={filters.type === 'Price Jump' ? 'active' : ''} 
            onClick={() => setFilters({...filters, type: 'Price Jump'})}
          >
            Price Jumps
          </button>
          <button 
            className={filters.type === 'Trend Spike' ? 'active' : ''} 
            onClick={() => setFilters({...filters, type: 'Trend Spike'})}
          >
            Trend Spikes
          </button>
        </div>

        <div className="filter-group">
          <label>Severity:</label>
          <button 
            className={filters.severity === 'All' ? 'active' : ''} 
            onClick={() => setFilters({...filters, severity: 'All'})}
          >
            All
          </button>
          <button 
            className={filters.severity === 'Critical' ? 'active' : ''} 
            onClick={() => setFilters({...filters, severity: 'Critical'})}
          >
            Critical
          </button>
          <button 
            className={filters.severity === 'Warning' ? 'active' : ''} 
            onClick={() => setFilters({...filters, severity: 'Warning'})}
          >
            Warning
          </button>
          <button 
            className={filters.severity === 'Info' ? 'active' : ''} 
            onClick={() => setFilters({...filters, severity: 'Info'})}
          >
            Info
          </button>
        </div>

        <div className="filter-group">
          <label>
            <input
              type="checkbox"
              checked={filters.unreadOnly}
              onChange={(e) => setFilters({...filters, unreadOnly: e.target.checked})}
            />
            Unread Only
          </label>
        </div>
      </div>

      <div className="alerts-list">
        {filteredAlerts.length === 0 ? (
          <div className="no-alerts">
            <p>No alerts to display</p>
          </div>
        ) : (
          filteredAlerts.map((alert, index) => (
            <div 
              key={alert.id || index} 
              className={`alert-item ${!alert.read ? 'unread' : ''}`}
            >
              <div 
                className="alert-severity-bar" 
                style={{backgroundColor: getSeverityColor(alert.severity)}}
              ></div>
              <div className="alert-content">
                <div className="alert-header">
                  <span className="alert-type">{alert.type}</span>
                  <span className="alert-time">
                    {new Date(alert.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="alert-message">{alert.message}</div>
                {alert.details && (
                  <div className="alert-details">
                    {Object.entries(alert.details).map(([key, value]) => (
                      <span key={key}>
                        <strong>{key}:</strong> {value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default RealTimeAlerts;