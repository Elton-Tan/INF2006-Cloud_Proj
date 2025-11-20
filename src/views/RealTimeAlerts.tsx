import React, { useState, useEffect, useRef } from 'react';

// API Configuration
const WEBSOCKET_URL = 'wss://sdzrplzis6.execute-api.us-east-1.amazonaws.com/production/';
const REST_API_URL = 'https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com/dev';

// Inline styles
const styles = {
  container: {
    padding: '24px',
    maxWidth: '1400px',
    margin: '0 auto',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  } as React.CSSProperties,
  headerTitle: {
    margin: 0,
  } as React.CSSProperties,
  title: {
    margin: '0 0 4px 0',
    fontSize: '24px',
    color: '#1f2937',
  } as React.CSSProperties,
  subtitle: {
    margin: 0,
    color: '#6b7280',
    fontSize: '14px',
  } as React.CSSProperties,
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  } as React.CSSProperties,
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    background: '#f3f4f6',
    borderRadius: '6px',
    fontSize: '14px',
  } as React.CSSProperties,
  statusIndicator: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  } as React.CSSProperties,
  statusConnected: {
    background: '#10b981',
  } as React.CSSProperties,
  statusDisconnected: {
    background: '#ef4444',
  } as React.CSSProperties,
  refreshBtn: {
    padding: '8px 16px',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'background 0.2s',
  } as React.CSSProperties,
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  } as React.CSSProperties,
  statCard: {
    background: 'white',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  } as React.CSSProperties,
  statLabel: {
    color: '#6b7280',
    fontSize: '14px',
    marginBottom: '8px',
  } as React.CSSProperties,
  statValue: {
    fontSize: '32px',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '4px',
  } as React.CSSProperties,
  statValueRed: {
    fontSize: '32px',
    fontWeight: '600',
    color: '#ef4444',
    marginBottom: '4px',
  } as React.CSSProperties,
  statValueOrange: {
    fontSize: '32px',
    fontWeight: '600',
    color: '#f59e0b',
    marginBottom: '4px',
  } as React.CSSProperties,
  statValueGreen: {
    fontSize: '32px',
    fontWeight: '600',
    color: '#10b981',
    marginBottom: '4px',
  } as React.CSSProperties,
  statDetail: {
    color: '#9ca3af',
    fontSize: '12px',
  } as React.CSSProperties,
  filtersBar: {
    display: 'flex',
    gap: '24px',
    padding: '16px',
    background: 'white',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    marginBottom: '16px',
    flexWrap: 'wrap',
  } as React.CSSProperties,
  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as React.CSSProperties,
  filterLabel: {
    color: '#6b7280',
    fontSize: '14px',
    fontWeight: '500',
    marginRight: '4px',
  } as React.CSSProperties,
  filterBtn: {
    padding: '6px 12px',
    background: '#f3f4f6',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
  } as React.CSSProperties,
  filterBtnActive: {
    padding: '6px 12px',
    background: '#3b82f6',
    color: 'white',
    border: '1px solid #3b82f6',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s',
  } as React.CSSProperties,
  checkbox: {
    marginRight: '6px',
    cursor: 'pointer',
  } as React.CSSProperties,
  alertsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  } as React.CSSProperties,
  alertItem: {
    display: 'flex',
    background: 'white',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    overflow: 'hidden',
    transition: 'all 0.2s',
  } as React.CSSProperties,
  alertItemUnread: {
    display: 'flex',
    background: '#eff6ff',
    borderRadius: '8px',
    border: '1px solid #3b82f6',
    overflow: 'hidden',
    transition: 'all 0.2s',
  } as React.CSSProperties,
  alertSeverityBar: {
    width: '4px',
    flexShrink: 0,
  } as React.CSSProperties,
  alertContent: {
    flex: 1,
    padding: '16px',
  } as React.CSSProperties,
  alertHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  } as React.CSSProperties,
  alertType: {
    fontWeight: '600',
    color: '#1f2937',
    fontSize: '14px',
  } as React.CSSProperties,
  alertTime: {
    color: '#9ca3af',
    fontSize: '12px',
  } as React.CSSProperties,
  alertMessage: {
    color: '#4b5563',
    fontSize: '14px',
    lineHeight: '1.5',
    marginBottom: '8px',
  } as React.CSSProperties,
  alertDetails: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    fontSize: '13px',
    color: '#6b7280',
  } as React.CSSProperties,
  alertDetailsStrong: {
    color: '#4b5563',
  } as React.CSSProperties,
  noAlerts: {
    textAlign: 'center',
    padding: '48px',
    background: 'white',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    color: '#9ca3af',
  } as React.CSSProperties,
};

interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  timestamp: string;
  read?: boolean;
  details?: Record<string, any>;
}

