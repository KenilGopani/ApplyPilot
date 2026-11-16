import { z } from "zod";

/**
 * One row of JobSpy's `scrape_jobs()` DataFrame as the worker serializes it:
 * the JobPost fields after JobSpy's own serializer (location is a display
 * string, job_type/emails/skills are comma-joined), empty cells removed.
 * Unknown columns are kept so a JobSpy upgrade that adds one is not lost.
 */
export const jobSpyRecordSchema = z
  .object({
    id: z.string().optional(),
    site: z.string().min(1),
    job_url: z.string().min(1),
    job_url_direct: z.string().optional(),
    title: z.string(),
    company: z.string().optional(),
    location: z.string().optional(),
    date_posted: z.string().optional(),
    job_type: z.string().optional(),
    salary_source: z.string().optional(),
    interval: z.string().optional(),
    min_amount: z.number().optional(),
    max_amount: z.number().optional(),
    currency: z.string().optional(),
    is_remote: z.boolean().optional(),
    work_from_home_type: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();
export type JobSpyRecord = z.infer<typeof jobSpyRecordSchema>;

const siteMetricsSchema = z.object({
  returned: z.number().int().nonnegative(),
  error: z.string().nullable(),
  warnings: z.array(z.string()),
});

/** The worker's stdout contract, `applypilot.jobspy.result@1`. */
export const jobSpyEnvelopeSchema = z.object({
  version: z.literal("applypilot.jobspy.result@1"),
  run_id: z.string().min(1),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  upstream: z.object({ package: z.string(), version: z.string().nullable() }),
  request: z.record(z.unknown()).nullable(),
  metrics: z.object({
    requested_per_site: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    by_site: z.record(siteMetricsSchema),
  }),
  // Records are validated one by one in the mapper so a single malformed row
  // is rejected on its own instead of failing the whole run.
  records: z.array(z.unknown()),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type JobSpyEnvelope = z.infer<typeof jobSpyEnvelopeSchema>;

/** What the platform asks JobSpy for. Mirrors `scrape_jobs()` parameters. */
export interface JobSpyDiscoveryRequest {
  site_name: string[];
  search_term?: string;
  google_search_term?: string;
  location?: string;
  distance?: number;
  is_remote?: boolean;
  job_type?: string;
  easy_apply?: boolean;
  results_wanted?: number;
  country_indeed?: string;
  proxies?: string[];
  description_format?: "markdown" | "html" | "plain";
  linkedin_company_ids?: number[];
  offset?: number;
  hours_old?: number;
  enforce_annual_salary?: boolean;
  verbose?: 0 | 1 | 2;
  fetch_description?: boolean;
  run_id?: string;
}
