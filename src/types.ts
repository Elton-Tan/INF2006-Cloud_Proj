export type Severity = "low" | "medium" | "high";

export type Alert = {
  id: string;
  ts: string; // ISO
  title: string;
  description: string;
  severity: Severity;
  market?: string;
  channel?: string;
};

export type TrendPoint = {
  day: string;
  foot_cream: number;
  antifungal: number;
  heel_balm: number;
  forecast?: number;
};

export type PriceSeriesPoint = {
  day: string;
  avg_price_spiruvita: number;
  avg_price_canesten: number;
  avg_price_lamisil: number;
};

export type ApiWatchRow = {
  id: number | string;
  url: string;
  product: string | null;
  price: number | null;
  stock_status: string | null;
  image_url: string | null;
  updated_at?: number | string | null;
};

export type Availability = "in_stock" | "out_of_stock" | "unknown";

export type SnapshotRow = {
  url: string;
  product?: string | null;
  price?: number | null;
  availability?: Availability;
  imageUrl?: string | null;
  status?: "adding" | "ok" | "error";
  updated_at?: number;
};

export type AspectSummaryRow = {
  aspect: string;
  docs: number;
  share: number; // 0..1
};

export type TopTerm = { term: string; n: number; lift: number };
export type AspectTopTerms = Record<string, TopTerm[]>;
