// src/views/RealTimeAlerts.tsx
import React from "react";
import { useAuth } from "../contexts";

type AlertType = "stockout" | "price_jump" | "trend_spike";
type AlertSeverity = "critical" | "warning" | "info";

type Alert = {
  id: string;
  timestamp: string;
  type: AlertType;
  severity: AlertSeverity;
  product_name: string;
  product_id: string;
  current_value: number;
  previous_value: number;
  change_percent: number;
  platform?: string;
  message: string;
  is_read: boolean;
};

type AlertStats = {
  total_alerts: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  stockout_count: number;
  price_jump_count: number;
  trend_spike_count: number;
};

export default function RealTimeAlerts() {
  const { token } = useAuth();
  const [loading, setLoading] = React.useState(true);
  const [alerts, setAlerts] = React.useState<Alert[]>([]);
  const [stats, setStats] = React.useState<AlertStats>({
    total_alerts: 0,
    critical_count: 0,
    warning_count: 0,
    info_count: 0,
    stockout_count: 0,
    price_jump_count: 0,
    trend_spike_count: 0,
  });
  const [selectedType, setSelectedType] = React.useState<AlertType | "all">("all");
  const [selectedSeverity, setSelectedSeverity] = React.useState<AlertSeverity | "all">("all");
  const [showOnlyUnread, setShowOnlyUnread] = React.useState(false);

  const loadAlerts = React.useCallback(async () => {
    if (!token) return;

    setLoading(true);
    try {
      const response = await fetch("/api/alerts/live", {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) throw new Error("Failed to fetch alerts");
      
      const data = await response.json();
      setAlerts(data.alerts || []);
      setStats(data.stats || stats);
    } catch (err) {
      console.error("Error loading alerts:", err);
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  React.useEffect(() => {
    loadAlerts();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadAlerts, 30000);
    return () => clearInterval(interval);
  }, [loadAlerts]);

  const markAsRead = async (alertId: string) => {
    try {
      const response = await fetch(`/api/alerts/${alertId}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        setAlerts((prev) =>
          prev.map((alert) =>
            alert.id === alertId ? { ...alert, is_read: true } : alert
          )
        );
      }
    } catch (err) {
      console.error("Error marking alert as read:", err);
    }
  };

  const markAllAsRead = async () => {
    try {
      const response = await fetch("/api/alerts/mark-all-read", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        setAlerts((prev) => prev.map((alert) => ({ ...alert, is_read: true })));
      }
    } catch (err) {
      console.error("Error marking all as read:", err);
    }
  };

  const filteredAlerts = alerts.filter((alert) => {
    if (selectedType !== "all" && alert.type !== selectedType) return false;
    if (selectedSeverity !== "all" && alert.severity !== selectedSeverity) return false;
    if (showOnlyUnread && alert.is_read) return false;
    return true;
  });

  const unreadCount = alerts.filter((a) => !a.is_read).length;

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-gray-500">Loading alerts...</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Real-Time Alerts</h1>
          <p className="text-sm text-gray-500">
            Monitor stock levels, price changes, and trending products
          </p>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
            >
              Mark All Read
            </button>
          )}
          <button
            onClick={loadAlerts}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          title="Total Alerts"
          value={stats.total_alerts}
          subtitle={`${unreadCount} unread`}
          color="blue"
        />
        <StatCard
          title="Stock Outs"
          value={stats.stockout_count}
          subtitle="Out of stock items"
          color="red"
        />
        <StatCard
          title="Price Jumps"
          value={stats.price_jump_count}
          subtitle="Significant changes"
          color="orange"
        />
        <StatCard
          title="Trend Spikes"
          value={stats.trend_spike_count}
          subtitle="Google Trends up"
          color="green"
        />
      </div>

      {/* Filters */}
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Type:</span>
            <FilterButton
              active={selectedType === "all"}
              onClick={() => setSelectedType("all")}
            >
              All
            </FilterButton>
            <FilterButton
              active={selectedType === "stockout"}
              onClick={() => setSelectedType("stockout")}
            >
              Stock Outs
            </FilterButton>
            <FilterButton
              active={selectedType === "price_jump"}
              onClick={() => setSelectedType("price_jump")}
            >
              Price Jumps
            </FilterButton>
            <FilterButton
              active={selectedType === "trend_spike"}
              onClick={() => setSelectedType("trend_spike")}
            >
              Trend Spikes
            </FilterButton>
          </div>

          <div className="h-6 w-px bg-gray-300" />

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Severity:</span>
            <FilterButton
              active={selectedSeverity === "all"}
              onClick={() => setSelectedSeverity("all")}
            >
              All
            </FilterButton>
            <FilterButton
              active={selectedSeverity === "critical"}
              onClick={() => setSelectedSeverity("critical")}
            >
              Critical
            </FilterButton>
            <FilterButton
              active={selectedSeverity === "warning"}
              onClick={() => setSelectedSeverity("warning")}
            >
              Warning
            </FilterButton>
            <FilterButton
              active={selectedSeverity === "info"}
              onClick={() => setSelectedSeverity("info")}
            >
              Info
            </FilterButton>
          </div>

          <div className="h-6 w-px bg-gray-300" />

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showOnlyUnread}
              onChange={(e) => setShowOnlyUnread(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium text-gray-700">Unread Only</span>
          </label>
        </div>
      </div>

      {/* Alerts List */}
      <div className="rounded-2xl border bg-white shadow-sm">
        {filteredAlerts.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            No alerts match your filters
          </div>
        ) : (
          <div className="divide-y">
            {filteredAlerts.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onMarkAsRead={markAsRead}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ========== SUB-COMPONENTS ==========

function StatCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: number;
  subtitle: string;
  color: "blue" | "red" | "orange" | "green";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600",
    red: "bg-red-50 text-red-600",
    orange: "bg-orange-50 text-orange-600",
    green: "bg-green-50 text-green-600",
  };

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-sm text-gray-600">{title}</div>
      <div className={`mt-1 text-3xl font-bold ${colorClasses[color]}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-gray-500">{subtitle}</div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1 text-sm font-medium transition-colors ${
        active
          ? "bg-gray-900 text-white"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {children}
    </button>
  );
}

function AlertItem({
  alert,
  onMarkAsRead,
}: {
  alert: Alert;
  onMarkAsRead: (id: string) => void;
}) {
  const typeConfig = {
    stockout: {
      icon: "📦",
      label: "Stock Out",
      bgColor: "bg-red-50",
      textColor: "text-red-700",
      borderColor: "border-red-200",
    },
    price_jump: {
      icon: "💰",
      label: "Price Jump",
      bgColor: "bg-orange-50",
      textColor: "text-orange-700",
      borderColor: "border-orange-200",
    },
    trend_spike: {
      icon: "📈",
      label: "Trend Spike",
      bgColor: "bg-green-50",
      textColor: "text-green-700",
      borderColor: "border-green-200",
    },
  };

  const severityConfig = {
    critical: {
      label: "Critical",
      color: "bg-red-100 text-red-800",
    },
    warning: {
      label: "Warning",
      color: "bg-yellow-100 text-yellow-800",
    },
    info: {
      label: "Info",
      color: "bg-blue-100 text-blue-800",
    },
  };

  const config = typeConfig[alert.type];
  const severityStyle = severityConfig[alert.severity];

  return (
    <div
      className={`p-4 transition-colors hover:bg-gray-50 ${
        !alert.is_read ? "bg-blue-50/30" : ""
      }`}
    >
      <div className="flex gap-4">
        {/* Icon */}
        <div
          className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-2xl ${config.bgColor}`}
        >
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityStyle.color}`}
                >
                  {severityStyle.label}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${config.bgColor} ${config.textColor}`}
                >
                  {config.label}
                </span>
                {alert.platform && (
                  <span className="text-xs text-gray-500">{alert.platform}</span>
                )}
              </div>

              <h3 className="mt-1 font-semibold text-gray-900">
                {alert.product_name}
              </h3>

              <p className="mt-1 text-sm text-gray-600">{alert.message}</p>

              <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                <span>
                  Previous: {formatValue(alert.type, alert.previous_value)}
                </span>
                <span>→</span>
                <span className="font-medium text-gray-900">
                  Current: {formatValue(alert.type, alert.current_value)}
                </span>
                <span
                  className={`font-semibold ${
                    alert.change_percent > 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {alert.change_percent > 0 ? "+" : ""}
                  {alert.change_percent.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Time and Actions */}
            <div className="flex flex-col items-end gap-2">
              <div className="text-xs text-gray-500">
                {formatTimestamp(alert.timestamp)}
              </div>
              {!alert.is_read && (
                <button
                  onClick={() => onMarkAsRead(alert.id)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Mark as read
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== HELPER FUNCTIONS ==========

function formatValue(type: AlertType, value: number): string {
  if (type === "price_jump") {
    return `$${value.toFixed(2)}`;
  } else if (type === "stockout") {
    return `${Math.round(value)} units`;
  } else if (type === "trend_spike") {
    return `${Math.round(value)} score`;
  }
  return value.toString();
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return date.toLocaleDateString();
}