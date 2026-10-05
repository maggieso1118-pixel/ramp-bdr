export type CorporationSummary = {
  id: number;
  source_id: string;
  business_number: string | null;
  legal_name: string | null;
  alternate_name: string | null;
  city: string | null;
  province_raw: string | null;
  province_normalized: string | null;
  country: string | null;
  status: string | null;
  likelihood_score?: number;
  likelihood_label?: string;
  likelihood_reason?: string;
};

export type Corporation = CorporationSummary & {
  governing_legislation: string | null;
  status_detail: string | null;
  anniversary_date: string | null;
  last_annual_filing_year: string | null;
  last_annual_meeting_date: string | null;
  street: string | null;
  street_2: string | null;
  postal_code_raw: string | null;
  postal_code_normalized: string | null;
  min_directors: string | null;
  max_directors: string | null;
  source: string;
  imported_at: string;
  updated_at: string;
  import_id: number;
  raw_data: string;
};

export type ImportReport = {
  id: number;
  filename: string;
  file_size: number;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  processed: number;
  inserted: number;
  updated: number;
  skipped_existing: number;
  invalid: number;
  duplicate_source_ids: number;
  duration_ms: number;
  error: string | null;
  invalid_examples: string;
};

export type SearchResult = {
  accounts: CorporationSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  query: string;
  province: string;
  queryTooShort: boolean;
};
