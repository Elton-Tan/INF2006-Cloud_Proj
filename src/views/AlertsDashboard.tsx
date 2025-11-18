// AlertsDashboard.tsx
import React, { useState, useEffect } from 'react';
import './AlertsDashboard.css';

// Type definitions
interface Alert {
  alert_id: number;
  timestamp: string;
  location: string;
  alert_type: string;
  description: string;
  status: string;
}

interface AlertsResponse {
  success: boolean;
  data: Alert[];
  count: number;
}

const AlertsDashboard: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  // API endpoint
  const API_URL = 'https://my2tvaaw7i.execute-api.us-east-1.amazonaws.com/prod/alerts';

  // Fetch alerts from API
  const fetchAlerts = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await fetch(API_URL);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data: AlertsResponse = await response.json();
      
      if (data.success) {
        setAlerts(data.data);
      } else {
        throw new Error('Failed to fetch alerts');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch alerts on component mount
  useEffect(() => {
    fetchAlerts();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchAlerts, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // Filter alerts based on selected filters
  const filteredAlerts = alerts.filter(alert => {
    const typeMatch = filterType === 'all' || alert.alert_type === filterType;
    const statusMatch = filterStatus === 'all' || alert.status === filterStatus;
    return typeMatch && statusMatch;
  });

  // Get unique alert types and statuses for filters
  const alertTypes = ['all', ...Array.from(new Set(alerts.map(a => a.alert_type)))];
  const alertStatuses = ['all', ...Array.from(new Set(alerts.map(a => a.status)))];

  // Get status badge color
  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'active':
        return 'status-active';
      case 'resolved':
        return 'status-resolved';
      case 'pending':
        return 'status-pending';
      default:
        return 'status-default';
    }
  };

  // Get alert type badge color
  const getTypeColor = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'security':
        return 'type-security';
      case 'safety':
        return 'type-safety';
      case 'emergency':
        return 'type-emergency';
      default:
        return 'type-default';
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="alerts-dashboard">
      <div className="dashboard-header">
        <h1>Campus Guard - Alert Dashboard</h1>
        <button onClick={fetchAlerts} className="refresh-button">
          🔄 Refresh
        </button>
      </div>

      {/* Statistics Cards */}
      <div className="stats-container">
        <div className="stat-card">
          <h3>Total Alerts</h3>
          <p className="stat-number">{alerts.length}</p>
        </div>
        <div className="stat-card">
          <h3>Active</h3>
          <p className="stat-number stat-active">
            {alerts.filter(a => a.status === 'Active').length}
          </p>
        </div>
        <div className="stat-card">
          <h3>Resolved</h3>
          <p className="stat-number stat-resolved">
            {alerts.filter(a => a.status === 'Resolved').length}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-container">
        <div className="filter-group">
          <label htmlFor="type-filter">Filter by Type:</label>
          <select
            id="type-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="filter-select"
          >
            {alertTypes.map(type => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="status-filter">Filter by Status:</label>
          <select
            id="status-filter"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="filter-select"
          >
            {alertStatuses.map(status => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading alerts...</p>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="error-container">
          <p>❌ Error: {error}</p>
          <button onClick={fetchAlerts} className="retry-button">
            Try Again
          </button>
        </div>
      )}

      {/* Alerts Table */}
      {!loading && !error && (
        <div className="alerts-container">
          <h2>Alerts ({filteredAlerts.length})</h2>
          
          {filteredAlerts.length === 0 ? (
            <div className="no-alerts">
              <p>No alerts found</p>
            </div>
          ) : (
            <div className="alerts-table">
              {filteredAlerts.map((alert) => (
                <div key={alert.alert_id} className="alert-card">
                  <div className="alert-header">
                    <div className="alert-badges">
                      <span className={`badge ${getTypeColor(alert.alert_type)}`}>
                        {alert.alert_type}
                      </span>
                      <span className={`badge ${getStatusColor(alert.status)}`}>
                        {alert.status}
                      </span>
                    </div>
                    <span className="alert-time">{formatTimestamp(alert.timestamp)}</span>
                  </div>
                  
                  <div className="alert-body">
                    <h3>{alert.description}</h3>
                    <p className="alert-location">📍 {alert.location}</p>
                  </div>
                  
                  <div className="alert-footer">
                    <span className="alert-id">ID: {alert.alert_id}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AlertsDashboard;