const RealTimeAlerts: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filteredAlerts, setFilteredAlerts] = useState<Alert[]>([]);
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
  const wsRef = useRef<WebSocket | null>(null);

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
  const updateStats = (alertsList: Alert[]) => {
    const newStats = {
      total: alertsList.length,
      unread: alertsList.filter(a => !a.read).length,
      stockOuts: alertsList.filter(a => a.type === 'Stock Out' || a.type === 'stockout').length,
      priceJumps: alertsList.filter(a => a.type === 'Price Jump' || a.type === 'price_jump').length,
      trendSpikes: alertsList.filter(a => a.type === 'Trend Spike' || a.type === 'trend_spike').length
    };
    setStats(newStats);
  };

  // Filter alerts based on selected filters
  useEffect(() => {
    let filtered = [...alerts];

    if (filters.type !== 'All') {
      filtered = filtered.filter(alert => {
        const alertType = alert.type.toLowerCase().replace(' ', '_');
        const filterType = filters.type.toLowerCase().replace(' ', '_');
        return alertType === filterType || alert.type === filters.type;
      });
    }

    if (filters.severity !== 'All') {
      filtered = filtered.filter(alert => 
        alert.severity.toLowerCase() === filters.severity.toLowerCase()
      );
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

  const getSeverityColor = (severity: string): string => {
    const colors: Record<string, string> = {
      'critical': '#ef4444',
      'warning': '#f59e0b',
      'info': '#3b82f6'
    };
    return colors[severity.toLowerCase()] || '#6b7280';
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <h2 style={styles.title}>Real-Time Alerts</h2>
          <p style={styles.subtitle}>Monitor stock levels, price changes, and trending products</p>
        </div>
        <div style={styles.headerActions}>
          <div style={styles.connectionStatus}>
            <span style={{
              ...styles.statusIndicator,
              ...(isConnected ? styles.statusConnected : styles.statusDisconnected)
            }}></span>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <button 
            onClick={handleRefresh} 
            style={styles.refreshBtn}
            onMouseOver={(e) => e.currentTarget.style.background = '#2563eb'}
            onMouseOut={(e) => e.currentTarget.style.background = '#3b82f6'}
          >
            Refresh
          </button>
        </div>
      </div>

      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Total Alerts</div>
          <div style={styles.statValue}>{stats.total}</div>
          <div style={styles.statDetail}>{stats.unread} unread</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>Stock Outs</div>
          <div style={styles.statValueRed}>{stats.stockOuts}</div>
          <div style={styles.statDetail}>Out of stock items</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>Price Jumps</div>
          <div style={styles.statValueOrange}>{stats.priceJumps}</div>
          <div style={styles.statDetail}>Significant changes</div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>Trend Spikes</div>
          <div style={styles.statValueGreen}>{stats.trendSpikes}</div>
          <div style={styles.statDetail}>Google Trends up</div>
        </div>
      </div>

      <div style={styles.filtersBar}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Type:</label>
          <button 
            style={filters.type === 'All' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, type: 'All'})}
            onMouseOver={(e) => {
              if (filters.type !== 'All') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.type !== 'All') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            All
          </button>
          <button 
            style={filters.type === 'Stock Out' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, type: 'Stock Out'})}
            onMouseOver={(e) => {
              if (filters.type !== 'Stock Out') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.type !== 'Stock Out') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            Stock Outs
          </button>
          <button 
            style={filters.type === 'Price Jump' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, type: 'Price Jump'})}
            onMouseOver={(e) => {
              if (filters.type !== 'Price Jump') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.type !== 'Price Jump') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            Price Jumps
          </button>
          <button 
            style={filters.type === 'Trend Spike' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, type: 'Trend Spike'})}
            onMouseOver={(e) => {
              if (filters.type !== 'Trend Spike') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.type !== 'Trend Spike') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            Trend Spikes
          </button>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>Severity:</label>
          <button 
            style={filters.severity === 'All' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, severity: 'All'})}
            onMouseOver={(e) => {
              if (filters.severity !== 'All') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.severity !== 'All') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            All
          </button>
          <button 
            style={filters.severity === 'Critical' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, severity: 'Critical'})}
            onMouseOver={(e) => {
              if (filters.severity !== 'Critical') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.severity !== 'Critical') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            Critical
          </button>
          <button 
            style={filters.severity === 'Warning' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, severity: 'Warning'})}
            onMouseOver={(e) => {
              if (filters.severity !== 'Warning') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.severity !== 'Warning') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            Warning
          </button>
          <button 
            style={filters.severity === 'Info' ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setFilters({...filters, severity: 'Info'})}
            onMouseOver={(e) => {
              if (filters.severity !== 'Info') e.currentTarget.style.background = '#e5e7eb';
            }}
            onMouseOut={(e) => {
              if (filters.severity !== 'Info') e.currentTarget.style.background = '#f3f4f6';
            }}
          >
            Info
          </button>
        </div>

        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>
            <input
              type="checkbox"
              checked={filters.unreadOnly}
              onChange={(e) => setFilters({...filters, unreadOnly: e.target.checked})}
              style={styles.checkbox}
            />
            Unread Only
          </label>
        </div>
      </div>

      <div style={styles.alertsList}>
        {filteredAlerts.length === 0 ? (
          <div style={styles.noAlerts}>
            <p>No alerts to display</p>
          </div>
        ) : (
          filteredAlerts.map((alert, index) => (
            <div 
              key={alert.id || index} 
              style={!alert.read ? styles.alertItemUnread : styles.alertItem}
            >
              <div 
                style={{
                  ...styles.alertSeverityBar,
                  backgroundColor: getSeverityColor(alert.severity)
                }}
              ></div>
              <div style={styles.alertContent}>
                <div style={styles.alertHeader}>
                  <span style={styles.alertType}>{alert.type}</span>
                  <span style={styles.alertTime}>
                    {new Date(alert.timestamp).toLocaleString()}
                  </span>
                </div>
                <div style={styles.alertMessage}>{alert.message}</div>
                {alert.details && (
                  <div style={styles.alertDetails}>
                    {Object.entries(alert.details).map(([key, value]) => (
                      <span key={key}>
                        <strong style={styles.alertDetailsStrong}>{key}:</strong> {String(value)}
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