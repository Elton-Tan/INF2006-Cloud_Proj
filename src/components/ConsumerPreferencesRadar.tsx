// src/components/ConsumerPreferencesRadar.tsx
import React from "react";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  Tooltip,
} from "recharts";
import { useJson } from "../hooks";

// Types for our processed data
type PreferenceData = {
  category: string;
  "18-25": number;
  "26-35": number;
  "36-45": number;
  "46-55": number;
  "56+": number;
};

type ConsumerPreferencesResponse = {
  data: PreferenceData[];
  keyFindings: string[];
  metadata: {
    totalResponses: number;
    ageGroups: Array<{ ageGroup: string; count: number }>;
    lastUpdated: string;
    source: string;
  };
};

export default function ConsumerPreferencesRadar() {
  const {
    data: response,
    loading,
    error,
  } = useJson<ConsumerPreferencesResponse>(
    "https://sa0cp2a3r8.execute-api.us-east-1.amazonaws.com/dev/spirulina-dev-consumer-preference"
  );

  if (loading) {
    return (
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Consumer Preferences by Age Group
        </h2>
        <div className="flex h-96 items-center justify-center text-gray-500">
          Loading data...
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Consumer Preferences by Age Group
        </h2>
        <div className="flex h-96 items-center justify-center text-red-500">
          Error: {error}
        </div>
      </section>
    );
  }

  // Only process data after loading/error checks
  const data = response?.data;
  const keyFindings = response?.keyFindings?.map((text) => ({ text })) || [];

  // If we don't have valid response data, show error state
  if (!response || !data) {
    return (
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold">
          Consumer Preferences by Age Group
        </h2>
        <div className="flex h-96 items-center justify-center text-red-500">
          No data available
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-2">
      <h2 className="mb-1 text-lg font-semibold">
        Consumer Preferences by Age Group
      </h2>
      <p className="mb-3 text-sm text-gray-500">
        Analysis of shopping behavior across different age demographics
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        {/* Radar Chart */}
        <div className="md:col-span-2">
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data}>
                <PolarGrid stroke="#e5e7eb" />
                <PolarAngleAxis
                  dataKey="category"
                  tick={{ fill: "#6b7280", fontSize: 12 }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                />
                <Radar
                  name="18-25"
                  dataKey="18-25"
                  stroke="#8b5cf6"
                  fill="#8b5cf6"
                  fillOpacity={0.2}
                />
                <Radar
                  name="26-35"
                  dataKey="26-35"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.2}
                />
                <Radar
                  name="36-45"
                  dataKey="36-45"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.2}
                />
                <Radar
                  name="46-55"
                  dataKey="46-55"
                  stroke="#ef4444"
                  fill="#ef4444"
                  fillOpacity={0.2}
                />
                <Radar
                  name="56+"
                  dataKey="56+"
                  stroke="#06b6d4"
                  fill="#06b6d4"
                  fillOpacity={0.2}
                />
                <Legend
                  wrapperStyle={{ fontSize: "12px" }}
                  iconType="circle"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  formatter={(value: any) => `${value}%`}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Key Findings */}
        <div className="rounded-xl bg-gray-50 p-4">
          <h3 className="mb-3 font-semibold text-gray-900">Key Findings</h3>
          <ul className="space-y-3 text-sm text-gray-700">
            {keyFindings.map((finding, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                <span>{finding.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-xl border-t pt-3 text-xs text-gray-500">
        Data source: {response.metadata.source} (n=
        {response.metadata.totalResponses} responses)
      </div>
    </section>
  );
}
